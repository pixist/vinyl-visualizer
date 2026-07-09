import { describe, it, expect } from "vitest";
import { colorForBands, BAND_COLORS } from "./bandColor";

describe("colorForBands", () => {
  it("returns the pure band color for a single-band signal", () => {
    expect(colorForBands(1, 0, 0)).toBe(`rgb(${BAND_COLORS.low.join(",")})`);
    expect(colorForBands(0, 0, 1)).toBe(`rgb(${BAND_COLORS.high.join(",")})`);
  });
  it("blends proportionally to band energy", () => {
    const mixed = colorForBands(1, 1, 0)!;
    const [r, g, b] = mixed.match(/\d+/g)!.map(Number);
    expect(r).toBe(Math.round((BAND_COLORS.low[0] + BAND_COLORS.mid[0]) / 2));
    expect(g).toBe(Math.round((BAND_COLORS.low[1] + BAND_COLORS.mid[1]) / 2));
    expect(b).toBe(Math.round((BAND_COLORS.low[2] + BAND_COLORS.mid[2]) / 2));
  });
  it("returns null for silence", () => {
    expect(colorForBands(0, 0, 0)).toBeNull();
  });
});
