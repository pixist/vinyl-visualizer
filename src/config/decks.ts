import type { ChannelMode } from "../util/channelMix";

/**
 * A deck is a named view over one or two input channels of a chosen capture
 * device, mixed to a display signal, with a per-deck delay to compensate for
 * ADC latency skew. Each deck picks its own `deviceId` so two turntables on two
 * separate interfaces (or two USB ADCs) can be captured independently.
 */
export interface DeckConfig {
  id: string;
  label: string;
  deviceId: string | null; // null = system default input
  leftChannel: number;
  rightChannel: number | null;
  mode: ChannelMode;
  delayMs: number;
  gainDb: number; // display gain applied before binning; 0 = unity
  color: string;
}

export interface AppConfig {
  decks: DeckConfig[];
  samplesPerColumn: number;
}

export const MAX_DELAY_MS = 200;
export const MIN_GAIN_DB = -18;
export const MAX_GAIN_DB = 18;
export const ZOOM_LEVELS = [64, 128, 256, 512, 1024] as const;
export const DEFAULT_SAMPLES_PER_COLUMN = 256;
const STORAGE_KEY = "vinyl-visualizer.config.v2";

/** Validate a zoom level from UI or storage; unknown values fall back to default. */
export function clampSamplesPerColumn(v: unknown): number {
  return typeof v === "number" && (ZOOM_LEVELS as readonly number[]).includes(v)
    ? v
    : DEFAULT_SAMPLES_PER_COLUMN;
}

export function defaultConfig(): AppConfig {
  return {
    decks: [
      { id: "a", label: "Deck A", deviceId: null, leftChannel: 0, rightChannel: 1, mode: "mono-sum", delayMs: 0, gainDb: 0, color: "#4fd1ff" },
      { id: "b", label: "Deck B", deviceId: null, leftChannel: 0, rightChannel: 1, mode: "mono-sum", delayMs: 0, gainDb: 0, color: "#ff7b4f" },
    ],
    samplesPerColumn: DEFAULT_SAMPLES_PER_COLUMN,
  };
}

/** Clamp/validate a delay value coming from UI or storage. */
export function clampDelayMs(ms: number): number {
  if (Number.isNaN(ms)) return 0;
  // ±Infinity clamp naturally to the range bounds.
  return Math.min(MAX_DELAY_MS, Math.max(0, ms));
}

/** Clamp/validate a display gain (dB) coming from UI or storage. */
export function clampGainDb(db: number): number {
  if (Number.isNaN(db)) return 0;
  return Math.min(MAX_GAIN_DB, Math.max(MIN_GAIN_DB, db));
}

export function loadConfig(storage: Storage): AppConfig {
  const raw = storage.getItem(STORAGE_KEY);
  if (!raw) return defaultConfig();
  try {
    const parsed = JSON.parse(raw);
    return normalize(parsed);
  } catch {
    return defaultConfig();
  }
}

export function saveConfig(storage: Storage, config: AppConfig): void {
  storage.setItem(STORAGE_KEY, JSON.stringify(config));
}

/** Coerce untrusted parsed JSON into a valid AppConfig, falling back per-field. */
export function normalize(parsed: unknown): AppConfig {
  const fallback = defaultConfig();
  if (typeof parsed !== "object" || parsed === null) return fallback;
  const decksRaw = (parsed as { decks?: unknown }).decks;
  if (!Array.isArray(decksRaw) || decksRaw.length === 0) return fallback;
  const decks = decksRaw.map((d, i) => normalizeDeck(d, fallback.decks[i % fallback.decks.length]!));
  return { decks, samplesPerColumn: clampSamplesPerColumn((parsed as { samplesPerColumn?: unknown }).samplesPerColumn) };
}

function normalizeDeck(d: unknown, base: DeckConfig): DeckConfig {
  if (typeof d !== "object" || d === null) return base;
  const o = d as Record<string, unknown>;
  return {
    id: typeof o.id === "string" ? o.id : base.id,
    label: typeof o.label === "string" ? o.label : base.label,
    deviceId: typeof o.deviceId === "string" ? o.deviceId : null,
    leftChannel: intOr(o.leftChannel, base.leftChannel),
    rightChannel: o.rightChannel === null ? null : intOr(o.rightChannel, base.rightChannel ?? 0),
    mode: isMode(o.mode) ? o.mode : base.mode,
    delayMs: clampDelayMs(typeof o.delayMs === "number" ? o.delayMs : base.delayMs),
    gainDb: clampGainDb(typeof o.gainDb === "number" ? o.gainDb : base.gainDb),
    color: typeof o.color === "string" ? o.color : base.color,
  };
}

function intOr(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : fallback;
}

function isMode(v: unknown): v is ChannelMode {
  return v === "stereo" || v === "mono-sum" || v === "left" || v === "right";
}
