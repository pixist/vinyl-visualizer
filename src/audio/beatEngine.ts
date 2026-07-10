import aubio, { type Tempo } from "aubiojs";
import { RingReader } from "./ringBuffer";
import { mixToMono, type ChannelMode } from "../util/channelMix";

/**
 * Per-deck beat analysis backed by aubio's battle-tested tempo tracker
 * (WASM build of the aubio C library). Consumes the deck's ring buffers at a
 * fixed hop, independent of the waveform path, and feeds each hop to
 * aubio Tempo, which emits a tick on detected beats.
 *
 * aubio can miss soft beats (it ticks reliably on strong ones), so the bar
 * grid is time-based, not tick-based: each tick re-anchors a beat grid whose
 * period comes from the median BPM, and the current beat index is derived
 * from elapsed samples. Missed ticks therefore advance the grid by the right
 * number of beats instead of stalling it.
 *
 * The WASM module loads asynchronously; advance() is a no-op (it just keeps
 * the read cursor snapped to the ring head) until it is ready.
 */

const FRAME = 1024;         // aubio FFT window
const HOP = 256;            // analysis hop, one Tempo.do() call per hop
const MAX_BACKLOG_S = 1;    // resnap if more than this is pending
const BEATS_PER_BAR = 4;
const BPM_MEDIAN_WINDOW = 9;     // beats of history the displayed BPM is the median of
const PHASE_ENERGY_DECAY = 0.85; // per-bar decay of the downbeat energy accumulators
const ACCENT_HOPS = 16;          // hops (~85 ms) integrated per beat for accent energy
const ANCHOR_MARGIN = 1.5;       // re-anchor only when a phase is this much louder
const MAX_TICK_HISTORY = 8;      // detected beat positions kept for the grid overlay

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
  private readonly maxBacklog: number;
  private consumed: number | null = null;

  // Time-based beat grid: `gridBeat` counts beats since start; ticks re-anchor
  // it at the current sample position so missed ticks don't lose beats.
  private gridBeat = 0;
  private anchorSample = 0;
  private barOffset = 0;
  private isOffsetManual = false;

  private readonly bpmHistory: number[] = [];
  private readonly tickSamples: number[] = [];
  private readonly phaseEnergy = new Float64Array(BEATS_PER_BAR);
  private accentPhase = 0;
  private accentHopsLeft = 0;
  private lastBpm: number | null = null;
  private lastConfidence = 0;

  constructor(
    private readonly left: RingReader,
    private readonly right: RingReader | null,
    private readonly mode: ChannelMode,
    private readonly sampleRate: number,
  ) {
    const maxSamples = Math.ceil(sampleRate * MAX_BACKLOG_S);
    this.scratchL = new Float32Array(maxSamples);
    this.scratchR = new Float32Array(maxSamples);
    this.maxBacklog = maxSamples;
    void aubioModule.then(({ Tempo }) => {
      this.tempo = new Tempo(FRAME, HOP, this.sampleRate);
    });
  }

  /** Resolves when the shared aubio WASM module has loaded (for tests). */
  static ready(): Promise<void> {
    return aubioModule.then(() => undefined);
  }

  private samplesPerBeat(): number | null {
    return this.lastBpm === null ? null : (60 / this.lastBpm) * this.sampleRate;
  }

  /** Whole beats elapsed at sample position `s` according to the grid. */
  private beatAt(s: number): number {
    const period = this.samplesPerBeat();
    if (period === null) return this.gridBeat;
    return this.gridBeat + Math.floor((s - this.anchorSample) / period + 0.5);
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
      const hopStart = this.consumed + h * HOP;
      if (isBeat) {
        this.recordBpm(this.tempo.getBpm());
        this.lastConfidence = this.tempo.getConfidence();
        // Re-anchor the grid on this tick, advancing by however many beat
        // periods actually elapsed (>=1 when aubio skipped soft beats).
        this.gridBeat = Math.max(this.gridBeat + 1, this.beatAt(hopStart));
        this.anchorSample = hopStart;
        this.tickSamples.push(hopStart);
        if (this.tickSamples.length > MAX_TICK_HISTORY) this.tickSamples.shift();
        this.startAccentWindow();
      }
      this.accumulateAccentEnergy(this.hopScratch);
    }
    this.consumed = end;
  }

  /**
   * The displayed BPM is the median of the last few per-beat readings, so
   * momentary tracker jitter doesn't wobble the readout and two decks fed
   * the same signal settle on the same number.
   */
  private recordBpm(bpm: number): void {
    this.bpmHistory.push(bpm);
    if (this.bpmHistory.length > BPM_MEDIAN_WINDOW) this.bpmHistory.shift();
    const sorted = [...this.bpmHistory].sort((a, b) => a - b);
    this.lastBpm = sorted[Math.floor(sorted.length / 2)]!;
  }

  /**
   * aubio finds beats, not downbeats. Integrate the ~85 ms of audio after
   * each beat tick into a decaying bucket per bar phase and auto-anchor
   * beat 1 to the clearly loudest phase — until the user taps 1 or nudges,
   * which takes over permanently. The window (rather than the tick's single
   * hop) absorbs the offset between aubio's tick and the actual transient;
   * the margin keeps uniform material from flapping the anchor.
   */
  private startAccentWindow(): void {
    this.accentPhase = ((this.gridBeat % BEATS_PER_BAR) + BEATS_PER_BAR) % BEATS_PER_BAR;
    if (this.accentPhase === 0) {
      for (let p = 0; p < BEATS_PER_BAR; p++) this.phaseEnergy[p]! *= PHASE_ENERGY_DECAY;
    }
    this.accentHopsLeft = ACCENT_HOPS;
  }

  private accumulateAccentEnergy(hop: Float32Array): void {
    if (this.accentHopsLeft <= 0) return;
    this.accentHopsLeft--;
    let sumSquares = 0;
    for (let i = 0; i < hop.length; i++) sumSquares += hop[i]! * hop[i]!;
    this.phaseEnergy[this.accentPhase] = this.phaseEnergy[this.accentPhase]! + sumSquares;
    if (this.accentHopsLeft > 0 || this.isOffsetManual) return;

    let loudest = 0;
    for (let p = 1; p < BEATS_PER_BAR; p++) {
      if (this.phaseEnergy[p]! > this.phaseEnergy[loudest]!) loudest = p;
    }
    const current = ((-this.barOffset % BEATS_PER_BAR) + BEATS_PER_BAR) % BEATS_PER_BAR;
    if (loudest === current) return;
    if (this.phaseEnergy[loudest]! > this.phaseEnergy[current]! * ANCHOR_MARGIN) {
      this.barOffset = -loudest;
    }
  }

  state(): BeatState {
    const mod = (n: number, m: number): number => ((n % m) + m) % m;
    const now = this.consumed ?? 0;
    return {
      bpm: this.lastBpm,
      barPosition: mod(this.beatAt(now) + this.barOffset, BEATS_PER_BAR),
      confidence: this.lastConfidence,
    };
  }

  /** Mark the current beat as beat 1 of the bar (disables auto-anchoring). */
  tap1(): void {
    this.isOffsetManual = true;
    this.barOffset = -this.beatAt(this.consumed ?? 0);
  }

  /** Shift the downbeat by whole beats (disables auto-anchoring). */
  nudge(delta: number): void {
    this.isOffsetManual = true;
    this.barOffset += delta;
  }

  /** Absolute sample positions of the most recent detected beats (oldest first). */
  recentBeats(): readonly number[] {
    return this.tickSamples;
  }

  /** Forget everything: fresh aubio tracker, BPM history, grid, and bar anchor. */
  resetAnalysis(): void {
    this.tickSamples.length = 0;
    void aubioModule.then(({ Tempo }) => {
      this.tempo = new Tempo(FRAME, HOP, this.sampleRate);
    });
    this.tempo = null;
    this.bpmHistory.length = 0;
    this.lastBpm = null;
    this.lastConfidence = 0;
    this.gridBeat = 0;
    this.anchorSample = 0;
    this.consumed = null;
    this.resetBar();
  }

  /** Forget only the bar anchor: re-runs downbeat auto-detection. */
  resetBar(): void {
    this.isOffsetManual = false;
    this.barOffset = 0;
    this.phaseEnergy.fill(0);
    this.accentHopsLeft = 0;
  }
}
