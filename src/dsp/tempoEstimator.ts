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
