### Task 6: BeatEngine + main-loop wiring

**Files:**
- Create: `src/audio/beatEngine.ts`
- Modify: `src/main.ts`
- Test: `src/audio/beatEngine.test.ts`

**Interfaces:**
- Consumes: `RingReader` (src/audio/ringBuffer.ts), `mixToMono`/`ChannelMode` (src/util/channelMix.ts), `OnsetDetector` (Task 2), `estimateBpm` (Task 3), `BeatTracker` (Task 4), `createBeatView`/`updateBeatView` (Task 5), `DeckElements.head` (Task 5).
- Produces:

```ts
export class BeatEngine {
  constructor(left: RingReader, right: RingReader | null, mode: ChannelMode, sampleRate: number);
  advance(): void; // consume all complete new hops since the last call
  state(): { bpm: number | null; barPosition: number; confidence: number };
  tap1(): void;
  nudge(delta: number): void;
}
```

- [ ] **Step 1: Write the failing test** — `src/audio/beatEngine.test.ts`:

```ts
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
```

- [ ] **Step 2: Run** `npx vitest run src/audio/beatEngine.test.ts` — expect FAIL.

- [ ] **Step 3: Implement** `src/audio/beatEngine.ts`:

```ts
import { RingReader } from "./ringBuffer";
import { mixToMono, type ChannelMode } from "../util/channelMix";
import { OnsetDetector } from "../dsp/onsetDetector";
import { estimateBpm, type TempoEstimate } from "../dsp/tempoEstimator";
import { BeatTracker } from "../dsp/beatTracker";

/**
 * Per-deck beat analysis: consumes the deck's ring buffers at a fixed hop,
 * independent of the waveform path, and feeds onset flux into the tempo
 * estimator (drift anchor) and PLL beat tracker. Call advance() every frame.
 */

const HOP = 256;
const FLUX_WINDOW_S = 10;   // rolling window handed to estimateBpm
const ESTIMATE_EVERY = 64;  // hops between tempo re-estimates (~0.34 s)
const MAX_BACKLOG_S = 1;    // resnap if more than this is pending

export interface BeatState {
  bpm: number | null;
  barPosition: number;
  confidence: number;
}

export class BeatEngine {
  private readonly detector = new OnsetDetector(1024, HOP);
  private readonly tracker: BeatTracker;
  private readonly flux: number[] = [];
  private readonly maxFlux: number;
  private readonly hopSeconds: number;
  private readonly scratchL: Float32Array;
  private readonly scratchR: Float32Array;
  private consumed: number | null = null;
  private hopsSinceEstimate = 0;
  private lastEstimate: TempoEstimate | null = null;

  constructor(
    private readonly left: RingReader,
    private readonly right: RingReader | null,
    private readonly mode: ChannelMode,
    private readonly sampleRate: number,
  ) {
    this.hopSeconds = HOP / sampleRate;
    this.maxFlux = Math.ceil(FLUX_WINDOW_S / this.hopSeconds);
    this.tracker = new BeatTracker(this.hopSeconds);
    const maxSamples = Math.ceil(sampleRate * MAX_BACKLOG_S);
    this.scratchL = new Float32Array(maxSamples);
    this.scratchR = new Float32Array(maxSamples);
  }

  /** Consume all complete new hops written since the last call. */
  advance(): void {
    const written = this.left.totalWritten();
    if (this.consumed === null || written - this.consumed > this.sampleRate * MAX_BACKLOG_S) {
      this.consumed = written - (written % HOP);
      return;
    }
    const avail = written - this.consumed;
    const hops = Math.floor(avail / HOP);
    if (hops <= 0) return;

    const count = hops * HOP;
    const end = this.consumed + count;
    const delay = written - end;
    const left = this.left.readRecent(this.scratchL, count, delay).subarray(0, count);
    const right = this.right
      ? this.right.readRecent(this.scratchR, count, delay).subarray(0, count)
      : null;
    const mono = mixToMono(left, right, this.mode);

    for (const fluxValue of this.detector.feed(mono)) {
      this.flux.push(fluxValue);
      if (this.flux.length > this.maxFlux) this.flux.shift();
      this.hopsSinceEstimate++;
      if (this.hopsSinceEstimate >= ESTIMATE_EVERY) {
        this.hopsSinceEstimate = 0;
        this.lastEstimate = estimateBpm(this.flux, this.hopSeconds);
      }
      this.tracker.update(fluxValue, this.lastEstimate);
      this.lastEstimate = null; // hand each estimate to the tracker once
    }
    this.consumed = end;
  }

  state(): BeatState {
    return {
      bpm: this.tracker.bpm,
      barPosition: this.tracker.barPosition(),
      confidence: this.tracker.confidence,
    };
  }

  tap1(): void {
    this.tracker.tap1();
  }

  nudge(delta: number): void {
    this.tracker.nudge(delta);
  }
}
```

- [ ] **Step 4: Wire into `src/main.ts`:**
  - `DeckRuntime` gains `beatEngine: BeatEngine` and `beatView: BeatViewElements`.
  - In `buildRuntimes()`, after creating the stream, create the engine and view and mount the view:

```ts
const beatEngine = new BeatEngine(leftReader, rightReader, deck.mode, handle.sampleRate);
const beatView = createBeatView({
  onTap: () => beatEngine.tap1(),
  onNudge: (d) => beatEngine.nudge(d),
});
view.head.append(beatView.root);
```

  (Remove any previously mounted `.beat` element from `view.head` first: `view.head.querySelector(".beat")?.remove();` — restarts rebuild runtimes.)
  - In `frame()`, after `advanceDeck`: `rt.beatEngine.advance(); updateBeatView(rt.beatView, rt.beatEngine.state());`
  - In `stopAll()`, also remove beat views: `for (const view of views.values()) view.head.querySelector(".beat")?.remove();`

- [ ] **Step 5: Run** `npm test` and `npx tsc --noEmit` — all pass. The BeatEngine test is the slowest in the suite (~1s); that's acceptable.
- [ ] **Step 6: Commit** `feat: per-deck beat engine wired to bar indicator UI`

---

## Self-Review Notes

- Spec coverage: spectral-flux onsets (T2), autocorrelation tempo + drift anchor (T3), PLL tracker with drift tracking (T4), 4-block bar indicator + tap-1/nudge (T5, T6). ✔
- Type consistency: `TempoEstimate` defined in T3, consumed in T4/T6; `BeatState` in T6; `DeckElements.head` added in T5, used in T6. ✔
- The M1 `onRoutingChange` TODO (restart on mode change) is unaffected: BeatEngine is rebuilt on restart like the waveform runtimes. ✔
- Tuning latitude for T4 gains is stated in Global Constraints. ✔
