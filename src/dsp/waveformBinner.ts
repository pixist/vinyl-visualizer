/**
 * Reduces a raw sample window into per-column peak/RMS bins for drawing a
 * scrolling waveform. Pure and dependency-free so it is trivially testable
 * and can later be moved into a DSP worker unchanged.
 */

export interface WaveformBin {
  min: number;
  max: number;
  rms: number;
}

/**
 * Split `samples` into `binCount` contiguous bins and reduce each to
 * {min, max, rms}. Callers always get exactly `binCount` entries; when there
 * are fewer samples than bins some bins cover an empty range and are emitted
 * as silence. In normal operation there are always many samples per bin.
 */
export function binWaveform(samples: Float32Array, binCount: number): WaveformBin[] {
  if (!Number.isInteger(binCount) || binCount <= 0) {
    throw new Error(`binCount must be a positive integer, got ${binCount}`);
  }
  const bins: WaveformBin[] = new Array(binCount);
  const n = samples.length;
  for (let b = 0; b < binCount; b++) {
    const start = Math.floor((b * n) / binCount);
    const end = Math.floor(((b + 1) * n) / binCount);
    bins[b] = reduce(samples, start, end);
  }
  return bins;
}

function reduce(samples: Float32Array, start: number, end: number): WaveformBin {
  if (end <= start) {
    return { min: 0, max: 0, rms: 0 };
  }
  let min = Infinity;
  let max = -Infinity;
  let sumSq = 0;
  for (let i = start; i < end; i++) {
    const v = samples[i]!;
    if (v < min) min = v;
    if (v > max) max = v;
    sumSq += v * v;
  }
  return { min, max, rms: Math.sqrt(sumSq / (end - start)) };
}

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
