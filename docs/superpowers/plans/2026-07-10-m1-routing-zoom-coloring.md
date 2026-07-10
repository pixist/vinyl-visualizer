# M1: Routing UI, Zoom Levels, 3-Band Coloring — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Per-deck channel routing controls, a global horizontal zoom, and 3-band frequency coloring of the waveform body.

**Architecture:** All DSP stays pure and main-thread (same as M0). Zoom = configurable samples-per-column threaded through `advanceDeck`. Routing = deck-header selects writing to the persisted config, restarting capture when running. Coloring = time-domain 3-band split (two one-pole low-passes) → per-column band RMS → blended RGB applied to the RMS body only (peak envelope keeps the deck identity color).

**Tech Stack:** TypeScript, Vite, vitest. No new dependencies.

## Global Constraints

- No new npm dependencies.
- Immutable patterns: DSP functions return new arrays, never mutate inputs.
- TDD: every task writes its failing test first; run `npm test` (vitest) and `npx tsc --noEmit`.
- Files stay under 800 lines; functions under 50.
- Existing public APIs keep working: `advanceDeck` keeps its current 5-arg call shape working via a default parameter.
- Commit after each task with conventional-commit messages. Do NOT add Co-Authored-By lines.
- The dev server (`npm run dev`) is usually already running on :5173 — don't start another.

---

### Task 1: Zoom level in config (`samplesPerColumn`)

**Files:**
- Modify: `src/config/decks.ts`
- Test: `src/config/decks.test.ts`

**Interfaces:**
- Produces: `AppConfig.samplesPerColumn: number`, `export const ZOOM_LEVELS = [64, 128, 256, 512, 1024] as const`, `export function clampSamplesPerColumn(v: unknown): number` (returns 256 for anything not in ZOOM_LEVELS).

- [ ] **Step 1: Write the failing tests** — append to `src/config/decks.test.ts` (import `ZOOM_LEVELS, clampSamplesPerColumn` from `./decks`):

```ts
describe("samplesPerColumn", () => {
  it("defaults to 256", () => {
    expect(defaultConfig().samplesPerColumn).toBe(256);
  });
  it("accepts only known zoom levels", () => {
    expect(clampSamplesPerColumn(128)).toBe(128);
    expect(clampSamplesPerColumn(300)).toBe(256);
    expect(clampSamplesPerColumn("512")).toBe(256);
    expect(clampSamplesPerColumn(undefined)).toBe(256);
  });
  it("normalizes samplesPerColumn from storage", () => {
    expect(normalize({ decks: [{}], samplesPerColumn: 1024 }).samplesPerColumn).toBe(1024);
    expect(normalize({ decks: [{}], samplesPerColumn: 7 }).samplesPerColumn).toBe(256);
    expect(normalize({ decks: [{}] }).samplesPerColumn).toBe(256);
  });
});
```

- [ ] **Step 2: Run** `npx vitest run src/config/decks.test.ts` — expect FAIL (missing exports).

- [ ] **Step 3: Implement** in `src/config/decks.ts`:

```ts
export const ZOOM_LEVELS = [64, 128, 256, 512, 1024] as const;
export const DEFAULT_SAMPLES_PER_COLUMN = 256;

/** Validate a zoom level from UI or storage; unknown values fall back to default. */
export function clampSamplesPerColumn(v: unknown): number {
  return typeof v === "number" && (ZOOM_LEVELS as readonly number[]).includes(v)
    ? v
    : DEFAULT_SAMPLES_PER_COLUMN;
}
```

Add `samplesPerColumn: number` to `AppConfig`; set `samplesPerColumn: DEFAULT_SAMPLES_PER_COLUMN` in `defaultConfig()`; in `normalize()` return `{ decks, samplesPerColumn: clampSamplesPerColumn((parsed as { samplesPerColumn?: unknown }).samplesPerColumn) }`.

- [ ] **Step 4: Run** `npm test` and `npx tsc --noEmit` — all pass.
- [ ] **Step 5: Commit** `feat: persist zoom level (samplesPerColumn) in config`

---

### Task 2: `advanceDeck` takes samples-per-column

**Files:**
- Modify: `src/render/scrollDriver.ts`
- Modify: `src/main.ts`
- Test: `src/render/scrollDriver.test.ts`

**Interfaces:**
- Consumes: `AppConfig.samplesPerColumn` (Task 1).
- Produces: `advanceDeck(stream, consumedHead, scratchL, scratchR, maxColumns, samplesPerColumn = SAMPLES_PER_COLUMN)` — 6th optional param; all M0 call sites keep working.

