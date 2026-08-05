# Task 1000 — Test Author

**Task ID:** 1000
**Agent:** test-author (Z.ai Code)
**Task:** Create comprehensive test suites for 11 untested source modules.

## Summary

Created 11 new test files in `/home/z/my-project/tests/` covering all the requested source modules. All 316 tests pass with zero lint errors.

## Modules Covered & Test Counts

| # | Source Module | Test File | Tests |
|---|---|---|---|
| 1 | `src/lib/math-fixer.ts` | `tests/math-fixer.test.ts` | 24 |
| 2 | `src/lib/form-fixer.ts` | `tests/form-fixer.test.ts` | 17 |
| 3 | `src/lib/css-fixer.ts` | `tests/css-fixer.test.ts` | 21 |
| 4 | `src/lib/build-store.ts` | `tests/build-store.test.ts` | 16 |
| 5 | `src/lib/helpers.ts` | `tests/helpers.test.ts` | 53 |
| 6 | `src/lib/plan-adherence.ts` | `tests/plan-adherence.test.ts` | 23 |
| 7 | `src/lib/smart-suggestions.ts` | `tests/smart-suggestions.test.ts` | 25 |
| 8 | `src/lib/design-tokens.ts` | `tests/design-tokens.test.ts` | 37 |
| 9 | `src/lib/runtime-errors.ts` | `tests/runtime-errors.test.ts` | 28 |
| 10 | `src/lib/logger.ts` | `tests/logger.test.ts` | 32 |
| 11 | `src/lib/model-circuit-breaker.ts` | `tests/model-circuit-breaker.test.ts` | 40 |
| **Total** | | | **316** |

## Coverage Highlights

### `math-fixer.ts` (24 tests)
- `fixConversionMath`: meter→km inversion fix, context-aware fixing (200-char window),
  multi-match handling, idempotency, edge cases (empty string, no scripts).
- `verifyMath`: detects inverted `meter * 1000` and `1000 * meter` patterns, multi-script scanning,
  script tag stripping, case-insensitive matching, no-op for non-conversion contexts.

### `form-fixer.ts` (17 tests)
- `fixForms`: submit-handler injection, modal save/cancel handlers (`.modal`, `#addTaskModal`,
  `data-modal` markers), `type="button"` injection for buttons with onclick, no-op when no forms,
  multi-form handling, no-`</body>` graceful handling.

### `css-fixer.ts` (21 tests)
- `fixCss`: modal CSS injection (4 modal markers), search handler injection (`type="search"`,
  `placeholder="...search"`), `addTaskBtn` position:fixed → relative fix, multi-fix combination,
  no-`</head>` graceful handling, idempotency.

### `build-store.ts` (16 tests)
- `registerBuild`: status="building", timestamp preservation, overwrite behavior.
- `storeResult`: completed status, optional fields (files, outputType, previewable, suggestions),
  timestamp fallback when no prior entry.
- `storeError`: failed status, error message storage, timestamp preservation.
- `getResult`: null for unknown IDs, correct status reflection, `MAX_ENTRIES=50` eviction.

### `helpers.ts` (53 tests)
- `newBuildId`: prefix `b_`, 3-part structure, 100-unique-call check.
- `sanitizeFilename`: lowercase, dash collapse, 30-char limit, `app.html` fallback, unicode handling.
- `isValidHistoryItem`: 14 cases — valid/invalid inputs, type-narrowing verification.
- `validateHistory`: non-array → [], invalid filtering, dedup by id, 30-item cap.
- `normalizeMission`: lowercase, whitespace collapse, punctuation handling, snake_game underscore.
- `groupHistoryByMission`: grouping, `maxGroups`/`maxPerGroup` caps, default args, ordering.

### `plan-adherence.ts` (23 tests)
- `checkPlanAdherence`: null/undefined/non-object plans, features array, `key_features` fallback,
  `keyFunctions` (0.4 threshold), title check (10-char prefix fallback), hint generation,
  case-insensitive matching, common-word filtering, ratio-based detection.

