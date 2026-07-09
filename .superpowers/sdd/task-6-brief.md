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
