### Task 2: Spectral-flux onset detector

**Files:**
- Create: `src/dsp/onsetDetector.ts`
- Test: `src/dsp/onsetDetector.test.ts`

**Interfaces:**
- Consumes: `fftMagnitudes` (Task 1).
- Produces: `export class OnsetDetector { constructor(frameSize = 1024, hopSize = 256); readonly hopSize: number; feed(samples: Float32Array): number[] }` — buffers arbitrary-sized input; emits one spectral-flux value per completed hop (half-wave-rectified magnitude increase summed over bins, Hann-windowed frames). Stateful across calls; never mutates input.

- [ ] **Step 1: Write the failing tests** — `src/dsp/onsetDetector.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { OnsetDetector } from "./onsetDetector";

function feedAll(d: OnsetDetector, samples: Float32Array): number[] {
  return d.feed(samples);
}

describe("OnsetDetector", () => {
  it("emits one flux value per completed hop", () => {
    const d = new OnsetDetector(1024, 256);
    // First frame completes after 1024 samples; each further 256 completes another.
    expect(d.feed(new Float32Array(1023))).toHaveLength(0);
    expect(d.feed(new Float32Array(1))).toHaveLength(1);
    expect(d.feed(new Float32Array(512))).toHaveLength(2);
  });

  it("reports near-zero flux for silence and a spike at a noise burst", () => {
    const d = new OnsetDetector(1024, 256);
    const silence = new Float32Array(4096);
    const burst = Float32Array.from({ length: 4096 }, (_, i) =>
      i >= 2048 && i < 2048 + 512 ? (Math.random() * 2 - 1) : 0);
    const quiet = feedAll(d, silence);
    const active = feedAll(d, burst);
    const maxQuiet = Math.max(...quiet, 0);
    const maxActive = Math.max(...active);
    expect(maxActive).toBeGreaterThan(maxQuiet * 10 + 1e-6);
  });

  it("is chunking-invariant", () => {
    const signal = Float32Array.from({ length: 8192 }, (_, i) =>
      Math.sin(i / 30) * (i > 4000 ? 1 : 0.05));
    const a = new OnsetDetector(1024, 256);
    const whole = a.feed(signal);
    const b = new OnsetDetector(1024, 256);
    const parts: number[] = [];
    for (let off = 0; off < signal.length; off += 300) {
      parts.push(...b.feed(signal.subarray(off, Math.min(off + 300, signal.length))));
    }
    expect(parts).toHaveLength(whole.length);
    for (let i = 0; i < whole.length; i++) expect(parts[i]).toBeCloseTo(whole[i]!, 4);
  });

  it("does not mutate its input", () => {
    const d = new OnsetDetector(1024, 256);
    const x = new Float32Array(2048).fill(0.5);
    d.feed(x);
    expect(x[0]).toBe(0.5);
    expect(x[2047]).toBe(0.5);
  });
});
```

- [ ] **Step 2: Run** `npx vitest run src/dsp/onsetDetector.test.ts` — expect FAIL.

- [ ] **Step 3: Implement** `src/dsp/onsetDetector.ts`:

```ts
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
```

- [ ] **Step 4: Run** `npm test` and `npx tsc --noEmit` — all pass.
- [ ] **Step 5: Commit** `feat: spectral-flux onset detector`

---

