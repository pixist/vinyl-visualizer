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
