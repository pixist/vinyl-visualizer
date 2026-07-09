### Task 1: Zoom level in config (`samplesPerColumn`)

**Files:**
- Modify: `src/config/decks.ts`
- Test: `src/config/decks.test.ts`

**Interfaces:**
- Produces: `AppConfig.samplesPerColumn: number`, `export const ZOOM_LEVELS = [64, 128, 256, 512, 1024] as const`, `export function clampSamplesPerColumn(v: unknown): number` (returns 256 for anything not in ZOOM_LEVELS).

- [ ] **Step 1: Write the failing tests** — append to `src/config/decks.test.ts` (import `ZOOM_LEVELS, clampSamplesPerColumn` from `./decks`):

```ts
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
```

- [ ] **Step 2: Run** `npx vitest run src/config/decks.test.ts` — expect FAIL (missing exports).

- [ ] **Step 3: Implement** in `src/config/decks.ts`:

```ts
export const ZOOM_LEVELS = [64, 128, 256, 512, 1024] as const;
export const DEFAULT_SAMPLES_PER_COLUMN = 256;

/** Validate a zoom level from UI or storage; unknown values fall back to default. */
export function clampSamplesPerColumn(v: unknown): number {
  return typeof v === "number" && (ZOOM_LEVELS as readonly number[]).includes(v)
    ? v
    : DEFAULT_SAMPLES_PER_COLUMN;
}
```

Add `samplesPerColumn: number` to `AppConfig`; set `samplesPerColumn: DEFAULT_SAMPLES_PER_COLUMN` in `defaultConfig()`; in `normalize()` return `{ decks, samplesPerColumn: clampSamplesPerColumn((parsed as { samplesPerColumn?: unknown }).samplesPerColumn) }`.

- [ ] **Step 4: Run** `npm test` and `npx tsc --noEmit` — all pass.
- [ ] **Step 5: Commit** `feat: persist zoom level (samplesPerColumn) in config`

---

