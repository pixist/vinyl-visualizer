import { describe, it, expect } from "vitest";
import { createRingBuffer, RingWriter, RingReader } from "./ringBuffer";

function seq(from: number, len: number): Float32Array {
  const a = new Float32Array(len);
  for (let i = 0; i < len; i++) a[i] = from + i;
  return a;
}

describe("ring buffer", () => {
  it("rejects non-positive capacity", () => {
    expect(() => createRingBuffer(0)).toThrow();
    expect(() => createRingBuffer(-4)).toThrow();
    expect(() => createRingBuffer(1.5)).toThrow();
  });

  it("reads back the most recent samples in order", () => {
    const layout = createRingBuffer(16);
    const w = new RingWriter(layout);
    const r = new RingReader(layout);
    w.write(seq(0, 8));
    const out = r.readRecent(new Float32Array(4), 4);
    expect(Array.from(out)).toEqual([4, 5, 6, 7]);
  });

  it("pads with zeros before enough samples exist", () => {
    const layout = createRingBuffer(16);
    const w = new RingWriter(layout);
    const r = new RingReader(layout);
    w.write(seq(0, 2));
    const out = r.readRecent(new Float32Array(4), 4);
    expect(Array.from(out)).toEqual([0, 0, 0, 1]);
  });

  it("wraps correctly past capacity", () => {
    const layout = createRingBuffer(8);
    const w = new RingWriter(layout);
    const r = new RingReader(layout);
    w.write(seq(0, 12)); // 0..11, only last 8 survive
    const out = r.readRecent(new Float32Array(8), 8);
    expect(Array.from(out)).toEqual([4, 5, 6, 7, 8, 9, 10, 11]);
  });

  it("applies a delay offset by reading older samples", () => {
    const layout = createRingBuffer(32);
    const w = new RingWriter(layout);
    const r = new RingReader(layout);
    w.write(seq(0, 16));
    const out = r.readRecent(new Float32Array(4), 4, 4); // 4 samples ending 4 before head
    expect(Array.from(out)).toEqual([8, 9, 10, 11]);
  });

  it("zero-fills samples that have already been overwritten", () => {
    const layout = createRingBuffer(8);
    const w = new RingWriter(layout);
    const r = new RingReader(layout);
    w.write(seq(0, 20)); // last 8 survive: 12..19
    const out = r.readRecent(new Float32Array(8), 8, 8); // window 4..11, all overwritten
    expect(Array.from(out)).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it("throws if out is smaller than count", () => {
    const layout = createRingBuffer(8);
    const r = new RingReader(layout);
    expect(() => r.readRecent(new Float32Array(2), 4)).toThrow();
  });
});
