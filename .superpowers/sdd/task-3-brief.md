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

