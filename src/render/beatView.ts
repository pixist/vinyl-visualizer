/** BPM readout, 4-block bar indicator, and tap-1 / nudge controls for a deck. */

export interface BeatViewElements {
  root: HTMLElement;
  bpmText: HTMLSpanElement;
  blocks: HTMLSpanElement[];
}

export interface BeatViewCallbacks {
  onTap(): void;
  onNudge(delta: number): void;
}

const BLOCK_COUNT = 4;
const CONFIDENT = 0.4; // below this the indicator dims

export function createBeatView(callbacks: BeatViewCallbacks): BeatViewElements {
  const root = document.createElement("div");
  root.className = "beat";

  const bpmText = document.createElement("span");
  bpmText.className = "beat-bpm";
  bpmText.textContent = "—";

  const bar = document.createElement("span");
  bar.className = "beat-bar";
  const blocks: HTMLSpanElement[] = [];
  for (let i = 0; i < BLOCK_COUNT; i++) {
    const block = document.createElement("span");
    block.className = "beat-block";
    bar.append(block);
    blocks.push(block);
  }

  const back = document.createElement("button");
  back.textContent = "‹";
  back.title = "nudge downbeat back one beat";
  back.addEventListener("click", () => callbacks.onNudge(-1));

  const tap = document.createElement("button");
  tap.textContent = "1";
  tap.title = "mark the current beat as beat 1";
  tap.addEventListener("click", () => callbacks.onTap());

  const fwd = document.createElement("button");
  fwd.textContent = "›";
  fwd.title = "nudge downbeat forward one beat";
  fwd.addEventListener("click", () => callbacks.onNudge(1));

  root.append(bpmText, bar, back, tap, fwd);
  return { root, bpmText, blocks };
}

export function updateBeatView(
  els: BeatViewElements,
  state: { bpm: number | null; barPosition: number; confidence: number },
): void {
  const bpmLabel = state.bpm === null ? "—" : state.bpm.toFixed(1);
  if (els.bpmText.textContent !== bpmLabel) els.bpmText.textContent = bpmLabel;
  els.root.classList.toggle("beat-low-confidence", state.confidence < CONFIDENT);
  els.blocks.forEach((block, i) => {
    block.classList.toggle("beat-block-active", i === state.barPosition && state.bpm !== null);
  });
}
