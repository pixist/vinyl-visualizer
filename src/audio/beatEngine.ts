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
