---
Task ID: 1005
Agent: test-author (Z.ai Code)
Task: Add MORE comprehensive tests for NOVA. 8 test files targeting error-recovery, build-comparison, build-health, build-stats, prompt-templates, static-analysis, diff, and page.tsx characterization. Focus on areas not yet covered.

Work Log:
- Read worklog.md (Tasks 1–4 + 1001 + 1003 + 1004) to understand the project architecture, existing test patterns, and the convention of using `import { describe, expect, test } from 'bun:test'` with relative imports.
- Read all 8 target source modules + the existing test files to understand APIs, edge cases, and avoid duplication:
  - src/lib/error-recovery.ts — analyzeError (priority: cancelled > rate-limit > timeout > network > empty > invalid > unknown), assessMissionVagueness (<12 chars or <2 sig words or filler phrase), assessMissionComplexity (>600 chars or 4+ app types), simplifyMission (sentence + clause + 200-char truncation), suggestRelatedMissions (always returns 3 fixed ambitious missions).
  - src/lib/build-comparison.ts — compareBuilds uses set-based line diff (not LCS), defaults quality/ms to 0, division-by-zero guard on sizeChangePercent, summary uses " · " separator.
  - src/lib/build-health.ts — calculateBuildHealth has explicit if/else grade ladder (A→B→C→D), truncated=true is auto-D, buildTimeMin boundaries at 3/5/8 min, quality boundaries at 85/70/50.
  - src/lib/build-stats.ts — recordBuildInStats uses strict > for best, strict < for worst (with totalBuilds===0 OR check), avgQuality uses Math.round (rounds .5 up), formatStats omits details when 0/null.
  - src/lib/prompt-templates.ts — loadTemplates filters non-objects/wrong-types, caps at 50, addTemplate dedupes by name (case-sensitive), id format `tpl_<base36ts>_<4-char random>`.
  - src/lib/static-analysis.ts — analyzeHtml extracts IDs from HTML, extracts function declarations/expressions/object methods/class methods, checks getElementById with Levenshtein close-match (≤2), checks addEventListener, checks undefined calls (skips method calls, new, `:value()` no-space, function declarations), checks undeclared variables.
  - src/lib/diff.ts — diffStrings uses LCS with Uint32Array, MAX_LINES=1000 boundary, naive diff fallback, splitLines normalizes \r\n and \r, only strips ONE trailing empty line, diffStringsCompact caps context at 50.
  - src/app/page.tsx (4522 lines) — STARTER_CATEGORIES (4 cats × 3 prompts), SLASH_COMMANDS (5 cmds), REFINE_THINKING_STEPS (3 steps), SUGGESTION_GROUPS (7+ groups), keyboard shortcuts (Esc, M, E, I, D, F, S, T, ?, Cmd+S/N/Enter), previewWidth 4 modes (full/desktop/tablet/mobile), iframe sandbox=allow-scripts (no allow-same-origin).
- Created 8 test files using `import { describe, expect, test } from 'bun:test'` and relative imports, as specified.

KEY DESIGN DECISIONS:
1. **Documented source quirks as explicit tests with comments**:
   - error-recovery: ETIMEDOUT matches network (not timeout) because "etimedout" doesn't contain "timeout" substring. Used "fetch timed out" instead for the priority test.
   - build-comparison: Set-based diff doesn't catch reordering ('a\nb\nc' vs 'c\nb\na' looks identical).
   - build-health: The `score` variable is computed but NEVER used — the grade is determined solely by the if/else ladder.
   - build-stats: avgQuality uses Math.round which rounds .5 UP (80.5 → 81). best uses strict >, worst uses strict <.
   - diff: splitLines only strips ONE trailing empty string. 'a\n\n' → ['a', ''] (NOT identical to 'a'). 'a\n' → ['a'] (identical to 'a').
   - static-analysis: The `:` check for skipping object property values is `js[callPos - 1] === ':'` — only matches when there's NO space between `:` and the function name. `key:getValue()` is skipped but `key: getValue()` is flagged (known limitation).
2. **Boundary tests for every module**:
   - error-recovery: 11 vs 12 chars (vagueness), 500 vs 501 chars (timeout severity), 600 vs 601 chars (complexity).
   - build-health: 85/70/50 quality boundaries, 180000/180001ms (3min), 300000/300001ms (5min), 480000/480001ms (8min).
   - build-stats: 999 vs 1000 vs 999999 vs 1000000 token formatting boundaries.
   - prompt-templates: 50-cap (saves 60, loads 50), 60-char name cap.
   - diff: MAX_LINES exactly (1000) vs MAX_LINES+1 (1001) for naive fallback.
