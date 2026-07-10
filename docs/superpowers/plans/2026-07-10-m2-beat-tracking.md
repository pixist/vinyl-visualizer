# M2: BPM Detection, Beat Tracking, Bar Indicator — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Per-deck BPM detection with drift tracking (spectral-flux onsets → autocorrelation tempo → PLL beat tracker), a 4-block bar indicator, and tap-1 / nudge downbeat controls.

**Architecture:** All DSP is pure TypeScript on the main thread (same as M0/M1 — the per-hop work is tiny). A per-deck `BeatEngine` consumes the deck's ring buffers independently of the waveform path at a fixed 256-sample hop: OnsetDetector (Hann + 1024-pt FFT + half-wave-rectified spectral flux) → rolling flux history → periodic autocorrelation tempo estimate → PLL beat tracker that phase-locks predicted beats to observed onsets and drift-tracks tempo. UI is a small DOM module per deck.

**Tech Stack:** TypeScript, Vite, vitest. No new dependencies (FFT is hand-rolled, ~50 lines).

**Task order:** 1 → 2 → 3 → 4 → 6; Task 5 is independent of 2–4 and can run any time after 1. Suggested implementer models: Tasks 1–3, 5: mid-tier; Task 4 and 6: most capable available (PLL tuning and integration judgment).

## Global Constraints

- No new npm dependencies.
- Immutable inputs: DSP functions/classes never mutate arrays passed to them.
- TDD: failing test first; `npm test` (vitest) and `npx tsc --noEmit` pass before every commit.
- Files < 800 lines, functions < 50 lines; named constants for all tuning values.
- Fixed analysis parameters everywhere: FFT frame 1024, hop 256 samples. BPM search range 70–180.
- Conventional commits. Do NOT add Co-Authored-By lines.
- A dev server is usually already running on :5173 — never start another.
- If a Task 4 lock-quality test fails marginally, tune the exported gain constants rather than restructuring; note the change in the report.

---

### Task 1: Radix-2 FFT magnitudes

**Files:**
- Create: `src/dsp/fft.ts`
- Test: `src/dsp/fft.test.ts`

**Interfaces:**
- Produces: `export function fftMagnitudes(frame: Float32Array): Float32Array` — input length must be a power of two (throws otherwise); returns `frame.length / 2` magnitudes (bins 0 .. N/2−1). Never mutates `frame`.

- [ ] **Step 1: Write the failing tests** — `src/dsp/fft.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { fftMagnitudes } from "./fft";

describe("fftMagnitudes", () => {
  it("throws on non-power-of-two input", () => {
    expect(() => fftMagnitudes(new Float32Array(100))).toThrow(/power of two/);
  });

  it("returns N/2 bins", () => {
    expect(fftMagnitudes(new Float32Array(1024))).toHaveLength(512);
  });

  it("puts a DC signal entirely in bin 0", () => {
    const mags = fftMagnitudes(new Float32Array(64).fill(1));
    expect(mags[0]).toBeCloseTo(64, 5);
    for (let k = 1; k < 32; k++) expect(mags[k]).toBeCloseTo(0, 5);
  });

  it("puts a bin-k sine at bin k with magnitude N/2", () => {
    const N = 256, k = 10;
    const x = Float32Array.from({ length: N }, (_, i) => Math.sin((2 * Math.PI * k * i) / N));
    const mags = fftMagnitudes(x);
    expect(mags[k]).toBeCloseTo(N / 2, 3);
    expect(mags[k - 1]).toBeCloseTo(0, 3);
    expect(mags[k + 1]).toBeCloseTo(0, 3);
  });

  it("gives an impulse a flat spectrum", () => {
    const x = new Float32Array(64);
    x[0] = 1;
    const mags = fftMagnitudes(x);
    for (let k = 0; k < 32; k++) expect(mags[k]).toBeCloseTo(1, 5);
  });

  it("does not mutate its input", () => {
    const x = Float32Array.from({ length: 8 }, (_, i) => i);
    fftMagnitudes(x);
    expect(Array.from(x)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });
});
```

- [ ] **Step 2: Run** `npx vitest run src/dsp/fft.test.ts` — expect FAIL (module missing).

- [ ] **Step 3: Implement** `src/dsp/fft.ts`:

