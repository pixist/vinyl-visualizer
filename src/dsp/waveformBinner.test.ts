import { describe, it, expect } from "vitest";
import { binWaveform } from "./waveformBinner";

describe("binWaveform", () => {
  it("rejects invalid bin counts", () => {
    expect(() => binWaveform(new Float32Array(10), 0)).toThrow();
    expect(() => binWaveform(new Float32Array(10), 2.5)).toThrow();
  });

  it("produces exactly binCount bins", () => {
    const bins = binWaveform(new Float32Array(100), 8);
    expect(bins).toHaveLength(8);
  });

  it("computes min/max/rms per bin", () => {
    const samples = new Float32Array([1, -1, 1, -1]);
    const [bin] = binWaveform(samples, 1);
    expect(bin!.min).toBe(-1);
    expect(bin!.max).toBe(1);
    expect(bin!.rms).toBeCloseTo(1, 6);
  });

  it("splits samples across bins", () => {
    const samples = new Float32Array([1, 1, -1, -1]);
    const bins = binWaveform(samples, 2);
    expect(bins[0]!.max).toBe(1);
    expect(bins[0]!.min).toBe(1);
    expect(bins[1]!.max).toBe(-1);
    expect(bins[1]!.min).toBe(-1);
  });

  it("emits silence for bins that cover no samples", () => {
    // One sample across four bins: the sample lands in the last bin; the
    // leading bins cover an empty range and read as silence.
    const bins = binWaveform(new Float32Array([0.5]), 4);
    expect(bins[0]).toEqual({ min: 0, max: 0, rms: 0 });
    expect(bins[3]!.max).toBe(0.5);
  });
});
