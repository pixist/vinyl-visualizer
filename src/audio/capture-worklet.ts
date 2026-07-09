/// <reference types="@types/audioworklet" />
/**
 * AudioWorkletProcessor: the only code on the realtime audio thread.
 * It does no DSP — it copies each input channel's samples into its own
 * SharedArrayBuffer ring. Everything else happens off-thread.
 *
 * This file is loaded via `audioWorklet.addModule(new URL(...))` so it is a
 * standalone module and must not import from the main bundle at runtime.
 */

import { RingWriter, type RingLayout } from "./ringBuffer";

interface CaptureOptions {
  layouts: RingLayout[]; // one per hardware input channel
}

class CaptureProcessor extends AudioWorkletProcessor {
  private readonly writers: RingWriter[];

  constructor(options: AudioWorkletNodeOptions) {
    super();
    const opts = options.processorOptions as CaptureOptions;
    this.writers = opts.layouts.map((l) => new RingWriter(l));
  }

  process(inputs: Float32Array[][]): boolean {
    const input = inputs[0];
    if (!input) return true;
    for (let ch = 0; ch < input.length && ch < this.writers.length; ch++) {
      const channelData = input[ch];
      if (channelData) this.writers[ch]!.write(channelData);
    }
    return true;
  }
}

registerProcessor("capture-processor", CaptureProcessor);