3. **Mocked localStorage** for build-stats and prompt-templates tests (same pattern as existing tests).
4. **Page characterization tests** read src/app/page.tsx as text and verify structure invariants: useState declarations, useRef mirrors, useEffect dependencies, keyboard shortcut handlers, STARTER_CATEGORIES/SLASH_COMMANDS/REFINE_THINKING_STEPS/SUGGESTION_GROUPS counts, iframe sandbox security, etc. Used line-by-line block extraction (find first line starting with `]` at column 0) instead of greedy regex `[\s\S]*?\]` which stops at the first nested `]`.

CHALLENGES & FIXES:
- **STARTER_CATEGORIES block extraction**: Initial regex `STARTER_CATEGORIES[\s\S]*?\]` stopped at the first `]` (closing the inner `prompts: []` array). Fixed by splitting on newlines and finding the first line starting with `]` at column 0.
- **textarea aria-label**: The mission input uses shadcn `<Textarea` component (capital T), not native `<textarea>`. Changed test to check `id="mission-input"` instead.
- **createObjectURL false positive**: Source uses `URL.createObjectURL(blob)` for ZIP/file downloads (not for iframe src). Changed `not.toContain('createObjectURL')` to `not.toMatch(/createObjectURL[^;]*iframe/)` — same approach as the existing page-config.test.ts.
- **Async test race condition**: Initial markTemplateUsed test used `void wait.then(...)` which scheduled an async callback that ran AFTER beforeEach cleared localStorage (causing `getTemplateById` to return null). Fixed by making the test fully synchronous — call markTemplateUsed twice in a row, verify both updates succeed.
- **Priority ordering test**: Initial "timeout beats network" test used "ETIMEDOUT" which only matches network (etimedout doesn't contain "timeout"). Changed to "fetch timed out" which matches BOTH timeout (via "timed out") and network (via "fetch") — timeout wins because it's checked first.
- **Mission state regex**: Initial `useState\(''\)[\s\S]{0,50}mission` was wrong because the destructuring `const [mission, setMission] = useState('')` has the variable name BEFORE useState. Fixed to `const \[mission, setMission\] = useState\(''\)`.

TEST COUNTS (all pass):
- tests/error-recovery-comprehensive.test.ts — 124 tests, 230 expect() calls
- tests/build-comparison-comprehensive.test.ts — 54 tests, 90 expect() calls
- tests/build-health-comprehensive.test.ts — 74 tests, 106 expect() calls
- tests/build-stats-comprehensive.test.ts — 71 tests, 104 expect() calls
- tests/prompt-templates-comprehensive.test.ts — 53 tests, 85 expect() calls
- tests/static-analysis-comprehensive.test.ts — 86 tests, 137 expect() calls
- tests/diff-comprehensive.test.ts — 50 tests, 80 expect() calls
- tests/page-characterization-comprehensive.test.ts — 138 tests, 188 expect() calls

TOTAL: 650 tests, 1020 expect() calls, 0 failures.

VERIFICATION:
- bun run lint: 0 errors, 5 warnings (all pre-existing — none from my new files).
- bun test (8 new files together): 650 pass, 0 fail, 1020 expect() calls, 125ms.
- Each file passes individually (verified via for-loop running each file).
- bun test (full suite): 2838 pass, 257 skip, 3 fail (all 3 pre-existing — in api-refine.test.ts, refine-route-sse.test.ts, code-route-sse.test.ts — they depend on `llmChatStream` and `dashscopeStream` exports that no longer exist in src/lib/llm.ts and src/lib/dashscope.ts). Verified by running those 3 files + my 8 files together: only 2 pre-existing fails, 0 new fails from my tests.
- Dev server log: clean, no errors from test runs (tests run via `bun test`, not through the dev server).

Files Created:
- tests/error-recovery-comprehensive.test.ts            (124 tests, 519 lines)
- tests/build-comparison-comprehensive.test.ts          (54 tests, 270 lines)
- tests/build-health-comprehensive.test.ts              (74 tests, 339 lines)
- tests/build-stats-comprehensive.test.ts               (71 tests, 432 lines)
- tests/prompt-templates-comprehensive.test.ts          (53 tests, 358 lines)
- tests/static-analysis-comprehensive.test.ts           (86 tests, 446 lines)
- tests/diff-comprehensive.test.ts                      (50 tests, 265 lines)
- tests/page-characterization-comprehensive.test.ts     (138 tests, 580 lines)
- /agent-ctx/1005-test-author.md                        (this work record)

Total: 650 tests, 1020 expect() calls, 0 failures, 0 lint errors, 3209 lines of test code.