```ts
/**
 * Minimal iterative radix-2 FFT, real input, magnitude output. Used for
 * spectral-flux onset detection where phase is irrelevant. Hand-rolled to
 * keep the project dependency-free; 1024-point frames cost ~10µs.
 */

/** Magnitudes of the first N/2 bins of the DFT of `frame` (length power of 2). */
export function fftMagnitudes(frame: Float32Array): Float32Array {
  const n = frame.length;
  if (n === 0 || (n & (n - 1)) !== 0) {
    throw new Error(`FFT frame length must be a power of two, got ${n}`);
  }
  const re = Float32Array.from(frame);
  const im = new Float32Array(n);

  // Bit-reversal permutation.
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i]!; re[i] = re[j]!; re[j] = tr;
    }
  }

  // Butterflies.
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wRe = Math.cos(ang);
    const wIm = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let curRe = 1, curIm = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = i + k + len / 2;
        const tRe = re[b]! * curRe - im[b]! * curIm;
        const tIm = re[b]! * curIm + im[b]! * curRe;
        re[b] = re[a]! - tRe; im[b] = im[a]! - tIm;
        re[a] = re[a]! + tRe; im[a] = im[a]! + tIm;
        const nRe = curRe * wRe - curIm * wIm;
        curIm = curRe * wIm + curIm * wRe;
        curRe = nRe;
      }
    }
  }

  const mags = new Float32Array(n / 2);
  for (let k = 0; k < n / 2; k++) mags[k] = Math.hypot(re[k]!, im[k]!);
  return mags;
}
```

- [ ] **Step 4: Run** `npm test` and `npx tsc --noEmit` — all pass.
- [ ] **Step 5: Commit** `feat: radix-2 FFT magnitudes for onset detection`

---

### Task 2: Spectral-flux onset detector

**Files:**
- Create: `src/dsp/onsetDetector.ts`
- Test: `src/dsp/onsetDetector.test.ts`

**Interfaces:**
- Consumes: `fftMagnitudes` (Task 1).
- Produces: `export class OnsetDetector { constructor(frameSize = 1024, hopSize = 256); readonly hopSize: number; feed(samples: Float32Array): number[] }` — buffers arbitrary-sized input; emits one spectral-flux value per completed hop (half-wave-rectified magnitude increase summed over bins, Hann-windowed frames). Stateful across calls; never mutates input.

- [ ] **Step 1: Write the failing tests** — `src/dsp/onsetDetector.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { OnsetDetector } from "./onsetDetector";

function feedAll(d: OnsetDetector, samples: Float32Array): number[] {
  return d.feed(samples);
}

describe("OnsetDetector", () => {
  it("emits one flux value per completed hop", () => {
    const d = new OnsetDetector(1024, 256);
    // First frame completes after 1024 samples; each further 256 completes another.
    expect(d.feed(new Float32Array(1023))).toHaveLength(0);
    expect(d.feed(new Float32Array(1))).toHaveLength(1);
    expect(d.feed(new Float32Array(512))).toHaveLength(2);
  });

  it("reports near-zero flux for silence and a spike at a noise burst", () => {
    const d = new OnsetDetector(1024, 256);
    const silence = new Float32Array(4096);
    const burst = Float32Array.from({ length: 4096 }, (_, i) =>
      i >= 2048 && i < 2048 + 512 ? (Math.random() * 2 - 1) : 0);
    const quiet = feedAll(d, silence);
    const active = feedAll(d, burst);
    const maxQuiet = Math.max(...quiet, 0);
    const maxActive = Math.max(...active);
    expect(maxActive).toBeGreaterThan(maxQuiet * 10 + 1e-6);
  });

  it("is chunking-invariant", () => {
    const signal = Float32Array.from({ length: 8192 }, (_, i) =>
      Math.sin(i / 30) * (i > 4000 ? 1 : 0.05));
    const a = new OnsetDetector(1024, 256);
    const whole = a.feed(signal);
    const b = new OnsetDetector(1024, 256);
    const parts: number[] = [];
    for (let off = 0; off < signal.length; off += 300) {
      parts.push(...b.feed(signal.subarray(off, Math.min(off + 300, signal.length))));
    }
    expect(parts).toHaveLength(whole.length);
    for (let i = 0; i < whole.length; i++) expect(parts[i]).toBeCloseTo(whole[i]!, 4);
  });

  it("does not mutate its input", () => {
    const d = new OnsetDetector(1024, 256);
    const x = new Float32Array(2048).fill(0.5);
    d.feed(x);
    expect(x[0]).toBe(0.5);
    expect(x[2047]).toBe(0.5);
  });
});
```

