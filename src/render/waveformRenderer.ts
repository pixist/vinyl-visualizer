import type { WaveformBin } from "../dsp/waveformBinner";

const PEAK_ALPHA = 0.4; // translucent peak envelope behind the solid RMS body

export interface RenderColumn extends WaveformBin {
  color?: string; // RMS-body color; peak envelope always uses the deck color
}

function clampUnit(v: number): number {
  if (v > 1) return 1;
  if (v < -1) return -1;
  return v;
}

/**
 * Scrolling past-only waveform on a Canvas 2D context. Newest audio is at the
 * right edge; history scrolls left. Only the newly exposed columns are drawn
 * each frame.
 *
 * Scrolling goes through an offscreen buffer (visible -> buffer, then buffer
 * -> visible shifted) because drawing an accelerated canvas onto itself is
 * silently a no-op in Chrome — the self-copy reads a stale GPU snapshot.
 *
 * Each column draws two layers: a translucent peak envelope (min..max) and a
 * solid RMS body (±rms). Drawing the RMS body means loud/compressed audio shows
 * dynamics instead of collapsing into a solid block, while peaks stay visible.
 */
export class WaveformRenderer {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly buffer: HTMLCanvasElement;
  private readonly bufferCtx: CanvasRenderingContext2D;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly color: string,
  ) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2D canvas context unavailable");
    this.ctx = ctx;

    this.buffer = canvas.ownerDocument.createElement("canvas");
    this.buffer.width = canvas.width;
    this.buffer.height = canvas.height;
    const bufferCtx = this.buffer.getContext("2d");
    if (!bufferCtx) throw new Error("2D canvas context unavailable for scroll buffer");
    this.bufferCtx = bufferCtx;
  }

  /** Scroll left by `bins.length` px, then draw `bins` into the exposed strip. */
  pushColumns(bins: RenderColumn[]): void {
    const w = this.canvas.width;
    const h = this.canvas.height;
    const cols = bins.length;
    if (cols <= 0) return;

    const ctx = this.ctx;
    ctx.globalAlpha = 1;
    if (cols < w) {
      this.scrollLeft(cols, w, h);
    } else {
      ctx.clearRect(0, 0, w, h);
    }

    const x0 = Math.max(0, w - cols);
    const mid = h / 2;

    for (let i = 0; i < cols; i++) {
      const bin = bins[i]!;
      const x = x0 + i;
      if (x >= w) break;

      // Peak envelope (translucent) — always deck color.
      const peakTop = mid - clampUnit(bin.max) * mid;
      const peakBottom = mid - clampUnit(bin.min) * mid;
      ctx.fillStyle = this.color;
      ctx.globalAlpha = PEAK_ALPHA;
      ctx.fillRect(x, peakTop, 1, Math.max(1, peakBottom - peakTop));

      // RMS body (solid) — per-bin band color if available, otherwise deck color.
      const r = clampUnit(bin.rms);
      ctx.fillStyle = bin.color ?? this.color;
      ctx.globalAlpha = 1;
      ctx.fillRect(x, mid - r * mid, 1, Math.max(1, 2 * r * mid));
    }

    ctx.globalAlpha = 1;
  }

  /** Shift the visible bitmap left by `cols` px via the offscreen buffer. */
  private scrollLeft(cols: number, w: number, h: number): void {
    if (this.buffer.width !== w || this.buffer.height !== h) {
      this.buffer.width = w;
      this.buffer.height = h;
    }
    this.bufferCtx.globalAlpha = 1;
    this.bufferCtx.clearRect(0, 0, w, h);
    this.bufferCtx.drawImage(this.canvas, 0, 0);
    this.ctx.clearRect(0, 0, w, h);
    this.ctx.drawImage(this.buffer, cols, 0, w - cols, h, 0, 0, w - cols, h);
  }

  clear(): void {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }
}
