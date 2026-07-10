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