- [ ] **Step 2: Run** `npx vitest run src/dsp/onsetDetector.test.ts` — expect FAIL.

- [ ] **Step 3: Implement** `src/dsp/onsetDetector.ts`:

```ts
import { fftMagnitudes } from "./fft";

/**
 * Spectral-flux onset detector: Hann-windowed FFT frames at a fixed hop;
 * flux = sum over bins of the half-wave-rectified magnitude increase vs the
 * previous frame. Percussive onsets (kicks, snares) produce sharp flux peaks.
 * Stateful: keep one instance per continuous audio stream.
 */
export class OnsetDetector {
  readonly hopSize: number;
  private readonly frameSize: number;
  private readonly window: Float32Array;
  private readonly pending: number[] = []; // buffered samples not yet framed
  private prevMags: Float32Array | null = null;
  private readonly frame: Float32Array;

  constructor(frameSize = 1024, hopSize = 256) {
    if (hopSize <= 0 || frameSize <= 0 || frameSize % hopSize !== 0) {
      throw new Error(`frameSize must be a positive multiple of hopSize`);
    }
    this.frameSize = frameSize;
    this.hopSize = hopSize;
    this.frame = new Float32Array(frameSize);
    this.window = Float32Array.from({ length: frameSize }, (_, i) =>
      0.5 * (1 - Math.cos((2 * Math.PI * i) / (frameSize - 1))));
  }

  /** Feed any number of samples; returns one flux value per completed hop. */
  feed(samples: Float32Array): number[] {
    const out: number[] = [];
    for (let i = 0; i < samples.length; i++) {
      this.pending.push(samples[i]!);
      if (this.pending.length === this.frameSize) {
        out.push(this.processFrame());
        this.pending.splice(0, this.hopSize); // slide by one hop
      }
    }
    return out;
  }

  private processFrame(): number {
    for (let i = 0; i < this.frameSize; i++) {
      this.frame[i] = this.pending[i]! * this.window[i]!;
    }
    const mags = fftMagnitudes(this.frame);
    let flux = 0;
    if (this.prevMags) {
      for (let k = 0; k < mags.length; k++) {
        const d = mags[k]! - this.prevMags[k]!;
        if (d > 0) flux += d;
      }
    }
    this.prevMags = mags;
    return flux;
  }
}
```

- [ ] **Step 4: Run** `npm test` and `npx tsc --noEmit` — all pass.
- [ ] **Step 5: Commit** `feat: spectral-flux onset detector`

---

### Task 3: Autocorrelation tempo estimator

**Files:**
- Create: `src/dsp/tempoEstimator.ts`
- Test: `src/dsp/tempoEstimator.test.ts`

**Interfaces:**
- Consumes: flux arrays from Task 2 (any `number[]`).
- Produces: `export function estimateBpm(flux: number[], hopSeconds: number, minBpm = 70, maxBpm = 180): { bpm: number; confidence: number } | null` — autocorrelation of the mean-subtracted flux over the BPM lag range, parabolic-interpolated peak; `confidence` in [0, 1] (normalized by zero-lag energy); `null` when the window is too short (< 2× the longest lag) or the signal is flat.

- [ ] **Step 1: Write the failing tests** — `src/dsp/tempoEstimator.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { estimateBpm } from "./tempoEstimator";

const HOP_S = 256 / 48000; // ≈5.333 ms

/** Impulse train at `bpm` over `seconds`, with small noise floor. */
function fluxTrain(bpm: number, seconds: number): number[] {
  const hops = Math.floor(seconds / HOP_S);
  const beatHops = 60 / bpm / HOP_S;
  const out = new Array<number>(hops).fill(0);
  for (let i = 0; i < hops; i++) out[i] = 0.05 * ((i * 7919) % 13) / 13;
  for (let b = 0; b * beatHops < hops; b++) out[Math.round(b * beatHops)] = 10;
  return out;
}

describe("estimateBpm", () => {
  it("finds a 120 BPM impulse train within 1 BPM", () => {
    const r = estimateBpm(fluxTrain(120, 12), HOP_S);
    expect(r).not.toBeNull();
    expect(r!.bpm).toBeGreaterThan(119);
    expect(r!.bpm).toBeLessThan(121);
  });

  it("finds an off-grid tempo (133 BPM) within 1 BPM", () => {
    const r = estimateBpm(fluxTrain(133, 12), HOP_S);
    expect(r!.bpm).toBeGreaterThan(132);
    expect(r!.bpm).toBeLessThan(134);
  });

  it("returns null for a too-short window", () => {
    expect(estimateBpm(fluxTrain(120, 1), HOP_S)).toBeNull();
  });

  it("returns null for flat silence", () => {
    expect(estimateBpm(new Array(4000).fill(0), HOP_S)).toBeNull();
  });

  it("gives a clean train higher confidence than noise", () => {
    const clean = estimateBpm(fluxTrain(120, 12), HOP_S)!;
    const noise = new Array(2250).fill(0).map((_, i) => ((i * 104729) % 997) / 997);
    const noisy = estimateBpm(noise, HOP_S);
    if (noisy) expect(clean.confidence).toBeGreaterThan(noisy.confidence);
    expect(clean.confidence).toBeGreaterThan(0.3);
  });

  it("respects the BPM search range", () => {
    const r = estimateBpm(fluxTrain(120, 12), HOP_S, 70, 180);
    expect(r!.bpm).toBeGreaterThanOrEqual(70);
    expect(r!.bpm).toBeLessThanOrEqual(180);
  });
});
```