- [ ] **Step 1: Write the failing test** — append to `src/render/scrollDriver.test.ts`:

```ts
it("paces columns by the given samplesPerColumn", () => {
  const { writer, renderer, stream } = makeStream(48000);
  let consumed = advanceDeck(stream, null, scratch, scratch, 32, 64); // snap at 0
  writer.write(new Float32Array(3 * 64 + 5));
  consumed = advanceDeck(stream, consumed, scratch, scratch, 32, 64);
  expect(renderer.pushes[0]).toHaveLength(3);
  expect(consumed).toBe(3 * 64);
});
```

- [ ] **Step 2: Run** `npx vitest run src/render/scrollDriver.test.ts` — expect FAIL.

- [ ] **Step 3: Implement**: in `advanceDeck`, add trailing param `samplesPerColumn: number = SAMPLES_PER_COLUMN` and replace every internal use of `SAMPLES_PER_COLUMN` with it. In `src/main.ts`: size scratch for the largest zoom — `const scratchL = new Float32Array(MAX_COLUMNS * Math.max(...ZOOM_LEVELS));` (import `ZOOM_LEVELS` from config) — and pass `config.samplesPerColumn` as the 6th argument in `frame()`.

- [ ] **Step 4: Run** `npm test` and `npx tsc --noEmit` — all pass.
- [ ] **Step 5: Commit** `feat: thread samplesPerColumn through advanceDeck`

---

### Task 3: Zoom selector UI

**Files:**
- Modify: `index.html` (top bar), `src/main.ts`, `src/style.css`

**Interfaces:**
- Consumes: `ZOOM_LEVELS`, `clampSamplesPerColumn` (Task 1); `DeckRuntime.consumed` and `stream.renderer.clear()` (existing).

- [ ] **Step 1: Add the control.** In `index.html`, inside the top bar element (next to `#startBtn`), add:

```html
<label class="zoom">zoom <select id="zoomSelect"></select></label>
```

- [ ] **Step 2: Wire it** in `src/main.ts` (after config load):

```ts
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
```

- [ ] **Step 3: Style** in `src/style.css`: `.zoom { display: inline-flex; align-items: center; gap: 6px; margin-left: 16px; opacity: 0.85; }`

- [ ] **Step 4: Verify** `npm test`, `npx tsc --noEmit`, and load http://localhost:5173 — zoom select shows 5 levels, changing it clears and re-scales the scroll.
- [ ] **Step 5: Commit** `feat: global zoom selector`

---

### Task 4: Routing UI (channel mode + channel pickers)

**Files:**
- Modify: `src/render/deckView.ts`, `src/main.ts`, `src/style.css`

**Interfaces:**
- Consumes: `DeckConfig.mode/leftChannel/rightChannel`, `ChannelMode` (existing).
- Produces: `DeckCallbacks.onRoutingChange(deckId: string, patch: { mode?: ChannelMode; leftChannel?: number; rightChannel?: number | null }): void`; `export function populateChannelOptions(views, channelCounts: Map<string, number>, config): void` in deckView.

- [ ] **Step 1: Add controls** in `createDeckView` (after the device select), following the existing select pattern:

```ts
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
```

with the helper (module level):

```ts
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
  select.value = selected === null ? "" : String(selected);
}
```

Append to head: `head.append(label, deviceSelect, modeSelect, chSelectL, chSelectR, gainWrap, delayWrap);` and return the selects in `DeckElements` (`modeSelect`, `chSelectL`, `chSelectR`).

- [ ] **Step 2: Add `populateChannelOptions`** to deckView (called after capture starts, when real channel counts are known):

```ts
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
```

- [ ] **Step 3: Wire in `src/main.ts`:**

```ts
function onRoutingChange(
  deckId: string,
  patch: { mode?: ChannelMode; leftChannel?: number; rightChannel?: number | null },
): void {
  const deck = config.decks.find((d) => d.id === deckId);
  if (!deck) return;
  if (patch.mode !== undefined) deck.mode = patch.mode;
  if (patch.leftChannel !== undefined) deck.leftChannel = patch.leftChannel;
  if (patch.rightChannel !== undefined) deck.rightChannel = patch.rightChannel;
  saveConfig(localStorage, config);
  if (running) void restart(); // channel demand may have changed
}
```

Pass `onRoutingChange` in the `mountDecks` callbacks. In `startAll()` after `buildRuntimes()`, call:

