import type { TempoEstimate } from "./tempoEstimator";

/**
 * Phase-locked-loop beat tracker. Time advances one hop per update(). The
 * autocorrelation tempo hint seeds and slowly anchors the period; observed
 * onset peaks near the predicted beat pull phase (strongly) and period
 * (weakly), which tracks vinyl drift. Beats count monotonically; the bar
 * indicator is beatIndex modulo 4 with a user-settable offset (tap-1/nudge).
 */

const PHASE_GAIN = 0.3;        // fraction of phase error corrected per onset
const PERIOD_GAIN = 0.05;      // fraction of phase error fed into the period
const TEMPO_BLEND = 0.02;      // per-update blend toward a confident hint
const HINT_MIN_CONFIDENCE = 0.2;
const HINT_MAX_DEVIATION = 0.1; // ignore hints >10% off the locked period
const ONSET_WINDOW = 0.25;     // accept onsets within ±25% of the period
const FLUX_MEAN_DECAY = 0.995; // adaptive threshold time constant
const FLUX_THRESHOLD = 2.5;    // onset = flux > mean * this
const CONFIDENCE_UP = 0.15;
const CONFIDENCE_DECAY = 0.0005;
const BEATS_PER_BAR = 4;
const MIN_PERIOD_S = 60 / 200;

export class BeatTracker {
  confidence = 0;

  private time = 0;
  private period: number | null = null;
  private nextBeat = 0;
  private beatIndex = -1;
  private barOffset = 0;
  private fluxMean = 0;
  private prevFlux = 0;
  private prevPrevFlux = 0;

  constructor(private readonly hopSeconds: number) {}

  get bpm(): number | null {
    return this.period === null ? null : 60 / this.period;
  }

  update(flux: number, hint: TempoEstimate | null): void {
    this.time += this.hopSeconds;
    this.fluxMean = FLUX_MEAN_DECAY * this.fluxMean + (1 - FLUX_MEAN_DECAY) * flux;

    this.applyHint(hint);
    if (this.period !== null) {
      this.trackOnset(flux);
      while (this.time >= this.nextBeat) {
        this.beatIndex++;
        this.nextBeat += this.period;
      }
    }

    this.prevPrevFlux = this.prevFlux;
    this.prevFlux = flux;
  }

  /** 0..1 position within the current beat (0 = just on the beat). */
  phase(): number {
    if (this.period === null) return 0;
    const untilNext = this.nextBeat - this.time;
    return Math.min(1, Math.max(0, 1 - untilNext / this.period));
  }

  barPosition(): number {
    if (this.beatIndex < 0) return 0;
    return (((this.beatIndex - this.barOffset) % BEATS_PER_BAR) + BEATS_PER_BAR) % BEATS_PER_BAR;
  }

  tap1(): void {
    if (this.beatIndex >= 0) this.barOffset = ((this.beatIndex % BEATS_PER_BAR) + BEATS_PER_BAR) % BEATS_PER_BAR;
  }

  nudge(delta: number): void {
    this.barOffset = (((this.barOffset + delta) % BEATS_PER_BAR) + BEATS_PER_BAR) % BEATS_PER_BAR;
  }

  private applyHint(hint: TempoEstimate | null): void {
    if (!hint || hint.confidence < HINT_MIN_CONFIDENCE) return;
    const hintPeriod = 60 / hint.bpm;
    if (this.period === null) {
      this.period = hintPeriod;
      this.nextBeat = this.time + hintPeriod;
      return;
    }
    if (Math.abs(hintPeriod - this.period) / this.period <= HINT_MAX_DEVIATION) {
      this.period += TEMPO_BLEND * (hintPeriod - this.period);
    }
  }

  private trackOnset(flux: number): void {
    // One-hop-delayed local-max decision so we see both neighbours.
    const isOnset =
      this.prevFlux > this.fluxMean * FLUX_THRESHOLD &&
      this.prevFlux >= this.prevPrevFlux &&
      this.prevFlux >= flux;
    if (!isOnset) {
      this.confidence = Math.max(0, this.confidence - CONFIDENCE_DECAY);
      return;
    }
    const onsetTime = this.time - this.hopSeconds;
    // Compare against the nearest predicted beat (previous or next).
    const prevBeat = this.nextBeat - this.period!;
    const errNext = onsetTime - this.nextBeat;
    const errPrev = onsetTime - prevBeat;
    const err = Math.abs(errPrev) < Math.abs(errNext) ? errPrev : errNext;
    if (Math.abs(err) <= this.period! * ONSET_WINDOW) {
      this.nextBeat += PHASE_GAIN * err;
      this.period = Math.max(MIN_PERIOD_S, this.period! + PERIOD_GAIN * err);
      this.confidence = Math.min(1, this.confidence + CONFIDENCE_UP);
    }
  }
}
