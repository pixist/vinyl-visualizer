/**
 * Beat grid overlay: vertical lines that flow with the scrolling waveform.
 *
 * The last (up to) SHOWN_BEATS detected beats are drawn at their true
 * positions — maximally reactive, so a tempo ride visibly contracts or
 * expands their spacing. Left of the oldest of those, the median spacing of
 * the shown beats repeats as dimmer "projected" lines, giving the DJ a
 * steady ruler to compare deck against deck.
 */

const SHOWN_BEATS = 4;      // newest beats drawn at their detected positions
const MIN_SPACING_PX = 8;   // below this the projection is unreadable; skip it
const DETECTED_ALPHA = 0.85;
const PROJECTED_ALPHA = 0.3;

export interface GridLine {
  x: number;
  isDetected: boolean; // true: one of the last 4 real beats; false: projection
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

/**
 * Maps recent beat sample positions to canvas x coordinates.
 * `rightEdgeSample` is the absolute sample index drawn at the right edge and
 * `samplesPerColumn` the current zoom (1 column = 1 px).
 */
export function computeGridLines(
  beats: readonly number[],
  rightEdgeSample: number,
  samplesPerColumn: number,
  width: number,
): GridLine[] {
  const shown = beats.slice(-SHOWN_BEATS).filter((b) => {
    const x = width - (rightEdgeSample - b) / samplesPerColumn;
    return x >= 0;
  });
  if (shown.length < 2) return [];

  const toX = (sample: number): number =>
    width - (rightEdgeSample - sample) / samplesPerColumn;

  const lines: GridLine[] = shown.map((b) => ({ x: toX(b), isDetected: true }));

  const intervals: number[] = [];
  for (let i = 1; i < shown.length; i++) intervals.push(shown[i]! - shown[i - 1]!);
  const spacingPx = median(intervals) / samplesPerColumn;
  if (spacingPx < MIN_SPACING_PX) return lines;

  for (let x = lines[0]!.x - spacingPx; x >= 0; x -= spacingPx) {
    lines.push({ x, isDetected: false });
  }
  return lines;
}

/** Redraws the grid overlay canvas for this frame. */
export function drawBeatGrid(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  beats: readonly number[],
  rightEdgeSample: number,
  samplesPerColumn: number,
  color: string,
): void {
  ctx.clearRect(0, 0, width, height);
  const lines = computeGridLines(beats, rightEdgeSample, samplesPerColumn, width);
  ctx.fillStyle = color;
  for (const line of lines) {
    ctx.globalAlpha = line.isDetected ? DETECTED_ALPHA : PROJECTED_ALPHA;
    ctx.fillRect(Math.round(line.x), 0, 1, height);
  }
  ctx.globalAlpha = 1;
}
