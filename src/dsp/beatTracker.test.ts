import { describe, it, expect } from "vitest";
import { BeatTracker } from "./beatTracker";

const HOP_S = 256 / 48000;

/**
 * Drives a tracker with a synthetic impulse train. `bpmOf(t)` lets tests ramp
 * the tempo. Returns the tracker for assertions.
 */
function drive(
  tracker: BeatTracker,
  seconds: number,
  bpmOf: (t: number) => number,
  hint: (t: number) => { bpm: number; confidence: number } | null,
): BeatTracker {
  let t = 0;
  let nextBeat = 0;
  while (t < seconds) {
    let flux = 0.1;
    if (t >= nextBeat) {
      flux = 10;
      nextBeat += 60 / bpmOf(t);
    }
    tracker.update(flux, hint(t));
    t += HOP_S;
  }
  return tracker;
}

describe("BeatTracker", () => {
  it("has no bpm before any tempo hint", () => {
    const tr = new BeatTracker(HOP_S);
    for (let i = 0; i < 100; i++) tr.update(0.1, null);
    expect(tr.bpm).toBeNull();
  });

  it("locks to a steady 128 BPM train", () => {
    const tr = new BeatTracker(HOP_S);
    drive(tr, 15, () => 128, (t) => (t < 1 ? { bpm: 128, confidence: 1 } : null));
    expect(tr.bpm).not.toBeNull();
    expect(tr.bpm!).toBeGreaterThan(126.5);
    expect(tr.bpm!).toBeLessThan(129.5);
    expect(tr.confidence).toBeGreaterThan(0.5);
  });

  it("drift-tracks a slow tempo ramp 120 -> 126", () => {
    const tr = new BeatTracker(HOP_S);
    drive(tr, 30, (t) => 120 + (6 * Math.min(t, 25)) / 25,
      (t) => (t < 1 ? { bpm: 120, confidence: 1 } : null));
    expect(tr.bpm!).toBeGreaterThan(123.5);
    expect(tr.bpm!).toBeLessThan(128.5);
  });

  it("cycles barPosition 0..3 over four beats", () => {
    const tr = new BeatTracker(HOP_S);
    const seen = new Set<number>();
    let t = 0, nextBeat = 0;
    // Warm up with lock first.
    drive(tr, 5, () => 120, (tt) => (tt < 1 ? { bpm: 120, confidence: 1 } : null));
    for (let i = 0; i < Math.round(2 / HOP_S); i++) {
      let flux = 0.1;
      if (t >= nextBeat) { flux = 10; nextBeat += 0.5; }
      tr.update(flux, null);
      seen.add(tr.barPosition());
      t += HOP_S;
    }
    expect([...seen].sort()).toEqual([0, 1, 2, 3]);
  });

  it("tap1 makes the current beat position 0 and nudge shifts it", () => {
    const tr = new BeatTracker(HOP_S);
    drive(tr, 10, () => 120, (t) => (t < 1 ? { bpm: 120, confidence: 1 } : null));
    tr.tap1();
    expect(tr.barPosition()).toBe(0);
    tr.nudge(1);
    expect(tr.barPosition()).toBe(3); // bar start moved forward one beat
    tr.nudge(-1);
    expect(tr.barPosition()).toBe(0);
  });

  it("ignores octave-jump hints once locked", () => {
    const tr = new BeatTracker(HOP_S);
    drive(tr, 10, () => 128, (t) => (t < 1 ? { bpm: 128, confidence: 1 } : null));
    const before = tr.bpm!;
    for (let i = 0; i < 200; i++) tr.update(0.1, { bpm: 64, confidence: 0.9 });
    expect(Math.abs(tr.bpm! - before)).toBeLessThan(2);
  });
});
