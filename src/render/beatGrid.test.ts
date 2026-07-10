import { describe, it, expect } from "vitest";
import { computeGridLines } from "./beatGrid";

/**
 * Grid semantics: the last (up to) 4 detected beats get lines at their true
 * positions; to their left the median spacing of those beats repeats as
 * projected lines. Faster tempo -> the real lines sit closer together and
 * the projection contracts with them.
 */
describe("computeGridLines", () => {
  it("places the last 4 beats at their true x positions", () => {
    // 1 column = 10 samples, right edge at sample 3000, canvas 100 px wide.
    const lines = computeGridLines([2000, 2250, 2500, 2750], 3000, 10, 100);
    const real = lines.filter((l) => l.isDetected).map((l) => l.x);
    expect(real).toEqual([0, 25, 50, 75]); // 100 - (3000 - beat)/10
  });

  it("only ever marks 4 beats as detected even when more are known", () => {
    const beats = [1000, 1250, 1500, 1750, 2000, 2250, 2500, 2750];
    const lines = computeGridLines(beats, 3000, 10, 200);
    expect(lines.filter((l) => l.isDetected)).toHaveLength(4);
  });

  it("repeats the median beat spacing to the left of the oldest shown beat", () => {
    const lines = computeGridLines([2000, 2250, 2500, 2750], 3000, 10, 200);
    const projected = lines.filter((l) => !l.isDetected).map((l) => l.x);
    // oldest real line at x=100, spacing 25 px -> 75, 50, 25, 0
    expect(projected).toEqual([75, 50, 25, 0]);
  });

  it("contracts the projection when the last beats are faster", () => {
    // spacing tightens from 250 to 200 samples across the window
    const lines = computeGridLines([2100, 2350, 2550, 2750], 3000, 10, 100);
    const projected = lines.filter((l) => !l.isDetected).map((l) => l.x);
    // median interval of [250, 200, 200] = 200 samples = 20 px; oldest real
    // line at x = 100 - 90 = 10, so no room left of it except x >= 0
    expect(Math.max(...projected)).toBeLessThan(10);
  });

  it("returns no lines with fewer than 2 beats", () => {
    expect(computeGridLines([], 3000, 10, 100)).toEqual([]);
    expect(computeGridLines([2500], 3000, 10, 100)).toEqual([]);
  });

  it("skips projection when spacing would be too dense to read", () => {
    // 30-sample spacing at 10 samples/col = 3 px apart: below MIN_SPACING_PX
    const lines = computeGridLines([2910, 2940, 2970, 3000], 3000, 10, 100);
    expect(lines.filter((l) => !l.isDetected)).toEqual([]);
  });

  it("drops beats that have scrolled off the left edge", () => {
    const lines = computeGridLines([100, 2500, 2750], 3000, 10, 100);
    for (const l of lines) expect(l.x).toBeGreaterThanOrEqual(0);
  });
});
