import { describe, it, expect, beforeAll } from "vitest";
import { createRingBuffer, RingWriter, RingReader } from "./ringBuffer";
import { BeatEngine } from "./beatEngine";

const FS = 48000;

beforeAll(() => BeatEngine.ready());

/** Wait a tick so the engine's own aubio-ready continuation has run. */
const settle = () => new Promise((r) => setTimeout(r, 0));

function writeKickPattern(writer: RingWriter, engine: BeatEngine, onStep?: () => void): void {
  // 25 seconds of a decaying 60 Hz "kick" every 0.5 s (120 BPM), written in
  // 100 ms chunks with advance() interleaved (as the frame loop would).
  const chunk = new Float32Array(FS / 10);
  for (let c = 0; c < 250; c++) {
    const t0 = c * chunk.length;
    for (let i = 0; i < chunk.length; i++) {
      const t = (t0 + i) / FS;
      const sinceKick = t % 0.5;
      chunk[i] = sinceKick < 0.12
        ? Math.sin(2 * Math.PI * 60 * sinceKick) * Math.exp(-sinceKick * 30)
        : 0;
    }
    writer.write(chunk);
    engine.advance();
    onStep?.();
  }
}

describe("BeatEngine (aubio tempo)", () => {
  it("detects the tempo of a synthetic 120 BPM kick pattern end-to-end", async () => {
    const layout = createRingBuffer(FS * 40);
    const writer = new RingWriter(layout);
    const engine = new BeatEngine(new RingReader(layout), null, "mono-sum", FS);
    await settle();

    writeKickPattern(writer, engine);

    const s = engine.state();
    expect(s.bpm).not.toBeNull();
    expect(s.bpm!).toBeGreaterThan(118);
    expect(s.bpm!).toBeLessThan(122);
  });

  it("cycles barPosition through integer beats 0..3 and honors tap1/nudge", async () => {
    const layout = createRingBuffer(FS * 40);
    const writer = new RingWriter(layout);
    const engine = new BeatEngine(new RingReader(layout), null, "mono-sum", FS);
    await settle();

    const positions = new Set<number>();
    writeKickPattern(writer, engine, () => positions.add(engine.state().barPosition));

    expect([...positions].sort()).toEqual([0, 1, 2, 3]);
    for (const p of positions) expect(Number.isInteger(p)).toBe(true);

    engine.tap1();
    expect(engine.state().barPosition).toBe(0);
    engine.nudge(1);
    expect(engine.state().barPosition).toBe(1);
    engine.nudge(-2);
    expect(engine.state().barPosition).toBe(3);
  });

  it("auto-anchors beat 1 to the accented (loudest) beat of the bar", async () => {
    const layout = createRingBuffer(FS * 40);
    const writer = new RingWriter(layout);
    const engine = new BeatEngine(new RingReader(layout), null, "mono-sum", FS);
    await settle();

    // 120 BPM kicks; every 4th kick (t = 0, 2, 4, ... s) is 3x louder.
    const samples: number[] = [];
    const chunk = new Float32Array(FS / 10);
    for (let c = 0; c < 250; c++) {
      const t0 = c * chunk.length;
      for (let i = 0; i < chunk.length; i++) {
        const t = (t0 + i) / FS;
        const sinceKick = t % 0.5;
        const kickIndex = Math.floor(t / 0.5);
        const amp = kickIndex % 4 === 0 ? 1.0 : 0.3;
        chunk[i] = sinceKick < 0.12
          ? amp * Math.sin(2 * Math.PI * 60 * sinceKick) * Math.exp(-sinceKick * 30)
          : 0;
      }
      writer.write(chunk);
      engine.advance();
      // Sample bar position 100 ms after each late accent (t = 20, 22, 24 s).
      const t = (c + 1) * 0.1;
      if (t > 20 && Math.abs((t - 0.1) % 2) < 1e-9) {
        samples.push(engine.state().barPosition);
      }
    }

    expect(samples.length).toBeGreaterThan(0);
    for (const p of samples) expect(p).toBe(0);
  });

  it("resetAnalysis clears the BPM and relearns it from fresh audio", async () => {
    const layout = createRingBuffer(FS * 40);
    const writer = new RingWriter(layout);
    const engine = new BeatEngine(new RingReader(layout), null, "mono-sum", FS);
    await settle();

    writeKickPattern(writer, engine);
    expect(engine.state().bpm).not.toBeNull();

    engine.resetAnalysis();
    await settle();
    expect(engine.state().bpm).toBeNull();

    writeKickPattern(writer, engine);
    const s = engine.state();
    expect(s.bpm).not.toBeNull();
    expect(s.bpm!).toBeGreaterThan(118);
    expect(s.bpm!).toBeLessThan(122);
  });

  it("resetBar re-enables downbeat auto-anchoring after a manual nudge", async () => {
    const layout = createRingBuffer(FS * 60);
    const writer = new RingWriter(layout);
    const engine = new BeatEngine(new RingReader(layout), null, "mono-sum", FS);
    await settle();

    engine.nudge(2); // manual, deliberately wrong
    engine.resetBar();

    // Accented pattern (every 4th kick 3x louder) should now auto-anchor.
    const samples: number[] = [];
    const chunk = new Float32Array(FS / 10);
    for (let c = 0; c < 250; c++) {
      const t0 = c * chunk.length;
      for (let i = 0; i < chunk.length; i++) {
        const t = (t0 + i) / FS;
        const sinceKick = t % 0.5;
        const kickIndex = Math.floor(t / 0.5);
        const amp = kickIndex % 4 === 0 ? 1.0 : 0.3;
        chunk[i] = sinceKick < 0.12
          ? amp * Math.sin(2 * Math.PI * 60 * sinceKick) * Math.exp(-sinceKick * 30)
          : 0;
      }
      writer.write(chunk);
      engine.advance();
      const t = (c + 1) * 0.1;
      if (t > 20 && Math.abs((t - 0.1) % 2) < 1e-9) {
        samples.push(engine.state().barPosition);
      }
    }
    expect(samples.length).toBeGreaterThan(0);
    for (const p of samples) expect(p).toBe(0);
  });

  it("reports null bpm for silence", async () => {
    const layout = createRingBuffer(FS * 10);
    const writer = new RingWriter(layout);
    const engine = new BeatEngine(new RingReader(layout), null, "mono-sum", FS);
    await settle();
    writer.write(new Float32Array(FS * 5));
    engine.advance();
    writer.write(new Float32Array(FS / 2));
    engine.advance();
    expect(engine.state().bpm).toBeNull();
  });
});