### `smart-suggestions.ts` (25 tests)
- `generateSuggestions`: shadows, transitions, responsive, dead buttons, aria-labels, semantic
  HTML, todo (drag/categories), game (highscore/sound), dashboard (dark mode) suggestions.
- Priority sorting (high → medium → low), top-5 cap, required-fields validation, empty inputs.

### `design-tokens.ts` (37 tests)
- `THEMES`: 10+ themes, unique names, valid hex colors, all 10 color properties per theme.
- `generateDesignTokens`: `<style>` wrapper, `:root` selector, all color/spacing/type/radius/
  shadow/transition custom properties, theme color injection, fallback to slate for unknown theme,
  base styles (body, .btn, .card, .input), box-sizing.
- `DESIGN_TOKENS_INSTRUCTION`: string content, color token listing, "use only" instruction.

### `runtime-errors.ts` (28 tests)
- `RUNTIME_ERROR_SCRIPT`: script structure, postMessage to parent, error/unhandledrejection/
  console.error capture, `__novaGetErrors`/`__novaClearErrors` exposure, MAX_ERRORS=20, message
  truncation (1000/2000 chars), IIFE wrapper.
- `injectRuntimeErrorCapture`: injection after `<head>`, after `<html>` (creates new `<head>`),
  prepend for non-HTML strings, double-injection prevention, uppercase tag handling, idempotency.

### `logger.ts` (32 tests)
- `getLevel`: env-based level switching (LOG_LEVEL=debug/warn/error), NODE_ENV=production → warn,
  invalid LOG_LEVEL fallback, LOG_LEVEL precedence over NODE_ENV.
- `logger.{debug,info,warn,error}`: function existence, no-throw on all inputs.
- Circular reference handling: object self-ref, BigInt, still logs event name on serialization failure.
- Context handling: empty object, mixed types, no-context, event name variations.

### `model-circuit-breaker.ts` (40 tests)
- `isModelAvailable`: known/unknown models, single failure (below threshold), 4 failures (below
  threshold), 5 failures (reaches threshold → false).
- `recordSuccess`: resets consecutiveFailures, increments totalRequests, unknown model no-throw.
- `recordFailure`: increments consecutiveFailures/totalFailures/totalRequests, stores lastError,
  updates lastFailureTime, threshold behavior, counter reset on success.
- `getHealthStats`: shape verification (all 7 fields per model).
- **Threshold-reaching tests placed at END** to avoid state pollution (disabledUntil persists for
  2 minutes — `recordSuccess` does NOT reset it).

## Test Strategy Notes

1. **Module-level singletons**: `build-store.ts` and `model-circuit-breaker.ts` use module-level
   state. Tests use unique IDs / careful ordering to minimize pollution. The model-circuit-breaker
   tests explicitly group threshold-reaching tests at the end of the file.

2. **Context-aware regexes**: Several modules (`math-fixer`, `form-fixer`, `css-fixer`,
   `smart-suggestions`) use regex patterns with 200-char context windows or keyword suppression.
   Tests were carefully crafted to isolate context (e.g., padding strings to >200 chars, avoiding
   trigger keywords like "label" when testing "categories" suggestion).

3. **No DOM dependency**: All tests run in pure Node/Bun — no jsdom or browser env required.

4. **Idempotency checks**: Each fixer module is verified to be safely re-runnable.

## Verification

- `bun run lint`: 0 errors (5 pre-existing warnings in unrelated files).
- `bun test tests/{MODULE}.test.ts`: all 11 files pass individually.
- `bun test` (all 11 files): 316 pass, 0 fail, 972 expect() calls, 90ms total.

## Files Created

```
tests/math-fixer.test.ts          (24 tests)
tests/form-fixer.test.ts          (17 tests)
tests/css-fixer.test.ts           (21 tests)
tests/build-store.test.ts         (16 tests)
tests/helpers.test.ts             (53 tests)
tests/plan-adherence.test.ts      (23 tests)
tests/smart-suggestions.test.ts   (25 tests)
tests/design-tokens.test.ts       (37 tests)
tests/runtime-errors.test.ts      (28 tests)
tests/logger.test.ts              (32 tests)
tests/model-circuit-breaker.test.ts (40 tests)
```
