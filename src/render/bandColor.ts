/** Serato-style band palette: low = red, mid = green, high = blue. */
export const BAND_COLORS = {
  low: [235, 70, 70],
  mid: [80, 200, 120],
  high: [90, 140, 255],
} as const;

/**
 * Blend the band palette weighted by per-band RMS. Returns a CSS rgb() string,
 * or null for silence (caller falls back to the deck color).
 */
export function colorForBands(low: number, mid: number, high: number): string | null {
  const total = low + mid + high;
  if (total <= 0) return null;
  const ch = (i: 0 | 1 | 2) =>
    Math.round((low * BAND_COLORS.low[i] + mid * BAND_COLORS.mid[i] + high * BAND_COLORS.high[i]) / total);
  return `rgb(${ch(0)},${ch(1)},${ch(2)})`;
}