- [ ] **Step 2: Run** `npx vitest run src/dsp/tempoEstimator.test.ts` — expect FAIL.

- [ ] **Step 3: Implement** `src/dsp/tempoEstimator.ts`:

```ts
/**
 * Tempo from an onset-flux sequence via autocorrelation over the BPM lag
 * range, with parabolic interpolation for sub-lag precision. Pure function:
 * call periodically over a rolling flux window (~8–12s) and feed the result
 * to the beat tracker as a drift anchor.
 */

export interface TempoEstimate {
  bpm: number;
  confidence: number; // 0..1, autocorrelation peak / zero-lag energy
}

export function estimateBpm(
  flux: number[],
  hopSeconds: number,
  minBpm = 70,
  maxBpm = 180,
): TempoEstimate | null {
  const maxLag = Math.ceil(60 / minBpm / hopSeconds);
  const minLag = Math.floor(60 / maxBpm / hopSeconds);
  const n = flux.length;
  if (n < 2 * maxLag || minLag < 1) return null;

  const mean = flux.reduce((s, v) => s + v, 0) / n;
  const x = flux.map((v) => v - mean);

  let energy = 0;
  for (const v of x) energy += v * v;
  if (energy <= 1e-12) return null;

  const acf = new Array<number>(maxLag + 2).fill(0);
  for (let lag = minLag - 1; lag <= Math.min(maxLag + 1, n - 1); lag++) {
    let s = 0;
    for (let i = lag; i < n; i++) s += x[i]! * x[i - lag]!;
    acf[lag] = s;
  }

  let bestLag = -1;
  let bestVal = -Infinity;
  for (let lag = minLag; lag <= maxLag; lag++) {
    if (acf[lag]! > bestVal) {
      bestVal = acf[lag]!;
      bestLag = lag;
    }
  }
  if (bestLag < 0 || bestVal <= 0) return null;

  // Parabolic interpolation around the peak for sub-lag precision.
  const y0 = acf[bestLag - 1] ?? 0;
  const y1 = acf[bestLag]!;
  const y2 = acf[bestLag + 1] ?? 0;
  const denom = y0 - 2 * y1 + y2;
  const offset = denom === 0 ? 0 : Math.max(-0.5, Math.min(0.5, (0.5 * (y0 - y2)) / denom));
  const lag = bestLag + offset;

  const bpm = 60 / (lag * hopSeconds);
  const confidence = Math.max(0, Math.min(1, bestVal / energy));
  if (bpm < minBpm || bpm > maxBpm) return null;
  return { bpm, confidence };
}
```

- [ ] **Step 4: Run** `npm test` and `npx tsc --noEmit` — all pass.
- [ ] **Step 5: Commit** `feat: autocorrelation tempo estimator`

---

### Task 4: PLL beat tracker with tap-1 / nudge

**Files:**
- Create: `src/dsp/beatTracker.ts`
- Test: `src/dsp/beatTracker.test.ts`

**Interfaces:**
- Consumes: per-hop flux values (Task 2) and `TempoEstimate | null` hints (Task 3).
- Produces:

```ts
export class BeatTracker {
  constructor(hopSeconds: number);
  update(flux: number, hint: TempoEstimate | null): void; // call once per hop, in order
  get bpm(): number | null;
  phase(): number;          // 0..1 position within the current beat (0 = on the beat)
  barPosition(): number;    // 0..3, which beat of the bar we're in
  confidence: number;       // 0..1
  tap1(): void;             // mark the current beat as beat 1 of the bar
  nudge(delta: number): void; // shift the bar alignment by ±delta beats
}
```

- [ ] **Step 1: Write the failing tests** — `src/dsp/beatTracker.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { BeatTracker } from "./beatTracker";

const HOP_S = 256 / 48000;

/**
 * Drives a tracker with a synthetic impulse train. `bpmOf(t)` lets tests ramp
 * the tempo. Returns the tracker for assertions.
 */
function drive(
  tracker: BeatTracker,
  seconds: number,
  bpmOf: (t: number) => number,
  hint: (t: number) => { bpm: number; confidence: number } | null,
): BeatTracker {
  let t = 0;
  let nextBeat = 0;
  while (t < seconds) {
    let flux = 0.1;
    if (t >= nextBeat) {
      flux = 10;
      nextBeat += 60 / bpmOf(t);
    }
    tracker.update(flux, hint(t));
    t += HOP_S;
  }
  return tracker;
}

describe("BeatTracker", () => {
  it("has no bpm before any tempo hint", () => {
    const tr = new BeatTracker(HOP_S);
    for (let i = 0; i < 100; i++) tr.update(0.1, null);
    expect(tr.bpm).toBeNull();
  });

  it("locks to a steady 128 BPM train", () => {
    const tr = new BeatTracker(HOP_S);
    drive(tr, 15, () => 128, (t) => (t < 1 ? { bpm: 128, confidence: 1 } : null));
    expect(tr.bpm).not.toBeNull();
    expect(tr.bpm!).toBeGreaterThan(126.5);
    expect(tr.bpm!).toBeLessThan(129.5);
    expect(tr.confidence).toBeGreaterThan(0.5);
  });

  it("drift-tracks a slow tempo ramp 120 -> 126", () => {
    const tr = new BeatTracker(HOP_S);
    drive(tr, 30, (t) => 120 + (6 * Math.min(t, 25)) / 25,
      (t) => (t < 1 ? { bpm: 120, confidence: 1 } : null));
    expect(tr.bpm!).toBeGreaterThan(123.5);
    expect(tr.bpm!).toBeLessThan(128.5);
  });

  it("cycles barPosition 0..3 over four beats", () => {
    const tr = new BeatTracker(HOP_S);
    const seen = new Set<number>();
    let t = 0, nextBeat = 0;
    // Warm up with lock first.
    drive(tr, 5, () => 120, (tt) => (tt < 1 ? { bpm: 120, confidence: 1 } : null));
    for (let i = 0; i < Math.round(2 / HOP_S); i++) {
      let flux = 0.1;
      if (t >= nextBeat) { flux = 10; nextBeat += 0.5; }
      tr.update(flux, null);
      seen.add(tr.barPosition());
      t += HOP_S;
    }
    expect([...seen].sort()).toEqual([0, 1, 2, 3]);
  });

  it("tap1 makes the current beat position 0 and nudge shifts it", () => {
    const tr = new BeatTracker(HOP_S);
    drive(tr, 10, () => 120, (t) => (t < 1 ? { bpm: 120, confidence: 1 } : null));
    tr.tap1();
    expect(tr.barPosition()).toBe(0);
    tr.nudge(1);
    expect(tr.barPosition()).toBe(3); // bar start moved forward one beat
    tr.nudge(-1);
    expect(tr.barPosition()).toBe(0);
  });

  it("ignores octave-jump hints once locked", () => {
    const tr = new BeatTracker(HOP_S);
    drive(tr, 10, () => 128, (t) => (t < 1 ? { bpm: 128, confidence: 1 } : null));
    const before = tr.bpm!;
    for (let i = 0; i < 200; i++) tr.update(0.1, { bpm: 64, confidence: 0.9 });
    expect(Math.abs(tr.bpm! - before)).toBeLessThan(2);
  });
});
```

- [ ] **Step 2: Run** `npx vitest run src/dsp/beatTracker.test.ts` — expect FAIL.

- [ ] **Step 3: Implement** `src/dsp/beatTracker.ts`:

