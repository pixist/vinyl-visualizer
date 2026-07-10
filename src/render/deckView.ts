import type { DeckConfig, AppConfig } from "../config/decks";
import { clampDelayMs, clampGainDb, MAX_DELAY_MS, MAX_GAIN_DB, MIN_GAIN_DB } from "../config/decks";
import type { ChannelMode } from "../util/channelMix";

export interface DeckElements {
  root: HTMLElement;
  canvas: HTMLCanvasElement;
  deviceSelect: HTMLSelectElement;
  modeSelect: HTMLSelectElement;
  chSelectL: HTMLSelectElement;
  chSelectR: HTMLSelectElement;
}

export interface DeckCallbacks {
  onDelayChange: (deckId: string, delayMs: number) => void;
  onGainChange: (deckId: string, gainDb: number) => void;
  onDeviceChange: (deckId: string, deviceId: string | null) => void;
  onRoutingChange: (deckId: string, patch: { mode?: ChannelMode; leftChannel?: number; rightChannel?: number | null }) => void;
}

const DEFAULT_DEVICE_LABEL = "Default input";

function formatDb(db: number): string {
  return `${db > 0 ? "+" : ""}${db} dB`;
}

/** Fill a channel select with options 1..count (0-based values), optionally with a "none" entry. */
function fillChannelOptions(
  select: HTMLSelectElement,
  count: number,
  selected: number | null,
  allowNone: boolean,
): void {
  select.innerHTML = "";
  if (allowNone) {
    const none = document.createElement("option");
    none.value = "";
    none.textContent = "—";
    select.append(none);
  }
  for (let i = 0; i < count; i++) {
    const opt = document.createElement("option");
    opt.value = String(i);
    opt.textContent = `ch ${i + 1}`;
    select.append(opt);
  }
  const sel = selected === null ? "" : String(Math.min(selected, count - 1));
  select.value = sel;
}

/** Builds the DOM for one deck lane: device picker, delay slider, and canvas. */
export function createDeckView(deck: DeckConfig, callbacks: DeckCallbacks): DeckElements {
  const root = document.createElement("section");
  root.className = "deck";

  const head = document.createElement("div");
  head.className = "deck-head";

  const label = document.createElement("span");
  label.className = "deck-label";
  label.textContent = deck.label;
  label.style.color = deck.color;

  const deviceSelect = document.createElement("select");
  deviceSelect.className = "deck-device";
  deviceSelect.title = `${deck.label} input device`;
  deviceSelect.addEventListener("change", () => {
    callbacks.onDeviceChange(deck.id, deviceSelect.value || null);
  });

  const modeSelect = document.createElement("select");
  modeSelect.className = "deck-mode";
  const MODES: Array<[ChannelMode, string]> = [
    ["mono-sum", "L+R mono"],
    ["stereo", "stereo (sum)"],
    ["left", "L only"],
    ["right", "R only"],
  ];
  for (const [value, text] of MODES) {
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = text;
    modeSelect.append(opt);
  }
  modeSelect.value = deck.mode;
  modeSelect.addEventListener("change", () => {
    callbacks.onRoutingChange(deck.id, { mode: modeSelect.value as ChannelMode });
  });

  const chSelectL = document.createElement("select");
  chSelectL.className = "deck-ch";
  const chSelectR = document.createElement("select");
  chSelectR.className = "deck-ch";
  fillChannelOptions(chSelectL, 2, deck.leftChannel, false);
  fillChannelOptions(chSelectR, 2, deck.rightChannel, true);
  chSelectL.addEventListener("change", () => {
    callbacks.onRoutingChange(deck.id, { leftChannel: Number(chSelectL.value) });
  });
  chSelectR.addEventListener("change", () => {
    callbacks.onRoutingChange(deck.id, {
      rightChannel: chSelectR.value === "" ? null : Number(chSelectR.value),
    });
  });

  const delayWrap = document.createElement("label");
  delayWrap.className = "delay";
  const delayValue = document.createElement("span");
  delayValue.textContent = `${deck.delayMs} ms`;
  const slider = document.createElement("input");
  slider.type = "range";
  slider.min = "0";
  slider.max = String(MAX_DELAY_MS);
  slider.step = "1";
  slider.value = String(deck.delayMs);
  slider.addEventListener("input", () => {
    const ms = clampDelayMs(Number(slider.value));
    delayValue.textContent = `${ms} ms`;
    callbacks.onDelayChange(deck.id, ms);
  });
  delayWrap.append("delay ", slider, delayValue);

  const gainWrap = document.createElement("label");
  gainWrap.className = "gain";
  const gainValue = document.createElement("span");
  gainValue.textContent = formatDb(deck.gainDb);
  const gainSlider = document.createElement("input");
  gainSlider.type = "range";
  gainSlider.min = String(MIN_GAIN_DB);
  gainSlider.max = String(MAX_GAIN_DB);
  gainSlider.step = "1";
  gainSlider.value = String(deck.gainDb);
  gainSlider.addEventListener("input", () => {
    const db = clampGainDb(Number(gainSlider.value));
    gainValue.textContent = formatDb(db);
    callbacks.onGainChange(deck.id, db);
  });
  gainWrap.append("gain ", gainSlider, gainValue);

  head.append(label, deviceSelect, modeSelect, chSelectL, chSelectR, gainWrap, delayWrap);

  const canvas = document.createElement("canvas");
  canvas.className = "deck-canvas";

  root.append(head, canvas);
  return { root, canvas, deviceSelect, modeSelect, chSelectL, chSelectR };
}

export function mountDecks(
  container: HTMLElement,
  config: AppConfig,
  callbacks: DeckCallbacks,
): Map<string, DeckElements> {
  container.innerHTML = "";
  const map = new Map<string, DeckElements>();
  for (const deck of config.decks) {
    const view = createDeckView(deck, callbacks);
    container.append(view.root);
    map.set(deck.id, view);
  }
  return map;
}

/**
 * Fill each deck's device dropdown with the available inputs plus a "Default
 * input" entry, preserving each deck's current selection. Called again after
 * permission is granted, when device labels become populated.
 */
export function populateDeviceOptions(
  views: Map<string, DeckElements>,
  devices: MediaDeviceInfo[],
  config: AppConfig,
): void {
  for (const deck of config.decks) {
    const view = views.get(deck.id);
    if (!view) continue;
    const select = view.deviceSelect;
    select.innerHTML = "";

    const defaultOpt = document.createElement("option");
    defaultOpt.value = "";
    defaultOpt.textContent = DEFAULT_DEVICE_LABEL;
    select.append(defaultOpt);

    devices.forEach((d, i) => {
      const opt = document.createElement("option");
      opt.value = d.deviceId;
      opt.textContent = d.label || `Input ${i + 1}`;
      select.append(opt);
    });

    select.value = deck.deviceId ?? "";
  }
}

export function populateChannelOptions(
  views: Map<string, DeckElements>,
  channelCounts: Map<string, number>, // deckId -> channel count
  config: AppConfig,
): void {
  for (const deck of config.decks) {
    const view = views.get(deck.id);
    const count = channelCounts.get(deck.id);
    if (!view || !count) continue;
    fillChannelOptions(view.chSelectL, count, deck.leftChannel, false);
    fillChannelOptions(view.chSelectR, count, deck.rightChannel, true);
  }
}
