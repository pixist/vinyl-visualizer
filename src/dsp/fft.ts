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
