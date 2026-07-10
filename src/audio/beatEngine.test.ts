import { describe, it, expect } from "vitest";
import { createRingBuffer, RingWriter, RingReader } from "./ringBuffer";
import { BeatEngine } from "./beatEngine";

const FS = 48000;

describe("BeatEngine", () => {
  it("detects the tempo of a synthetic 120 BPM kick pattern end-to-end", () => {
    const layout = createRingBuffer(FS * 40);
    const writer = new RingWriter(layout);
    const engine = new BeatEngine(new RingReader(layout), null, "mono-sum", FS);

    // 25 seconds of a decaying 60 Hz "kick" every 0.5 s, written in 100 ms
    // chunks with advance() interleaved (as the frame loop would).
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
    }

    const s = engine.state();
    expect(s.bpm).not.toBeNull();
    expect(s.bpm!).toBeGreaterThan(118);
    expect(s.bpm!).toBeLessThan(122);
  });

  it("reports null bpm for silence", () => {
    const layout = createRingBuffer(FS * 10);
    const writer = new RingWriter(layout);
    const engine = new BeatEngine(new RingReader(layout), null, "mono-sum", FS);
    writer.write(new Float32Array(FS * 5));
    engine.advance();
    expect(engine.state().bpm).toBeNull();
  });
});
