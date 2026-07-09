# Task 2 Report: advanceDeck takes samples-per-column

## Summary

Successfully implemented threading of `samplesPerColumn` from `AppConfig` through the render pacing system in `advanceDeck`. The 6th optional parameter maintains backward compatibility with existing 5-arg call sites.

## What Was Implemented

1. **Added 6th parameter to `advanceDeck`**: `samplesPerColumn: number = SAMPLES_PER_COLUMN`
   - Default value preserves existing behavior
   - All existing call sites (with 5 arguments) continue to work

2. **Replaced hardcoded constant with parameter**:
   - Line 34: `head - consumedHead > maxColumns * samplesPerColumn` (was `SAMPLES_PER_COLUMN`)
   - Line 39: `Math.floor(avail / samplesPerColumn)` (was `SAMPLES_PER_COLUMN`)
   - Line 42: `columns * samplesPerColumn` (was `SAMPLES_PER_COLUMN`)

3. **Updated `src/main.ts`**:
   - Added `ZOOM_LEVELS` import from config
   - Changed scratch buffer allocation: `MAX_COLUMNS * Math.max(...ZOOM_LEVELS)` instead of `MAX_COLUMNS * SAMPLES_PER_COLUMN`
   - Passed `config.samplesPerColumn` as 6th argument in `frame()` function

4. **Added test case**:
   - New test: "paces columns by the given samplesPerColumn"
   - Verifies that `advanceDeck` correctly paces columns using custom `samplesPerColumn` value (64 instead of default 256)

## TDD Evidence

### RED Phase (Failing Test)
```
Command: npx vitest run src/render/scrollDriver.test.ts

Result: FAIL
✓ advanceDeck > snaps to the write head on the first frame
✓ advanceDeck > emits no columns until a full column of audio has arrived
✓ advanceDeck > emits exactly the number of whole columns available
✓ advanceDeck > applies the stream gain to the binned amplitudes
✓ advanceDeck > caps columns at maxColumns and resnaps on large backlog
× advanceDeck > paces columns by the given samplesPerColumn
  → Target cannot be null or undefined. (test tried to access renderer.pushes[0] which was empty)
```

### GREEN Phase (Passing Tests)
```
Command: npx vitest run src/render/scrollDriver.test.ts

Result: PASS
✓ src/render/scrollDriver.test.ts (6 tests) 2ms

Test Files  1 passed (1)
      Tests  6 passed (6)
```

### Full Test Suite & TypeCheck
```
Command: npm test

Result: PASS
✓ src/util/channelMix.test.ts (9 tests)
✓ src/render/waveformRenderer.test.ts (6 tests)
✓ src/dsp/waveformBinner.test.ts (5 tests)
✓ src/audio/ringBuffer.test.ts (7 tests)
✓ src/config/decks.test.ts (17 tests)
✓ src/render/scrollDriver.test.ts (6 tests)

Test Files  6 passed (6)
      Tests  50 passed (50)

Command: npx tsc --noEmit
Result: No errors
```

## Files Changed

1. **src/render/scrollDriver.ts**
   - Modified `advanceDeck` function signature (added 6th parameter)
   - Replaced 3 internal uses of `SAMPLES_PER_COLUMN` constant with parameter

2. **src/render/scrollDriver.test.ts**
   - Added new test case for samplesPerColumn parameter

3. **src/main.ts**
   - Added `ZOOM_LEVELS` import
   - Removed `SAMPLES_PER_COLUMN` import
   - Updated scratch buffer allocation to use `Math.max(...ZOOM_LEVELS)`
   - Updated `advanceDeck` call in `frame()` to pass `config.samplesPerColumn`

## Commit

```
commit 00295ca
feat: thread samplesPerColumn through advanceDeck

Add a 6th optional parameter to advanceDeck to accept samplesPerColumn
from AppConfig, replacing the hardcoded SAMPLES_PER_COLUMN constant.
Thread this value through scrollDriver's column pacing logic and update
src/main.ts to size scratch buffers for the maximum zoom level and pass
the configured samplesPerColumn to the frame loop.
```

## Self-Review Findings

### Correctness ✓
- Parameter threading works correctly from `AppConfig` through to `advanceDeck`
- Backward compatibility maintained: 5-arg calls use default parameter
- Test specifically validates custom `samplesPerColumn` value (64) is respected
- All 50 tests pass, including the new one

### Immutability ✓
- No mutations of function inputs
- No state modifications
- Pure function behavior maintained

### Type Safety ✓
- TypeScript compilation succeeds with no errors
- Explicit parameter type `number` with default value
- Proper destructuring of `ZOOM_LEVELS` from config

### Code Quality ✓
- Changes are minimal and focused
- Follows existing patterns in codebase
- Consistent naming and style
- New test follows existing test structure (AAA pattern)

### Constraints Met ✓
- No new npm dependencies added
- Immutable patterns used throughout
- TDD approach followed (failing test first)
- `advanceDeck` keeps 5-arg call shape working via default 6th parameter
- No Co-Authored-By lines
- Conventional commit format used
- All tests and typecheck pass before commit
