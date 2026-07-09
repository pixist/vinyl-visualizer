/** Deck channel-mixing modes. See config/decks.ts for how a deck maps to inputs. */
export type ChannelMode = "stereo" | "mono-sum" | "left" | "right";

/** Convert a display gain in dB to a linear amplitude factor (0 dB -> 1). */
export function dbToLinear(db: number): number {
  return Math.pow(10, db / 20);
}

/**
 * Reduce a deck's one or two input channels into a single mono display signal
 * according to `mode`, scaled by the linear `gain` factor. `right` may be
 * absent for a mono input. Returns a new Float32Array (never mutates inputs).
 */
export function mixToMono(
  left: Float32Array,
  right: Float32Array | null,
  mode: ChannelMode,
  gain = 1,
): Float32Array {
  const n = left.length;
  const out = new Float32Array(n);
  const r = right ?? left;
  switch (mode) {
    case "left":
      for (let i = 0; i < n; i++) out[i] = gain * left[i]!;
      return out;
    case "right":
      for (let i = 0; i < n; i++) out[i] = gain * r[i]!;
      return out;
    case "mono-sum":
    case "stereo": // M0 renders a single lane; stereo split lands in M1.
      for (let i = 0; i < n; i++) out[i] = gain * 0.5 * (left[i]! + r[i]!);
      return out;
  }
}
