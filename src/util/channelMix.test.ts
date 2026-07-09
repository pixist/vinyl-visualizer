import { describe, it, expect } from "vitest";
import { mixToMono, dbToLinear } from "./channelMix";

describe("mixToMono", () => {
  const left = new Float32Array([1, 0, -1]);
  const right = new Float32Array([0, 1, -1]);

  it("passes left channel through in left mode", () => {
    expect(Array.from(mixToMono(left, right, "left"))).toEqual([1, 0, -1]);
  });

  it("passes right channel through in right mode", () => {
    expect(Array.from(mixToMono(left, right, "right"))).toEqual([0, 1, -1]);
  });

  it("averages channels in mono-sum mode", () => {
    expect(Array.from(mixToMono(left, right, "mono-sum"))).toEqual([0.5, 0.5, -1]);
  });

  it("treats a missing right channel as the left channel", () => {
    expect(Array.from(mixToMono(left, null, "mono-sum"))).toEqual([1, 0, -1]);
  });

  it("does not mutate its inputs", () => {
    mixToMono(left, right, "mono-sum");
    expect(Array.from(left)).toEqual([1, 0, -1]);
    expect(Array.from(right)).toEqual([0, 1, -1]);
  });

  it("applies linear gain in every mode", () => {
    expect(Array.from(mixToMono(left, right, "left", 2))).toEqual([2, 0, -2]);
    expect(Array.from(mixToMono(left, right, "right", 2))).toEqual([0, 2, -2]);
    expect(Array.from(mixToMono(left, right, "mono-sum", 2))).toEqual([1, 1, -2]);
  });

  it("defaults gain to 1 (unchanged output)", () => {
    expect(Array.from(mixToMono(left, right, "left"))).toEqual([1, 0, -1]);
  });
});

describe("dbToLinear", () => {
  it("maps 0 dB to 1 and 20 dB to 10", () => {
    expect(dbToLinear(0)).toBe(1);
    expect(dbToLinear(20)).toBeCloseTo(10, 10);
  });

  it("maps 6 dB to roughly a doubling", () => {
    expect(dbToLinear(6)).toBeCloseTo(1.995, 3);
  });
});