```ts
import type { TempoEstimate } from "./tempoEstimator";

/**
 * Phase-locked-loop beat tracker. Time advances one hop per update(). The
 * autocorrelation tempo hint seeds and slowly anchors the period; observed
 * onset peaks near the predicted beat pull phase (strongly) and period
 * (weakly), which tracks vinyl drift. Beats count monotonically; the bar
 * indicator is beatIndex modulo 4 with a user-settable offset (tap-1/nudge).
 */

const PHASE_GAIN = 0.3;        // fraction of phase error corrected per onset
const PERIOD_GAIN = 0.05;      // fraction of phase error fed into the period
const TEMPO_BLEND = 0.02;      // per-update blend toward a confident hint
const HINT_MIN_CONFIDENCE = 0.2;
const HINT_MAX_DEVIATION = 0.1; // ignore hints >10% off the locked period
const ONSET_WINDOW = 0.25;     // accept onsets within ±25% of the period
const FLUX_MEAN_DECAY = 0.995; // adaptive threshold time constant
const FLUX_THRESHOLD = 2.5;    // onset = flux > mean * this
const CONFIDENCE_UP = 0.1;
const CONFIDENCE_DECAY = 0.001;
const BEATS_PER_BAR = 4;
const MIN_PERIOD_S = 60 / 200;

export class BeatTracker {
  confidence = 0;

  private time = 0;
  private period: number | null = null;
  private nextBeat = 0;
  private beatIndex = -1;
  private barOffset = 0;
  private fluxMean = 0;
  private prevFlux = 0;
  private prevPrevFlux = 0;

  constructor(private readonly hopSeconds: number) {}

  get bpm(): number | null {
    return this.period === null ? null : 60 / this.period;
  }

  update(flux: number, hint: TempoEstimate | null): void {
    this.time += this.hopSeconds;
    this.fluxMean = FLUX_MEAN_DECAY * this.fluxMean + (1 - FLUX_MEAN_DECAY) * flux;

    this.applyHint(hint);
    if (this.period !== null) {
      this.trackOnset(flux);
      while (this.time >= this.nextBeat) {
        this.beatIndex++;
        this.nextBeat += this.period;
      }
    }

    this.prevPrevFlux = this.prevFlux;
    this.prevFlux = flux;
  }

  /** 0..1 position within the current beat (0 = just on the beat). */
  phase(): number {
    if (this.period === null) return 0;
    const untilNext = this.nextBeat - this.time;
    return Math.min(1, Math.max(0, 1 - untilNext / this.period));
  }

  barPosition(): number {
    if (this.beatIndex < 0) return 0;
    return (((this.beatIndex - this.barOffset) % BEATS_PER_BAR) + BEATS_PER_BAR) % BEATS_PER_BAR;
  }

  tap1(): void {
    if (this.beatIndex >= 0) this.barOffset = ((this.beatIndex % BEATS_PER_BAR) + BEATS_PER_BAR) % BEATS_PER_BAR;
  }

  nudge(delta: number): void {
    this.barOffset = (((this.barOffset + delta) % BEATS_PER_BAR) + BEATS_PER_BAR) % BEATS_PER_BAR;
  }

  private applyHint(hint: TempoEstimate | null): void {
    if (!hint || hint.confidence < HINT_MIN_CONFIDENCE) return;
    const hintPeriod = 60 / hint.bpm;
    if (this.period === null) {
      this.period = hintPeriod;
      this.nextBeat = this.time + hintPeriod;
      return;
    }
    if (Math.abs(hintPeriod - this.period) / this.period <= HINT_MAX_DEVIATION) {
      this.period += TEMPO_BLEND * (hintPeriod - this.period);
    }
  }

  private trackOnset(flux: number): void {
    // One-hop-delayed local-max decision so we see both neighbours.
    const isOnset =
      this.prevFlux > this.fluxMean * FLUX_THRESHOLD &&
      this.prevFlux >= this.prevPrevFlux &&
      this.prevFlux >= flux;
    if (!isOnset) {
      this.confidence = Math.max(0, this.confidence - CONFIDENCE_DECAY);
      return;
    }
    const onsetTime = this.time - this.hopSeconds;
    // Compare against the nearest predicted beat (previous or next).
    const prevBeat = this.nextBeat - this.period!;
    const errNext = onsetTime - this.nextBeat;
    const errPrev = onsetTime - prevBeat;
    const err = Math.abs(errPrev) < Math.abs(errNext) ? errPrev : errNext;
    if (Math.abs(err) <= this.period! * ONSET_WINDOW) {
      this.nextBeat += PHASE_GAIN * err;
      this.period = Math.max(MIN_PERIOD_S, this.period! + PERIOD_GAIN * err);
      this.confidence = Math.min(1, this.confidence + CONFIDENCE_UP);
    }
  }
}
```

