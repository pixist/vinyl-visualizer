/**
 * Single-producer / single-consumer lock-free ring buffer over a
 * SharedArrayBuffer. The audio thread (worklet) is the sole writer; a
 * consumer (main thread or DSP worker) reads recent history.
 *
 * Layout of the backing SharedArrayBuffer:
 *   [ control: Int32Array(1) = total samples written ]
 *   [ data:    Float32Array(capacity) circular sample store ]
 *
 * The control counter is monotonic (never wraps) so the reader can always
 * compute how far behind it is. Sample slots are addressed modulo capacity.
 */

const CONTROL_SLOTS = 1;
const WRITE_COUNT_INDEX = 0;
const BYTES_PER_INT32 = 4;

export interface RingLayout {
  readonly sab: SharedArrayBuffer;
  readonly capacity: number;
}

export function createRingBuffer(capacity: number): RingLayout {
  if (!Number.isInteger(capacity) || capacity <= 0) {
    throw new Error(`ring capacity must be a positive integer, got ${capacity}`);
  }
  const controlBytes = CONTROL_SLOTS * BYTES_PER_INT32;
  const dataBytes = capacity * Float32Array.BYTES_PER_ELEMENT;
  const sab = new SharedArrayBuffer(controlBytes + dataBytes);
  return { sab, capacity };
}

/** Writer view. Constructed on the audio thread from a transferred layout. */
export class RingWriter {
  private readonly control: Int32Array;
  private readonly data: Float32Array;
  private readonly capacity: number;

  constructor(layout: RingLayout) {
    this.capacity = layout.capacity;
    this.control = new Int32Array(layout.sab, 0, CONTROL_SLOTS);
    this.data = new Float32Array(layout.sab, CONTROL_SLOTS * BYTES_PER_INT32, layout.capacity);
  }

  write(samples: Float32Array): void {
    const written = Atomics.load(this.control, WRITE_COUNT_INDEX);
    const cap = this.capacity;
    for (let i = 0; i < samples.length; i++) {
      this.data[(written + i) % cap] = samples[i]!;
    }
    // Publish the new count last so a reader never sees uninitialised slots.
    Atomics.store(this.control, WRITE_COUNT_INDEX, written + samples.length);
  }
}

/** Reader view. Reads the most recent history, optionally delayed. */
export class RingReader {
  private readonly control: Int32Array;
  private readonly data: Float32Array;
  private readonly capacity: number;

  constructor(layout: RingLayout) {
    this.capacity = layout.capacity;
    this.control = new Int32Array(layout.sab, 0, CONTROL_SLOTS);
    this.data = new Float32Array(layout.sab, CONTROL_SLOTS * BYTES_PER_INT32, layout.capacity);
  }

  /** Total samples the writer has produced since creation. */
  totalWritten(): number {
    return Atomics.load(this.control, WRITE_COUNT_INDEX);
  }

  /**
   * Copy `count` most-recent samples into `out`, ending `delaySamples` before
   * the write head. Slots not yet written (early startup) are filled with 0.
   * Returns `out` for convenience.
   */
  readRecent(out: Float32Array, count: number, delaySamples = 0): Float32Array {
    if (out.length < count) {
      throw new Error(`out length ${out.length} < count ${count}`);
    }
    const cap = this.capacity;
    const written = Atomics.load(this.control, WRITE_COUNT_INDEX);
    // Index (exclusive) of the newest sample we are allowed to read.
    const head = written - delaySamples;
    const start = head - count;
    for (let i = 0; i < count; i++) {
      const abs = start + i;
      if (abs < 0 || abs >= written || written - abs > cap) {
        out[i] = 0;
      } else {
        out[i] = this.data[((abs % cap) + cap) % cap]!;
      }
    }
    return out;
  }
}
