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

