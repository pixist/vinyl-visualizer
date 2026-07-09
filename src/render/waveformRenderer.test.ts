import { describe, it, expect } from "vitest";
import { WaveformRenderer } from "./waveformRenderer";
import type { WaveformBin } from "../dsp/waveformBinner";

/**
 * Chrome's GPU-accelerated 2D canvas silently no-ops `drawImage` when a canvas
 * is drawn onto itself (stale/empty snapshot), which froze the scroll in M0.
 * These tests pin the fix: scrolling must go through an offscreen buffer and
 * the visible canvas must never be a drawImage source for its own context.
 */

type Op = [name: string, ...args: unknown[]];

class FakeCtx {
  ops: Op[] = [];
  globalAlpha = 1;
  fillStyle = "";
  constructor(readonly canvas: FakeCanvas) {}
  drawImage(...args: unknown[]): void {
    this.ops.push(["drawImage", ...args]);
  }
  clearRect(...args: unknown[]): void {
    this.ops.push(["clearRect", ...args]);
  }
  fillRect(...args: unknown[]): void {
    this.ops.push(["fillRect", ...args]);
  }
}

class FakeCanvas {
  width = 100;
  height = 40;
  readonly ctx = new FakeCtx(this);
  readonly created: FakeCanvas[] = [];
  ownerDocument = {
    createElement: (): FakeCanvas => {
      const c = new FakeCanvas();
      this.created.push(c);
      return c;
    },
  };
  getContext(): FakeCtx {
    return this.ctx;
  }
}

function makeRenderer() {
  const canvas = new FakeCanvas();
  const renderer = new WaveformRenderer(canvas as unknown as HTMLCanvasElement, "#123456");
  return { canvas, renderer };
}

function bin(min: number, max: number, rms: number): WaveformBin {
  return { min, max, rms };
}

function drawImageOps(ctx: FakeCtx): Op[] {
  return ctx.ops.filter(([name]) => name === "drawImage");
}

describe("WaveformRenderer scroll", () => {
  it("never draws the visible canvas onto itself", () => {
    const { canvas, renderer } = makeRenderer();
    renderer.pushColumns([bin(-0.5, 0.5, 0.3), bin(-0.1, 0.1, 0.05)]);
    for (const op of drawImageOps(canvas.ctx)) {
      expect(op[1]).not.toBe(canvas);
    }
  });

  it("scrolls by copying visible -> buffer, then buffer -> visible shifted left", () => {
    const { canvas, renderer } = makeRenderer();
    renderer.pushColumns([bin(-0.5, 0.5, 0.3), bin(-0.1, 0.1, 0.05), bin(0, 0, 0)]);

    expect(canvas.created).toHaveLength(1);
    const buffer = canvas.created[0]!;
    expect(buffer.width).toBe(canvas.width);
    expect(buffer.height).toBe(canvas.height);

    // Buffer received a snapshot of the visible canvas.
    const bufferBlits = drawImageOps(buffer.ctx);
    expect(bufferBlits).toHaveLength(1);
    expect(bufferBlits[0]![1]).toBe(canvas);

    // Visible canvas received the buffer, shifted left by `cols`.
    const visibleBlits = drawImageOps(canvas.ctx);
    expect(visibleBlits).toHaveLength(1);
    expect(visibleBlits[0]!.slice(1)).toEqual([buffer, 3, 0, 97, 40, 0, 0, 97, 40]);
  });

  it("draws two strips (peak + rms) per bin in the newly exposed right edge", () => {
    const { canvas, renderer } = makeRenderer();
    renderer.pushColumns([bin(-0.5, 0.5, 0.3), bin(-0.1, 0.1, 0.05)]);

    const fills = canvas.ctx.ops.filter(([name]) => name === "fillRect");
    expect(fills).toHaveLength(4);
    for (const [, x] of fills) {
      expect(x as number).toBeGreaterThanOrEqual(canvas.width - 2);
      expect(x as number).toBeLessThan(canvas.width);
    }
  });

  it("skips the scroll blit and clears fully when columns cover the whole width", () => {
    const { canvas, renderer } = makeRenderer();
    const bins = Array.from({ length: canvas.width }, () => bin(-0.2, 0.2, 0.1));
    renderer.pushColumns(bins);

    expect(drawImageOps(canvas.ctx)).toHaveLength(0);
    const fills = canvas.ctx.ops.filter(([name]) => name === "fillRect");
    expect(fills).toHaveLength(2 * canvas.width);
  });

  it("resizes the buffer when the visible canvas was resized", () => {
    const { canvas, renderer } = makeRenderer();
    renderer.pushColumns([bin(0, 0, 0)]);
    canvas.width = 200;
    renderer.pushColumns([bin(0, 0, 0)]);
    const buffer = canvas.created[0]!;
    expect(buffer.width).toBe(200);
  });

  it("does nothing for an empty bin list", () => {
    const { canvas, renderer } = makeRenderer();
    renderer.pushColumns([]);
    expect(canvas.ctx.ops).toHaveLength(0);
  });
});