```ts
populateChannelOptions(
  views,
  new Map(config.decks.map((d) => [d.id, handles.get(deviceKey(d))?.channelCount ?? 2])),
  config,
);
```

- [ ] **Step 4: Style**: `.deck-mode, .deck-ch { margin-left: 8px; }` (match `.deck-device` styling).
- [ ] **Step 5: Verify** `npm test`, `npx tsc --noEmit`; in the browser: switching L/R/mode changes the waveform, channel lists grow to the device's real channel count after Start.
- [ ] **Step 6: Commit** `feat: per-deck routing UI (mode + channel pickers)`

---

### Task 5: 3-band splitter (DSP)

**Files:**
- Create: `src/dsp/bandSplit.ts`
- Test: `src/dsp/bandSplit.test.ts`

**Interfaces:**
- Produces: `class BandSplitter { constructor(sampleRate: number); process(mono: Float32Array): { low: Float32Array; mid: Float32Array; high: Float32Array } }`. Bands sum exactly to the input. Stateful across calls (continuous filters). Crossovers: 200 Hz and 4000 Hz, one-pole low-passes.

- [ ] **Step 1: Write the failing tests** — `src/dsp/bandSplit.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { BandSplitter } from "./bandSplit";

const FS = 48000;

function rms(a: Float32Array): number {
  let s = 0;
  for (const v of a) s += v * v;
  return Math.sqrt(s / a.length);
}

describe("BandSplitter", () => {
  it("bands sum exactly to the input", () => {
    const s = new BandSplitter(FS);
    const x = new Float32Array(512).map(() => Math.random() * 2 - 1);
    const { low, mid, high } = s.process(x);
    for (let i = 0; i < x.length; i++) {
      expect(low[i]! + mid[i]! + high[i]!).toBeCloseTo(x[i]!, 5);
    }
  });

  it("routes a 50 Hz tone mostly to low", () => {
    const s = new BandSplitter(FS);
    const x = Float32Array.from({ length: 9600 }, (_, i) => Math.sin((2 * Math.PI * 50 * i) / FS));
    const { low, mid, high } = s.process(x);
    expect(rms(low)).toBeGreaterThan(rms(mid) * 2);
    expect(rms(low)).toBeGreaterThan(rms(high) * 2);
  });

  it("routes a 12 kHz tone mostly to high", () => {
    const s = new BandSplitter(FS);
    const x = Float32Array.from({ length: 9600 }, (_, i) => Math.sin((2 * Math.PI * 12000 * i) / FS));
    const { low, mid, high } = s.process(x);
    expect(rms(high)).toBeGreaterThan(rms(low) * 2);
    expect(rms(high)).toBeGreaterThan(rms(mid) * 2);
  });

  it("routes a 1 kHz tone mostly to mid", () => {
    const s = new BandSplitter(FS);
    const x = Float32Array.from({ length: 9600 }, (_, i) => Math.sin((2 * Math.PI * 1000 * i) / FS));
    const { low, mid, high } = s.process(x);
    expect(rms(mid)).toBeGreaterThan(rms(low) * 2);
    expect(rms(mid)).toBeGreaterThan(rms(high) * 2);
  });

  it("does not mutate its input and keeps filter state across calls", () => {
    const s = new BandSplitter(FS);
    const x = new Float32Array(64).fill(0.5);
    s.process(x);
    expect(Array.from(x)).toEqual(new Array(64).fill(0.5));
    // Second call continues from previous state: low output keeps rising toward DC.
    const second = s.process(x);
    expect(second.low[0]!).toBeGreaterThan(0.1);
  });
});
```

- [ ] **Step 2: Run** `npx vitest run src/dsp/bandSplit.test.ts` — expect FAIL (module missing).

- [ ] **Step 3: Implement** `src/dsp/bandSplit.ts`:

```ts
/**
 * Time-domain 3-band split for waveform coloring. Two one-pole low-passes
 * define the crossovers; bands reconstruct the input exactly:
 *   low = LP200(x), mid = LP4k(x) - LP200(x), high = x - LP4k(x).
 * Stateful: filters run continuously across process() calls, so feed each
 * deck's blocks in order through its own instance.
 */

const LOW_CROSSOVER_HZ = 200;
const HIGH_CROSSOVER_HZ = 4000;

export interface BandBlocks {
  low: Float32Array;
  mid: Float32Array;
  high: Float32Array;
}

class OnePoleLowPass {
  private y = 0;
  private readonly a: number;
  constructor(cutoffHz: number, sampleRate: number) {
    this.a = 1 - Math.exp((-2 * Math.PI * cutoffHz) / sampleRate);
  }
  next(x: number): number {
    this.y += this.a * (x - this.y);
    return this.y;
  }
}

export class BandSplitter {
  private readonly lpLow: OnePoleLowPass;
  private readonly lpHigh: OnePoleLowPass;

  constructor(sampleRate: number) {
    this.lpLow = new OnePoleLowPass(LOW_CROSSOVER_HZ, sampleRate);
    this.lpHigh = new OnePoleLowPass(HIGH_CROSSOVER_HZ, sampleRate);
  }

  /** Split one block. Returns new arrays; never mutates `mono`. */
  process(mono: Float32Array): BandBlocks {
    const n = mono.length;
    const low = new Float32Array(n);
    const mid = new Float32Array(n);
    const high = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = mono[i]!;
      const l = this.lpLow.next(x);
      const m = this.lpHigh.next(x);
      low[i] = l;
      mid[i] = m - l;
      high[i] = x - m;
    }
    return { low, mid, high };
  }
}
```

- [ ] **Step 4: Run** `npm test` and `npx tsc --noEmit` — all pass.
- [ ] **Step 5: Commit** `feat: 3-band time-domain splitter for waveform coloring`

---

### Task 6: Band colors on the waveform body

**Files:**
- Create: `src/render/bandColor.ts`
- Modify: `src/dsp/waveformBinner.ts`, `src/render/scrollDriver.ts`, `src/render/waveformRenderer.ts`, `src/main.ts`
- Test: `src/render/bandColor.test.ts`, `src/dsp/waveformBinner.test.ts`, `src/render/waveformRenderer.test.ts`

**Interfaces:**
- Consumes: `BandSplitter` (Task 5).
- Produces:
  - `export function rmsBins(samples: Float32Array, binCount: number): number[]` in waveformBinner.
  - `export function colorForBands(low: number, mid: number, high: number): string | null` in bandColor (null when all zero).
  - `WaveformRenderer.pushColumns(bins: RenderColumn[])` where `export interface RenderColumn extends WaveformBin { color?: string }` (in waveformRenderer). RMS body uses `bin.color ?? deckColor`; peak envelope always deckColor.
  - `DeckStreams.bands?: BandSplitter` (optional; undefined = no coloring).

- [ ] **Step 1: Write the failing tests.**

`src/render/bandColor.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { colorForBands, BAND_COLORS } from "./bandColor";

describe("colorForBands", () => {
  it("returns the pure band color for a single-band signal", () => {
    expect(colorForBands(1, 0, 0)).toBe(`rgb(${BAND_COLORS.low.join(",")})`);
    expect(colorForBands(0, 0, 1)).toBe(`rgb(${BAND_COLORS.high.join(",")})`);
  });
  it("blends proportionally to band energy", () => {
    const mixed = colorForBands(1, 1, 0)!;
    const [r, g, b] = mixed.match(/\d+/g)!.map(Number);
    expect(r).toBe(Math.round((BAND_COLORS.low[0] + BAND_COLORS.mid[0]) / 2));
    expect(g).toBe(Math.round((BAND_COLORS.low[1] + BAND_COLORS.mid[1]) / 2));
    expect(b).toBe(Math.round((BAND_COLORS.low[2] + BAND_COLORS.mid[2]) / 2));
  });
  it("returns null for silence", () => {
    expect(colorForBands(0, 0, 0)).toBeNull();
  });
});
```

Append to `src/dsp/waveformBinner.test.ts`:

```ts
import { rmsBins } from "./waveformBinner";

describe("rmsBins", () => {
  it("computes per-bin rms", () => {
    const samples = new Float32Array([1, 1, 0, 0]);
    expect(rmsBins(samples, 2)).toEqual([1, 0]);
  });
  it("emits 0 for empty bins", () => {
    expect(rmsBins(new Float32Array(0), 2)).toEqual([0, 0]);
  });
});
```

Append to `src/render/waveformRenderer.test.ts` (uses existing fakes; `bin()` helper gains an optional color):

