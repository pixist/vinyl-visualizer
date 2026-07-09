import { describe, it, expect } from "vitest";
import { createRingBuffer, RingWriter, RingReader } from "../audio/ringBuffer";
import { advanceDeck, SAMPLES_PER_COLUMN, type DeckStreams } from "./scrollDriver";
import type { WaveformBin } from "../dsp/waveformBinner";
import type { WaveformRenderer } from "./waveformRenderer";

/** Records the columns pushed so we can assert on the paced-advance logic. */
class FakeRenderer {
  pushes: WaveformBin[][] = [];
  pushColumns(bins: WaveformBin[]): void {
    this.pushes.push(bins);
  }
  clear(): void {}
}

function makeStream(capacity: number, delaySamples = 0) {
  const layout = createRingBuffer(capacity);
  const writer = new RingWriter(layout);
  const renderer = new FakeRenderer();
  const stream: DeckStreams = {
    left: new RingReader(layout),
    right: null,
    mode: "mono-sum",
    renderer: renderer as unknown as WaveformRenderer,
    delaySamples,
    gain: 1,
  };
  return { writer, renderer, stream };
}

describe("advanceDeck", () => {
  const scratch = new Float32Array(64 * SAMPLES_PER_COLUMN);

  it("snaps to the write head on the first frame", () => {
    const { writer, stream } = makeStream(48000);
    writer.write(new Float32Array(10 * SAMPLES_PER_COLUMN));
    const consumed = advanceDeck(stream, null, scratch, scratch, 32);
    expect(consumed).toBe(10 * SAMPLES_PER_COLUMN);
  });

  it("emits no columns until a full column of audio has arrived", () => {
    const { writer, renderer, stream } = makeStream(48000);
    let consumed = advanceDeck(stream, null, scratch, scratch, 32); // snap at 0
    writer.write(new Float32Array(SAMPLES_PER_COLUMN - 1));
    consumed = advanceDeck(stream, consumed, scratch, scratch, 32);
    expect(renderer.pushes).toHaveLength(0);
  });

  it("emits exactly the number of whole columns available", () => {
    const { writer, renderer, stream } = makeStream(48000);
    let consumed = advanceDeck(stream, null, scratch, scratch, 32); // snap at 0
    writer.write(new Float32Array(3 * SAMPLES_PER_COLUMN + 5));
    consumed = advanceDeck(stream, consumed, scratch, scratch, 32);
    expect(renderer.pushes).toHaveLength(1);
    expect(renderer.pushes[0]).toHaveLength(3);
    // The 5 leftover samples remain unconsumed for the next frame.
    expect(consumed).toBe(3 * SAMPLES_PER_COLUMN);
  });

  it("applies the stream gain to the binned amplitudes", () => {
    const { writer, renderer, stream } = makeStream(48000);
    stream.gain = 2;
    let consumed = advanceDeck(stream, null, scratch, scratch, 32); // snap at 0
    const samples = new Float32Array(SAMPLES_PER_COLUMN).fill(0.25);
    writer.write(samples);
    consumed = advanceDeck(stream, consumed, scratch, scratch, 32);
    expect(renderer.pushes).toHaveLength(1);
    expect(renderer.pushes[0]![0]!.max).toBeCloseTo(0.5, 6);
    expect(renderer.pushes[0]![0]!.rms).toBeCloseTo(0.5, 6);
  });

  it("caps columns at maxColumns and resnaps on large backlog", () => {
    const { writer, stream } = makeStream(1 << 20);
    let consumed = advanceDeck(stream, null, scratch, scratch, 8); // snap at 0
    // Write far more than maxColumns*SAMPLES_PER_COLUMN of backlog.
    writer.write(new Float32Array(100 * SAMPLES_PER_COLUMN));
    consumed = advanceDeck(stream, consumed, scratch, scratch, 8);
    // Backlog exceeded the window, so it resnaps to head rather than redraw all.
    expect(consumed).toBe(100 * SAMPLES_PER_COLUMN);
  });

  it("paces columns by the given samplesPerColumn", () => {
    const { writer, renderer, stream } = makeStream(48000);
    let consumed = advanceDeck(stream, null, scratch, scratch, 32, 64); // snap at 0
    writer.write(new Float32Array(3 * 64 + 5));
    consumed = advanceDeck(stream, consumed, scratch, scratch, 32, 64);
    expect(renderer.pushes[0]).toHaveLength(3);
    expect(consumed).toBe(3 * 64);
  });
});
