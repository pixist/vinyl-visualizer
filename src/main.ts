import { loadConfig, saveConfig, clampDelayMs, clampGainDb, clampSamplesPerColumn, ZOOM_LEVELS, type AppConfig, type DeckConfig } from "./config/decks";
import { dbToLinear } from "./util/channelMix";
import { startCapture, listInputDevices, type CaptureHandle } from "./audio/captureManager";
import { mountDecks, populateDeviceOptions, type DeckElements } from "./render/deckView";
import { WaveformRenderer } from "./render/waveformRenderer";
import { advanceDeck, type DeckStreams } from "./render/scrollDriver";

const MAX_COLUMNS = 2048; // upper bound on columns redrawn in one frame

const startBtn = document.getElementById("startBtn") as HTMLButtonElement;
const statusEl = document.getElementById("status") as HTMLSpanElement;
const decksEl = document.getElementById("decks") as HTMLElement;

const config: AppConfig = loadConfig(localStorage);
const views: Map<string, DeckElements> = mountDecks(decksEl, config, {
  onDelayChange,
  onGainChange,
  onDeviceChange,
});

const zoomSelect = document.getElementById("zoomSelect") as HTMLSelectElement;
for (const spc of ZOOM_LEVELS) {
  const opt = document.createElement("option");
  opt.value = String(spc);
  opt.textContent = `${(spc / 48).toFixed(1)} ms/px`;
  zoomSelect.append(opt);
}
zoomSelect.value = String(config.samplesPerColumn);
zoomSelect.addEventListener("change", () => {
  config.samplesPerColumn = clampSamplesPerColumn(Number(zoomSelect.value));
  saveConfig(localStorage, config);
  for (const rt of runtimes) {
    rt.consumed = null; // resnap so we don't redraw a huge backlog at the new scale
    rt.stream.renderer.clear();
  }
});

// One capture per distinct device key (deviceId, or "" for the system default).
const handles = new Map<string, CaptureHandle>();
let runtimes: DeckRuntime[] = [];
let running = false;
let rafId = 0;

const scratchL = new Float32Array(MAX_COLUMNS * Math.max(...ZOOM_LEVELS));
const scratchR = new Float32Array(scratchL.length);

interface DeckRuntime {
  deckId: string;
  stream: DeckStreams;
  canvas: HTMLCanvasElement;
  sampleRate: number;
  consumed: number | null;
}

function setStatus(msg: string): void {
  statusEl.textContent = msg;
}

function deviceKey(deck: DeckConfig): string {
  return deck.deviceId ?? "";
}

async function refreshDeviceLabels(): Promise<void> {
  const devices = await listInputDevices();
  populateDeviceOptions(views, devices, config);
}

function onDelayChange(deckId: string, delayMs: number): void {
  const deck = config.decks.find((d) => d.id === deckId);
  if (!deck) return;
  deck.delayMs = clampDelayMs(delayMs);
  saveConfig(localStorage, config);
}

function onGainChange(deckId: string, gainDb: number): void {
  const deck = config.decks.find((d) => d.id === deckId);
  if (!deck) return;
  deck.gainDb = clampGainDb(gainDb);
  saveConfig(localStorage, config);
}

function onDeviceChange(deckId: string, deviceId: string | null): void {
  const deck = config.decks.find((d) => d.id === deckId);
  if (!deck) return;
  deck.deviceId = deviceId;
  saveConfig(localStorage, config);
  if (running) void restart(); // re-open captures so the new routing takes effect
}

async function startAll(): Promise<void> {
  if (running) return;
  setStatus("requesting input...");
  try {
    const keys = [...new Set(config.decks.map(deviceKey))];
    for (const key of keys) {
      const decksOnDevice = config.decks.filter((d) => deviceKey(d) === key);
      const maxChannel = Math.max(
        ...decksOnDevice.flatMap((d) => [d.leftChannel, d.rightChannel ?? d.leftChannel]),
      );
      const handle = await startCapture({
        deviceId: key || undefined,
        requestedChannels: maxChannel + 1,
      });
      handles.set(key, handle);
    }
    await refreshDeviceLabels(); // labels are available once permission is granted
    buildRuntimes();
    running = true;
    startBtn.textContent = "Stop";
    setStatus(statusSummary());
    rafId = requestAnimationFrame(frame);
  } catch (err) {
    setStatus(`error: ${(err as Error).message}`);
    await stopAll();
  }
}

async function stopAll(): Promise<void> {
  cancelAnimationFrame(rafId);
  running = false;
  runtimes = [];
  for (const handle of handles.values()) await handle.stop();
  handles.clear();
  for (const view of views.values()) view.canvas.getContext("2d")?.clearRect(0, 0, view.canvas.width, view.canvas.height);
  startBtn.textContent = "Start capture";
}

async function restart(): Promise<void> {
  await stopAll();
  await startAll();
}

/** Bind each deck's canvas to the readers of its chosen device. */
function buildRuntimes(): void {
  runtimes = [];
  for (const deck of config.decks) {
    const view = views.get(deck.id);
    const handle = handles.get(deviceKey(deck));
    if (!view || !handle) continue;
    const leftReader = handle.readers[deck.leftChannel];
    if (!leftReader) continue;
    const rightReader = deck.rightChannel !== null ? handle.readers[deck.rightChannel] ?? null : null;

    const canvas = view.canvas;
    canvas.width = canvas.clientWidth || 1200;
    canvas.height = canvas.clientHeight || 160;

    runtimes.push({
      deckId: deck.id,
      stream: {
        left: leftReader,
        right: rightReader,
        mode: deck.mode,
        renderer: new WaveformRenderer(canvas, deck.color),
        delaySamples: 0,
        gain: dbToLinear(deck.gainDb),
      },
      canvas,
      sampleRate: handle.sampleRate,
      consumed: null,
    });
  }
}

function statusSummary(): string {
  const parts = config.decks.map((d) => {
    const handle = handles.get(deviceKey(d));
    return handle ? `${d.label}: ${handle.channelCount}ch@${Math.round(handle.sampleRate / 1000)}k` : `${d.label}: —`;
  });
  return parts.join("   ");
}

function frame(): void {
  for (const rt of runtimes) {
    const deck = config.decks.find((d) => d.id === rt.deckId);
    if (deck) {
      rt.stream.delaySamples = Math.round((deck.delayMs / 1000) * rt.sampleRate);
      rt.stream.gain = dbToLinear(deck.gainDb);
    }
    const cap = Math.min(rt.canvas.width, MAX_COLUMNS);
    rt.consumed = advanceDeck(rt.stream, rt.consumed, scratchL, scratchR, cap, config.samplesPerColumn);
  }
  rafId = requestAnimationFrame(frame);
}

startBtn.addEventListener("click", () => {
  if (running) void stopAll();
  else void startAll();
});

void refreshDeviceLabels();
setStatus("idle - click Start");
