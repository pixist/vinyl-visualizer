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