- [ ] **Step 4: Run** `npm test` and `npx tsc --noEmit` — all pass. If a lock test misses narrowly, tune the exported gain constants (per Global Constraints) and note it.
- [ ] **Step 5: Commit** `feat: PLL beat tracker with tap-1 and nudge`

---

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

### Task 6: BeatEngine + main-loop wiring

**Files:**
- Create: `src/audio/beatEngine.ts`
- Modify: `src/main.ts`
- Test: `src/audio/beatEngine.test.ts`

**Interfaces:**
- Consumes: `RingReader` (src/audio/ringBuffer.ts), `mixToMono`/`ChannelMode` (src/util/channelMix.ts), `OnsetDetector` (Task 2), `estimateBpm` (Task 3), `BeatTracker` (Task 4), `createBeatView`/`updateBeatView` (Task 5), `DeckElements.head` (Task 5).
- Produces:

```ts
export class BeatEngine {
  constructor(left: RingReader, right: RingReader | null, mode: ChannelMode, sampleRate: number);
  advance(): void; // consume all complete new hops since the last call
  state(): { bpm: number | null; barPosition: number; confidence: number };
  tap1(): void;
  nudge(delta: number): void;
}
```

- [ ] **Step 1: Write the failing test** — `src/audio/beatEngine.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createRingBuffer, RingWriter, RingReader } from "./ringBuffer";
import { BeatEngine } from "./beatEngine";

const FS = 48000;

describe("BeatEngine", () => {
  it("detects the tempo of a synthetic 120 BPM kick pattern end-to-end", () => {
    const layout = createRingBuffer(FS * 40);
    const writer = new RingWriter(layout);
    const engine = new BeatEngine(new RingReader(layout), null, "mono-sum", FS);

    // 25 seconds of a decaying 60 Hz "kick" every 0.5 s, written in 100 ms
    // chunks with advance() interleaved (as the frame loop would).
    const chunk = new Float32Array(FS / 10);
    for (let c = 0; c < 250; c++) {
      const t0 = c * chunk.length;
      for (let i = 0; i < chunk.length; i++) {
        const t = (t0 + i) / FS;
        const sinceKick = t % 0.5;
        chunk[i] = sinceKick < 0.12
          ? Math.sin(2 * Math.PI * 60 * sinceKick) * Math.exp(-sinceKick * 30)
          : 0;
      }
      writer.write(chunk);
      engine.advance();
    }

    const s = engine.state();
    expect(s.bpm).not.toBeNull();
    expect(s.bpm!).toBeGreaterThan(118);
    expect(s.bpm!).toBeLessThan(122);
  });

  it("reports null bpm for silence", () => {
    const layout = createRingBuffer(FS * 10);
    const writer = new RingWriter(layout);
    const engine = new BeatEngine(new RingReader(layout), null, "mono-sum", FS);
    writer.write(new Float32Array(FS * 5));
    engine.advance();
    expect(engine.state().bpm).toBeNull();
  });
});
```

- [ ] **Step 2: Run** `npx vitest run src/audio/beatEngine.test.ts` — expect FAIL.

- [ ] **Step 3: Implement** `src/audio/beatEngine.ts`:

```ts
import { RingReader } from "./ringBuffer";
import { mixToMono, type ChannelMode } from "../util/channelMix";
import { OnsetDetector } from "../dsp/onsetDetector";
import { estimateBpm, type TempoEstimate } from "../dsp/tempoEstimator";
import { BeatTracker } from "../dsp/beatTracker";

/**
 * Per-deck beat analysis: consumes the deck's ring buffers at a fixed hop,
 * independent of the waveform path, and feeds onset flux into the tempo
 * estimator (drift anchor) and PLL beat tracker. Call advance() every frame.
 */

const HOP = 256;
const FLUX_WINDOW_S = 10;   // rolling window handed to estimateBpm
const ESTIMATE_EVERY = 64;  // hops between tempo re-estimates (~0.34 s)
const MAX_BACKLOG_S = 1;    // resnap if more than this is pending

export interface BeatState {
  bpm: number | null;
  barPosition: number;
  confidence: number;
}

export class BeatEngine {
  private readonly detector = new OnsetDetector(1024, HOP);
  private readonly tracker: BeatTracker;
  private readonly flux: number[] = [];
  private readonly maxFlux: number;
  private readonly hopSeconds: number;
  private readonly scratchL: Float32Array;
  private readonly scratchR: Float32Array;
  private consumed: number | null = null;
  private hopsSinceEstimate = 0;
  private lastEstimate: TempoEstimate | null = null;

  constructor(
    private readonly left: RingReader,
    private readonly right: RingReader | null,
    private readonly mode: ChannelMode,
    private readonly sampleRate: number,
  ) {
    this.hopSeconds = HOP / sampleRate;
    this.maxFlux = Math.ceil(FLUX_WINDOW_S / this.hopSeconds);
    this.tracker = new BeatTracker(this.hopSeconds);
    const maxSamples = Math.ceil(sampleRate * MAX_BACKLOG_S);
    this.scratchL = new Float32Array(maxSamples);
    this.scratchR = new Float32Array(maxSamples);
  }

  /** Consume all complete new hops written since the last call. */
  advance(): void {
    const written = this.left.totalWritten();
    if (this.consumed === null || written - this.consumed > this.sampleRate * MAX_BACKLOG_S) {
      this.consumed = written - (written % HOP);
      return;
    }
    const avail = written - this.consumed;
    const hops = Math.floor(avail / HOP);
    if (hops <= 0) return;

    const count = hops * HOP;
    const end = this.consumed + count;
    const delay = written - end;
    const left = this.left.readRecent(this.scratchL, count, delay).subarray(0, count);
    const right = this.right
      ? this.right.readRecent(this.scratchR, count, delay).subarray(0, count)
      : null;
    const mono = mixToMono(left, right, this.mode);

    for (const fluxValue of this.detector.feed(mono)) {
      this.flux.push(fluxValue);
      if (this.flux.length > this.maxFlux) this.flux.shift();
      this.hopsSinceEstimate++;
      if (this.hopsSinceEstimate >= ESTIMATE_EVERY) {
        this.hopsSinceEstimate = 0;
        this.lastEstimate = estimateBpm(this.flux, this.hopSeconds);
      }
      this.tracker.update(fluxValue, this.lastEstimate);
      this.lastEstimate = null; // hand each estimate to the tracker once
    }
    this.consumed = end;
  }

  state(): BeatState {
    return {
      bpm: this.tracker.bpm,
      barPosition: this.tracker.barPosition(),
      confidence: this.tracker.confidence,
    };
  }

  tap1(): void {
    this.tracker.tap1();
  }

  nudge(delta: number): void {
    this.tracker.nudge(delta);
  }
}
```

- [ ] **Step 4: Wire into `src/main.ts`:**
  - `DeckRuntime` gains `beatEngine: BeatEngine` and `beatView: BeatViewElements`.
  - In `buildRuntimes()`, after creating the stream, create the engine and view and mount the view:

```ts
const beatEngine = new BeatEngine(leftReader, rightReader, deck.mode, handle.sampleRate);
const beatView = createBeatView({
  onTap: () => beatEngine.tap1(),
  onNudge: (d) => beatEngine.nudge(d),
});
view.head.append(beatView.root);
```

  (Remove any previously mounted `.beat` element from `view.head` first: `view.head.querySelector(".beat")?.remove();` — restarts rebuild runtimes.)
  - In `frame()`, after `advanceDeck`: `rt.beatEngine.advance(); updateBeatView(rt.beatView, rt.beatEngine.state());`
  - In `stopAll()`, also remove beat views: `for (const view of views.values()) view.head.querySelector(".beat")?.remove();`

- [ ] **Step 5: Run** `npm test` and `npx tsc --noEmit` — all pass. The BeatEngine test is the slowest in the suite (~1s); that's acceptable.
- [ ] **Step 6: Commit** `feat: per-deck beat engine wired to bar indicator UI`

---

## Self-Review Notes

- Spec coverage: spectral-flux onsets (T2), autocorrelation tempo + drift anchor (T3), PLL tracker with drift tracking (T4), 4-block bar indicator + tap-1/nudge (T5, T6). ✔
- Type consistency: `TempoEstimate` defined in T3, consumed in T4/T6; `BeatState` in T6; `DeckElements.head` added in T5, used in T6. ✔
- The M1 `onRoutingChange` TODO (restart on mode change) is unaffected: BeatEngine is rebuilt on restart like the waveform runtimes. ✔
- Tuning latitude for T4 gains is stated in Global Constraints. ✔
