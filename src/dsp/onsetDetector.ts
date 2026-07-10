import { fftMagnitudes } from "./fft";

/**
 * Spectral-flux onset detector: Hann-windowed FFT frames at a fixed hop;
 * flux = sum over bins of the half-wave-rectified magnitude increase vs the
 * previous frame. Percussive onsets (kicks, snares) produce sharp flux peaks.
 * Stateful: keep one instance per continuous audio stream.
 */
export class OnsetDetector {
  readonly hopSize: number;
  private readonly frameSize: number;
  private readonly window: Float32Array;
  private readonly pending: number[] = []; // buffered samples not yet framed
  private prevMags: Float32Array | null = null;
  private readonly frame: Float32Array;

  constructor(frameSize = 1024, hopSize = 256) {
    if (hopSize <= 0 || frameSize <= 0 || frameSize % hopSize !== 0) {
      throw new Error(`frameSize must be a positive multiple of hopSize`);
    }
    this.frameSize = frameSize;
    this.hopSize = hopSize;
    this.frame = new Float32Array(frameSize);
    this.window = Float32Array.from({ length: frameSize }, (_, i) =>
      0.5 * (1 - Math.cos((2 * Math.PI * i) / (frameSize - 1))));
  }

  /** Feed any number of samples; returns one flux value per completed hop. */
  feed(samples: Float32Array): number[] {
    const out: number[] = [];
    for (let i = 0; i < samples.length; i++) {
      this.pending.push(samples[i]!);
      if (this.pending.length === this.frameSize) {
        out.push(this.processFrame());
        this.pending.splice(0, this.hopSize); // slide by one hop
      }
    }
    return out;
  }

  private processFrame(): number {
    for (let i = 0; i < this.frameSize; i++) {
      this.frame[i] = this.pending[i]! * this.window[i]!;
    }
    const mags = fftMagnitudes(this.frame);
    let flux = 0;
    if (this.prevMags) {
      for (let k = 0; k < mags.length; k++) {
        const d = mags[k]! - this.prevMags[k]!;
        if (d > 0) flux += d;
      }
    }
    this.prevMags = mags;
    return flux;
  }
}
