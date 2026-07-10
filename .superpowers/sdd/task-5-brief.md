### Task 5: Beat view UI (BPM readout, 4-block bar, controls)

**Files:**
- Create: `src/render/beatView.ts`
- Modify: `src/style.css`, `src/render/deckView.ts` (one line: expose `head`)

**Interfaces:**
- Produces:

```ts
export interface BeatViewElements {
  root: HTMLElement;
  bpmText: HTMLSpanElement;
  blocks: HTMLSpanElement[]; // length 4
}
export interface BeatViewCallbacks {
  onTap(): void;
  onNudge(delta: number): void;
}
export function createBeatView(callbacks: BeatViewCallbacks): BeatViewElements;
export function updateBeatView(
  els: BeatViewElements,
  state: { bpm: number | null; barPosition: number; confidence: number },
): void;
```

- `DeckElements` gains `head: HTMLElement` (the `.deck-head` div) so main.ts can append the beat view.

- [ ] **Step 1: Implement** `src/render/beatView.ts` (DOM module — no test infra for DOM; keep it logic-free):

```ts
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
```

- [ ] **Step 2:** In `src/render/deckView.ts`, add `head: HTMLElement` to `DeckElements` and include `head` in the object returned by `createDeckView` (it's the existing `.deck-head` div).

- [ ] **Step 3: Style** — append to `src/style.css`:

```css
.beat { display: flex; align-items: center; gap: 6px; margin-left: 12px; }
.beat-bpm { min-width: 52px; text-align: right; font-variant-numeric: tabular-nums; }
.beat-bar { display: inline-flex; gap: 3px; }
.beat-block { width: 14px; height: 14px; border-radius: 3px; background: #232a35; }
.beat-block-active { background: #4fd1ff; }
.beat-low-confidence { opacity: 0.45; }
.beat button { background: #1a2029; color: #d7dde5; border: 1px solid #2c3340; border-radius: 4px; padding: 1px 8px; cursor: pointer; }
.beat button:hover { background: #29313d; }
```

- [ ] **Step 4: Run** `npm test` and `npx tsc --noEmit` — all pass (no new tests; DOM-only module).
- [ ] **Step 5: Commit** `feat: beat view UI (bpm readout, bar blocks, tap/nudge)`

---

