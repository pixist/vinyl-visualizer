import aubio, { type Tempo } from "aubiojs";
import { RingReader } from "./ringBuffer";
import { mixToMono, type ChannelMode } from "../util/channelMix";

/**
 * Per-deck beat analysis backed by aubio's battle-tested tempo tracker
 * (WASM build of the aubio C library). Consumes the deck's ring buffers at a
 * fixed hop, independent of the waveform path, and feeds each hop to
 * aubio Tempo, which emits a tick on every detected beat. Beats are counted
 * into 4-beat bars; tap-1 / nudge shift which beat is the downbeat.
 *
 * The WASM module loads asynchronously; advance() is a no-op (it just keeps
 * the read cursor snapped to the ring head) until it is ready.
 */

const FRAME = 1024;         // aubio FFT window
const HOP = 256;            // analysis hop, one Tempo.do() call per hop
const MAX_BACKLOG_S = 1;    // resnap if more than this is pending
const BEATS_PER_BAR = 4;

// Module-level singleton: the WASM module is loaded once and shared by decks.
const aubioModule = aubio();

export interface BeatState {
  bpm: number | null;
  barPosition: number; // integer beat index within the bar, 0..3
  confidence: number;
}

export class BeatEngine {
  private tempo: Tempo | null = null;
  private readonly hopScratch = new Float32Array(HOP);
  private readonly scratchL: Float32Array;
  private readonly scratchR: Float32Array;
  private consumed: number | null = null;
  private beatCount = 0;
  private barOffset = 0;
  private lastBpm: number | null = null;
  private lastConfidence = 0;

  constructor(
    private readonly left: RingReader,
    private readonly right: RingReader | null,
    private readonly mode: ChannelMode,
    sampleRate: number,
  ) {
    const maxSamples = Math.ceil(sampleRate * MAX_BACKLOG_S);
    this.scratchL = new Float32Array(maxSamples);
    this.scratchR = new Float32Array(maxSamples);
    this.maxBacklog = maxSamples;
    void aubioModule.then(({ Tempo }) => {
      this.tempo = new Tempo(FRAME, HOP, sampleRate);
    });
  }

  private readonly maxBacklog: number;

  /** Resolves when the shared aubio WASM module has loaded (for tests). */
  static ready(): Promise<void> {
    return aubioModule.then(() => undefined);
  }

  /** Consume all complete new hops written since the last call. */
  advance(): void {
    const written = this.left.totalWritten();
    if (this.consumed === null || written - this.consumed > this.maxBacklog || !this.tempo) {
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

    for (let h = 0; h < hops; h++) {
      this.hopScratch.set(mono.subarray(h * HOP, (h + 1) * HOP));
      const isBeat = this.tempo.do(this.hopScratch) !== 0;
      if (isBeat) {
        this.beatCount++;
        this.lastBpm = this.tempo.getBpm();
        this.lastConfidence = this.tempo.getConfidence();
      }
    }
    this.consumed = end;
  }

  state(): BeatState {
    const mod = (n: number, m: number): number => ((n % m) + m) % m;
    return {
      bpm: this.lastBpm,
      barPosition: mod(this.beatCount + this.barOffset, BEATS_PER_BAR),
      confidence: this.lastConfidence,
    };
  }

  /** Mark the most recent beat as beat 1 of the bar. */
  tap1(): void {
    this.barOffset = -this.beatCount;
  }

  /** Shift the downbeat by whole beats. */
  nudge(delta: number): void {
    this.barOffset += delta;
  }
}