```ts
it("uses the per-bin color for the RMS body and the deck color for the peak envelope", () => {
  const { canvas, renderer } = makeRenderer();
  renderer.pushColumns([{ min: -0.5, max: 0.5, rms: 0.3, color: "rgb(1,2,3)" }]);
  const fillStyles: string[] = [];
  // FakeCtx records fillStyle at each fillRect — extend FakeCtx.fillRect to push
  // ["fillRect", x, y, w, h, this.fillStyle] and assert:
  const fills = canvas.ctx.ops.filter(([name]) => name === "fillRect");
  expect(fills[0]![5]).toBe("#123456");     // peak envelope: deck color
  expect(fills[1]![5]).toBe("rgb(1,2,3)");  // rms body: band color
});
```

(Extend `FakeCtx.fillRect` in the test file to record `this.fillStyle` as shown.)

- [ ] **Step 2: Run** `npm test` — expect FAIL.

- [ ] **Step 3: Implement.**

`src/render/bandColor.ts`:

```ts
/** Serato-style band palette: low = red, mid = green, high = blue. */
export const BAND_COLORS = {
  low: [235, 70, 70],
  mid: [80, 200, 120],
  high: [90, 140, 255],
} as const;

/**
 * Blend the band palette weighted by per-band RMS. Returns a CSS rgb() string,
 * or null for silence (caller falls back to the deck color).
 */
export function colorForBands(low: number, mid: number, high: number): string | null {
  const total = low + mid + high;
  if (total <= 0) return null;
  const ch = (i: 0 | 1 | 2) =>
    Math.round((low * BAND_COLORS.low[i] + mid * BAND_COLORS.mid[i] + high * BAND_COLORS.high[i]) / total);
  return `rgb(${ch(0)},${ch(1)},${ch(2)})`;
}
```

`src/dsp/waveformBinner.ts` — add:

```ts
/** Per-bin RMS using the same bin edges as binWaveform. Empty bins emit 0. */
export function rmsBins(samples: Float32Array, binCount: number): number[] {
  if (!Number.isInteger(binCount) || binCount <= 0) {
    throw new Error(`binCount must be a positive integer, got ${binCount}`);
  }
  const out: number[] = new Array(binCount);
  const n = samples.length;
  for (let b = 0; b < binCount; b++) {
    const start = Math.floor((b * n) / binCount);
    const end = Math.floor(((b + 1) * n) / binCount);
    if (end <= start) { out[b] = 0; continue; }
    let sumSq = 0;
    for (let i = start; i < end; i++) sumSq += samples[i]! * samples[i]!;
    out[b] = Math.sqrt(sumSq / (end - start));
  }
  return out;
}
```

`src/render/waveformRenderer.ts` — add and use:

```ts
export interface RenderColumn extends WaveformBin {
  color?: string; // RMS-body color; peak envelope always uses the deck color
}
```

`pushColumns(bins: RenderColumn[])`; in the column loop set `ctx.fillStyle = this.color` before the peak fillRect and `ctx.fillStyle = bin.color ?? this.color` before the RMS fillRect (move the existing single `fillStyle` assignment into the loop).

`src/render/scrollDriver.ts` — `DeckStreams` gains `bands?: BandSplitter` (import from `../dsp/bandSplit`). After computing `mono`:

```ts
const bins: RenderColumn[] = binWaveform(mono, columns);
if (stream.bands) {
  const { low, mid, high } = stream.bands.process(mono);
  const l = rmsBins(low, columns), m = rmsBins(mid, columns), h = rmsBins(high, columns);
  for (let i = 0; i < columns; i++) {
    const c = colorForBands(l[i]!, m[i]!, h[i]!);
    if (c) bins[i]!.color = c;
  }
}
stream.renderer.pushColumns(bins);
```

`src/main.ts` — in `buildRuntimes()`, add `bands: new BandSplitter(handle.sampleRate)` to the stream object (import from `./dsp/bandSplit`).

- [ ] **Step 4: Run** `npm test` and `npx tsc --noEmit` — all pass. Load http://localhost:5173: bass-heavy passages render red-ish, hi-hats blue-ish.
- [ ] **Step 5: Commit** `feat: 3-band frequency coloring of waveform body`

---

## Self-Review Notes

- Spec coverage: routing UI (Task 4), zoom (Tasks 1–3), 3-band coloring (Tasks 5–6). ✔
- `advanceDeck` default param keeps M0 tests valid until Task 2 updates call sites. ✔
- Type names consistent: `RenderColumn`, `BandSplitter`, `rmsBins`, `colorForBands`, `onRoutingChange`. ✔
- `stereo` mode still displays as mono sum (true stereo lanes deferred — YAGNI until asked). ✔
