### Task 5: 3-band splitter (DSP)

**Files:**
- Create: `src/dsp/bandSplit.ts`
- Test: `src/dsp/bandSplit.test.ts`

**Interfaces:**
- Produces: `class BandSplitter { constructor(sampleRate: number); process(mono: Float32Array): { low: Float32Array; mid: Float32Array; high: Float32Array } }`. Bands sum exactly to the input. Stateful across calls (continuous filters). Crossovers: 200 Hz and 4000 Hz, one-pole low-passes.

- [ ] **Step 1: Write the failing tests** — `src/dsp/bandSplit.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { BandSplitter } from "./bandSplit";

const FS = 48000;

function rms(a: Float32Array): number {
  let s = 0;
  for (const v of a) s += v * v;
  return Math.sqrt(s / a.length);
}

describe("BandSplitter", () => {
  it("bands sum exactly to the input", () => {
    const s = new BandSplitter(FS);
    const x = new Float32Array(512).map(() => Math.random() * 2 - 1);
    const { low, mid, high } = s.process(x);
    for (let i = 0; i < x.length; i++) {
      expect(low[i]! + mid[i]! + high[i]!).toBeCloseTo(x[i]!, 5);
    }
  });

  it("routes a 50 Hz tone mostly to low", () => {
    const s = new BandSplitter(FS);
    const x = Float32Array.from({ length: 9600 }, (_, i) => Math.sin((2 * Math.PI * 50 * i) / FS));
    const { low, mid, high } = s.process(x);
    expect(rms(low)).toBeGreaterThan(rms(mid) * 2);
    expect(rms(low)).toBeGreaterThan(rms(high) * 2);
  });

  it("routes a 12 kHz tone mostly to high", () => {
    const s = new BandSplitter(FS);
    const x = Float32Array.from({ length: 9600 }, (_, i) => Math.sin((2 * Math.PI * 12000 * i) / FS));
    const { low, mid, high } = s.process(x);
    expect(rms(high)).toBeGreaterThan(rms(low) * 2);
    expect(rms(high)).toBeGreaterThan(rms(mid) * 2);
  });

  it("routes a 1 kHz tone mostly to mid", () => {
    const s = new BandSplitter(FS);
    const x = Float32Array.from({ length: 9600 }, (_, i) => Math.sin((2 * Math.PI * 1000 * i) / FS));
    const { low, mid, high } = s.process(x);
    expect(rms(mid)).toBeGreaterThan(rms(low) * 2);
    expect(rms(mid)).toBeGreaterThan(rms(high) * 2);
  });

  it("does not mutate its input and keeps filter state across calls", () => {
    const s = new BandSplitter(FS);
    const x = new Float32Array(64).fill(0.5);
    s.process(x);
    expect(Array.from(x)).toEqual(new Array(64).fill(0.5));
    // Second call continues from previous state: low output keeps rising toward DC.
    const second = s.process(x);
    expect(second.low[0]!).toBeGreaterThan(0.1);
  });
});
```

- [ ] **Step 2: Run** `npx vitest run src/dsp/bandSplit.test.ts` — expect FAIL (module missing).

- [ ] **Step 3: Implement** `src/dsp/bandSplit.ts`:

```ts
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
```

- [ ] **Step 4: Run** `npm test` and `npx tsc --noEmit` — all pass.
- [ ] **Step 5: Commit** `feat: 3-band time-domain splitter for waveform coloring`

---

