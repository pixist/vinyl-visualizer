import { describe, it, expect } from "vitest";
import { defaultConfig, normalize, clampDelayMs, clampGainDb, loadConfig, saveConfig, MAX_DELAY_MS, MAX_GAIN_DB, MIN_GAIN_DB, clampSamplesPerColumn } from "./decks";

class MemStorage {
  private m = new Map<string, string>();
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string) { this.m.set(k, v); }
  removeItem(k: string) { this.m.delete(k); }
  clear() { this.m.clear(); }
  key() { return null; }
  get length() { return this.m.size; }
}

describe("clampDelayMs", () => {
  it("clamps to [0, MAX]", () => {
    expect(clampDelayMs(-5)).toBe(0);
    expect(clampDelayMs(9999)).toBe(MAX_DELAY_MS);
    expect(clampDelayMs(50)).toBe(50);
  });
  it("treats non-finite as 0", () => {
    expect(clampDelayMs(NaN)).toBe(0);
    expect(clampDelayMs(Infinity)).toBe(MAX_DELAY_MS);
  });
});

describe("clampGainDb", () => {
  it("clamps to [MIN, MAX]", () => {
    expect(clampGainDb(-999)).toBe(MIN_GAIN_DB);
    expect(clampGainDb(999)).toBe(MAX_GAIN_DB);
    expect(clampGainDb(-6)).toBe(-6);
    expect(clampGainDb(12)).toBe(12);
  });
  it("is a symmetric ±18 dB range", () => {
    expect(MIN_GAIN_DB).toBe(-18);
    expect(MAX_GAIN_DB).toBe(18);
  });
  it("treats NaN as 0", () => {
    expect(clampGainDb(NaN)).toBe(0);
  });
});

describe("normalize", () => {
  it("returns defaults for garbage input", () => {
    expect(normalize(null)).toEqual(defaultConfig());
    expect(normalize(42)).toEqual(defaultConfig());
    expect(normalize({ decks: [] })).toEqual(defaultConfig());
  });

  it("clamps out-of-range delay from untrusted input", () => {
    const cfg = normalize({ decks: [{ id: "x", delayMs: 5000 }] });
    expect(cfg.decks[0]!.delayMs).toBe(MAX_DELAY_MS);
  });

  it("preserves valid fields and fills missing ones", () => {
    const cfg = normalize({ decks: [{ id: "z", leftChannel: 3, mode: "left" }] });
    expect(cfg.decks[0]!.id).toBe("z");
    expect(cfg.decks[0]!.leftChannel).toBe(3);
    expect(cfg.decks[0]!.mode).toBe("left");
  });

  it("rejects an invalid mode and falls back", () => {
    const cfg = normalize({ decks: [{ mode: "surround" }] });
    expect(["stereo", "mono-sum", "left", "right"]).toContain(cfg.decks[0]!.mode);
  });

  it("defaults gainDb to 0, preserves a valid one, and clamps out-of-range", () => {
    expect(normalize({ decks: [{ id: "a" }] }).decks[0]!.gainDb).toBe(0);
    expect(normalize({ decks: [{ gainDb: 18 }] }).decks[0]!.gainDb).toBe(18);
    expect(normalize({ decks: [{ gainDb: -12 }] }).decks[0]!.gainDb).toBe(-12);
    expect(normalize({ decks: [{ gainDb: 500 }] }).decks[0]!.gainDb).toBe(MAX_GAIN_DB);
    expect(normalize({ decks: [{ gainDb: -500 }] }).decks[0]!.gainDb).toBe(MIN_GAIN_DB);
    expect(normalize({ decks: [{ gainDb: "loud" }] }).decks[0]!.gainDb).toBe(0);
  });

  it("defaults deviceId to null and preserves a valid one", () => {
    expect(normalize({ decks: [{ id: "a" }] }).decks[0]!.deviceId).toBeNull();
    expect(normalize({ decks: [{ deviceId: "dev-123" }] }).decks[0]!.deviceId).toBe("dev-123");
    expect(normalize({ decks: [{ deviceId: 42 }] }).decks[0]!.deviceId).toBeNull();
  });
});

describe("loadConfig/saveConfig round-trip", () => {
  it("persists and reloads", () => {
    const s = new MemStorage() as unknown as Storage;
    const cfg = defaultConfig();
    cfg.decks[0]!.delayMs = 42;
    cfg.decks[0]!.gainDb = 12;
    saveConfig(s, cfg);
    expect(loadConfig(s).decks[0]!.delayMs).toBe(42);
    expect(loadConfig(s).decks[0]!.gainDb).toBe(12);
  });

  it("returns defaults when storage is empty", () => {
    const s = new MemStorage() as unknown as Storage;
    expect(loadConfig(s)).toEqual(defaultConfig());
  });

  it("returns defaults when storage holds invalid JSON", () => {
    const s = new MemStorage() as unknown as Storage;
    s.setItem("vinyl-visualizer.config.v2", "{not json");
    expect(loadConfig(s)).toEqual(defaultConfig());
  });
});

describe("samplesPerColumn", () => {
  it("defaults to 256", () => {
    expect(defaultConfig().samplesPerColumn).toBe(256);
  });
  it("accepts only known zoom levels", () => {
    expect(clampSamplesPerColumn(128)).toBe(128);
    expect(clampSamplesPerColumn(300)).toBe(256);
    expect(clampSamplesPerColumn("512")).toBe(256);
    expect(clampSamplesPerColumn(undefined)).toBe(256);
  });
  it("normalizes samplesPerColumn from storage", () => {
    expect(normalize({ decks: [{}], samplesPerColumn: 1024 }).samplesPerColumn).toBe(1024);
    expect(normalize({ decks: [{}], samplesPerColumn: 7 }).samplesPerColumn).toBe(256);
    expect(normalize({ decks: [{}] }).samplesPerColumn).toBe(256);
  });
});
