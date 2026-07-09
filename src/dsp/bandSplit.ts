/**
 * Time-domain 3-band split for waveform coloring. Two one-pole low-passes
 * define the crossovers; bands reconstruct the input exactly:
 *   low = LP200(x), mid = LP4k(x) - LP200(x), high = x - LP4k(x).
 * Stateful: filters run continuously across process() calls, so feed each
 * deck's blocks in order through its own instance.
 */

const LOW_CROSSOVER_HZ = 200;
const HIGH_CROSSOVER_HZ = 4000;

export interface BandBlocks {
  low: Float32Array;
  mid: Float32Array;
  high: Float32Array;
}

class OnePoleLowPass {
  private y = 0;
  private readonly a: number;
  constructor(cutoffHz: number, sampleRate: number) {
    this.a = 1 - Math.exp((-2 * Math.PI * cutoffHz) / sampleRate);
  }
  next(x: number): number {
    this.y += this.a * (x - this.y);
    return this.y;
  }
}

export class BandSplitter {
  private readonly lpLow: OnePoleLowPass;
  private readonly lpHigh: OnePoleLowPass;

  constructor(sampleRate: number) {
    this.lpLow = new OnePoleLowPass(LOW_CROSSOVER_HZ, sampleRate);
    this.lpHigh = new OnePoleLowPass(HIGH_CROSSOVER_HZ, sampleRate);
  }

  /** Split one block. Returns new arrays; never mutates `mono`. */
  process(mono: Float32Array): BandBlocks {
    const n = mono.length;
    const low = new Float32Array(n);
    const mid = new Float32Array(n);
    const high = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = mono[i]!;
      const l = this.lpLow.next(x);
      const m = this.lpHigh.next(x);
      low[i] = l;
      mid[i] = m - l;
      high[i] = x - m;
    }
    return { low, mid, high };
  }
}
