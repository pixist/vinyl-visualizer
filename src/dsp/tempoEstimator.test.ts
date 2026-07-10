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
    const noise = new Array(2250).fill(0).map((_, i) => ((i * 104729) % 9973) / 9973);
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
