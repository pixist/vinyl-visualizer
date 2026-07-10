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
