### Task 2: `advanceDeck` takes samples-per-column

**Files:**
- Modify: `src/render/scrollDriver.ts`
- Modify: `src/main.ts`
- Test: `src/render/scrollDriver.test.ts`

**Interfaces:**
- Consumes: `AppConfig.samplesPerColumn` (Task 1).
- Produces: `advanceDeck(stream, consumedHead, scratchL, scratchR, maxColumns, samplesPerColumn = SAMPLES_PER_COLUMN)` — 6th optional param; all M0 call sites keep working.

- [ ] **Step 1: Write the failing test** — append to `src/render/scrollDriver.test.ts`:

```ts
it("paces columns by the given samplesPerColumn", () => {
  const { writer, renderer, stream } = makeStream(48000);
  let consumed = advanceDeck(stream, null, scratch, scratch, 32, 64); // snap at 0
  writer.write(new Float32Array(3 * 64 + 5));
  consumed = advanceDeck(stream, consumed, scratch, scratch, 32, 64);
  expect(renderer.pushes[0]).toHaveLength(3);
  expect(consumed).toBe(3 * 64);
});
```

- [ ] **Step 2: Run** `npx vitest run src/render/scrollDriver.test.ts` — expect FAIL.

- [ ] **Step 3: Implement**: in `advanceDeck`, add trailing param `samplesPerColumn: number = SAMPLES_PER_COLUMN` and replace every internal use of `SAMPLES_PER_COLUMN` with it. In `src/main.ts`: size scratch for the largest zoom — `const scratchL = new Float32Array(MAX_COLUMNS * Math.max(...ZOOM_LEVELS));` (import `ZOOM_LEVELS` from config) — and pass `config.samplesPerColumn` as the 6th argument in `frame()`.

- [ ] **Step 4: Run** `npm test` and `npx tsc --noEmit` — all pass.
- [ ] **Step 5: Commit** `feat: thread samplesPerColumn through advanceDeck`

---

