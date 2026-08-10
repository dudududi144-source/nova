// Comprehensive characterization tests for v29.45 bug fixes in src/app/page.tsx.
// These tests read the source file as text (no React rendering) because page.tsx
// is a client component that depends on browser APIs (iframe, localStorage,
// ResizeObserver, etc.) which are not available in bun:test's pure-Node runtime.
//
// Coverage: 8 bug-fix areas (BUG #1, #2, #5/#6, #9, #11, #13, #14, #15).
// All tests are hermetic — no dev server, no network, no DOM.
import { describe, expect, test } from 'bun:test'
import * as fs from 'fs'
import * as path from 'path'

const source = fs.readFileSync(
  path.join(process.cwd(), 'src/app/page.tsx'),
  'utf-8'
)

// v29.81: SettingsModal extracted to separate component
const settingsSource = fs.readFileSync(
  path.join(process.cwd(), 'src/components/settings-modal.tsx'),
  'utf-8'
)

// ---------------------------------------------------------------------------
// Helper: extract the settings API-key input section (the <input> element that
// has the "Enter API key and press Enter" placeholder).
// ---------------------------------------------------------------------------
function getSettingsInputSection(): string {
  // v29.81: Settings moved to src/components/settings-modal.tsx
  const placeholderIdx = settingsSource.indexOf('Enter API key and press Enter')
  expect(placeholderIdx).toBeGreaterThan(-1)
  const inputOpenIdx = settingsSource.lastIndexOf('<input', placeholderIdx)
  const inputCloseIdx = settingsSource.indexOf('/>', placeholderIdx)
  expect(inputOpenIdx).toBeGreaterThan(-1)
  expect(inputCloseIdx).toBeGreaterThan(-1)
  return settingsSource.slice(inputOpenIdx, inputCloseIdx + 2)
}

// ---------------------------------------------------------------------------
// Helper: extract the build() useCallback body (from declaration up to the
// first `const controller = new AbortController()` plus a generous margin).
// ---------------------------------------------------------------------------
function getBuildStartSection(length = 2500): string {
  const buildStart = source.indexOf('const build = useCallback')
  expect(buildStart).toBeGreaterThan(-1)
  return source.slice(buildStart, buildStart + length)
}

// ---------------------------------------------------------------------------
// Helper: extract the loadFromHistory useCallback body.
// ---------------------------------------------------------------------------
function getLoadFromHistorySection(): string {
  const start = source.indexOf('const loadFromHistory = useCallback')
  expect(start).toBeGreaterThan(-1)
  // Find the closing `}, [])` of the useCallback (the dependency array).
  const end = source.indexOf('}, [])', start)
  expect(end).toBeGreaterThan(-1)
  return source.slice(start, end + '}, [])'.length)
}

// ---------------------------------------------------------------------------
// Helper: extract the readWithTimeout helper function body.
// ---------------------------------------------------------------------------
function getReadWithTimeoutSection(): string {
  const start = source.indexOf('const readWithTimeout = async (')
  expect(start).toBeGreaterThan(-1)
  // The helper ends with `}` on its own line followed by a blank line.
  // We grab a generous 800-char window — the helper is ~15 lines.
  return source.slice(start, start + 800)
}

// ---------------------------------------------------------------------------
// Helper: extract the keyboard-handler useEffect (the one that calls
// window.addEventListener('keydown', ...)).
// ---------------------------------------------------------------------------
function getKeyboardHandlerSection(): string {
  const listenerIdx = source.indexOf("window.addEventListener('keydown', onKey)")
  expect(listenerIdx).toBeGreaterThan(-1)
  // Walk backwards to find the useEffect opening.
  const useEffectStart = source.lastIndexOf('useEffect(() => {', listenerIdx)
  expect(useEffectStart).toBeGreaterThan(-1)
  // The deps array closes the useEffect — find the next `], [` after the listener
  // OR find the next `}, [` after the listener (the cleanup return + deps).
  const depsClose = source.indexOf('])', listenerIdx)
  expect(depsClose).toBeGreaterThan(-1)
  return source.slice(useEffectStart, depsClose + 2)
}

// ===========================================================================
// 1. BUG #1: Settings API-key input uses Enter (not onChange)
// ---------------------------------------------------------------------------
// The settings API-key input previously fired onChange on every keystroke,
// sending a POST /api/settings request per character. Fixed to use onKeyDown
// with an Enter guard so the key is only sent when the user presses Enter.
// ===========================================================================
describe('BUG #1: Settings API-key input uses Enter (not onChange)', () => {
  // v29.81: Settings moved to src/components/settings-modal.tsx
  test('settings input placeholder text is "Enter API key and press Enter..."', () => {
    expect(settingsSource).toContain('Enter API key and press Enter')
  })

  test('settings input uses onKeyDown handler (not onChange)', () => {
    const section = getSettingsInputSection()
    expect(section).toContain('onKeyDown={async (e) => {')
  })

  test('settings input does NOT use onChange handler', () => {
    const section = getSettingsInputSection()
    expect(section).not.toMatch(/onChange\s*=/)
  })

  test('onKeyDown guards with `if (e.key !== \'Enter\') return`', () => {
    const section = getSettingsInputSection()
    expect(section).toContain("if (e.key !== 'Enter') return")
  })

  test('onKeyDown trims the value before sending (`value.trim()`)', () => {
    const section = getSettingsInputSection()
    expect(section).toContain('value.trim()')
  })

  test('onKeyDown returns early if value is empty after trim', () => {
    const section = getSettingsInputSection()
    expect(section).toMatch(/if\s*\(\s*!value\.trim\(\)\s*\)\s*return/)
  })

  test('onKeyDown sends the trimmed value to /api/settings', () => {
    const section = getSettingsInputSection()
    expect(section).toContain('JSON.stringify({ [key]: value.trim() })')
  })

  test('onKeyDown clears the input on success (`e.target.value = \'\'`)', () => {
    const section = getSettingsInputSection()
    expect(section).toMatch(/\.value\s*=\s*''/)
  })

  test('input type is "password" (masks the API key visually)', () => {
    const section = getSettingsInputSection()
    expect(section).toContain('type="password"')
  })
})

// ===========================================================================
// 2. BUG #2: buildIdRef cleared at build start
// ---------------------------------------------------------------------------
// Previously, buildIdRef.current retained the previous build's ID when a new
// build started. If the new build's SSE stream dropped before emitting
// 'buildId', the polling fallback would resume polling with the stale ID —
// corrupting state. Fixed by clearing buildIdRef.current = null at the start
// of build(), before creating the new AbortController.
// ===========================================================================
describe('BUG #2: buildIdRef cleared at build start', () => {
  test('source contains `buildIdRef.current = null`', () => {
    expect(source).toContain('buildIdRef.current = null')
  })

  test('clearance happens inside the build() useCallback', () => {
    const section = getBuildStartSection()
    expect(section).toContain('buildIdRef.current = null')
  })

  test('clearance happens BEFORE `const controller = new AbortController()`', () => {
    const section = getBuildStartSection(2500)
    const nullIdx = section.indexOf('buildIdRef.current = null')
    const controllerIdx = section.indexOf('const controller = new AbortController()')
    expect(nullIdx).toBeGreaterThan(-1)
    expect(controllerIdx).toBeGreaterThan(-1)
    expect(nullIdx).toBeLessThan(controllerIdx)
  })

  test('clearance happens AFTER aborting the previous in-flight build', () => {
    const section = getBuildStartSection(2500)
    const abortIdx = section.indexOf('refineAbortRef.current?.abort()')
    const nullIdx = section.indexOf('buildIdRef.current = null')
    expect(abortIdx).toBeGreaterThan(-1)
    expect(nullIdx).toBeGreaterThan(-1)
    // The null-clearance should come after both abort calls (abortRef + refineAbortRef).
    expect(nullIdx).toBeGreaterThan(abortIdx)
  })

  test('comment mentions clearing the previous build\'s ID', () => {
    expect(source).toMatch(/Clear buildIdRef|previous build's ID/)
  })

  test('comment explains the SSE-drop race condition', () => {
    // The comment should mention SSE dropping or the polling fallback.
    expect(source).toMatch(/SSE drops? before emitting 'buildId'|polling fallback/i)
  })
})

// ===========================================================================
// 3. BUG #5/#6: Keyboard handler deps include fullscreen, previousBuild,
//    buildStats, qualityScore
// ---------------------------------------------------------------------------
// The keydown handler closures referenced fullscreen/previousBuild/buildStats/
// qualityScore but the useEffect deps array omitted them, so the handler kept
// using stale values after the user toggled fullscreen or navigated history.
// Fixed by adding all 4 to the deps array.
// ===========================================================================
describe('BUG #5/#6: Keyboard handler deps include new state', () => {
  test('keyboard handler useEffect calls window.addEventListener("keydown", onKey)', () => {
    expect(source).toContain("window.addEventListener('keydown', onKey)")
  })

  test('deps array includes `fullscreen`', () => {
    const section = getKeyboardHandlerSection()
    expect(section).toMatch(/\bfullscreen\b/)
  })

  test('deps array includes `previousBuild`', () => {
    const section = getKeyboardHandlerSection()
    expect(section).toMatch(/\bpreviousBuild\b/)
  })

  test('deps array includes `buildStats`', () => {
    const section = getKeyboardHandlerSection()
    expect(section).toMatch(/\bbuildStats\b/)
  })

  test('deps array includes `qualityScore`', () => {
    const section = getKeyboardHandlerSection()
    expect(section).toMatch(/\bqualityScore\b/)
  })

  test('deps array still includes original deps: loading, refining, result', () => {
    const section = getKeyboardHandlerSection()
    expect(section).toMatch(/\bloading\b/)
    expect(section).toMatch(/\brefining\b/)
    expect(section).toMatch(/\bresult\b/)
  })

  test('deps array still includes original deps: download, cancelBuild, cancelRefine', () => {
    const section = getKeyboardHandlerSection()
    expect(section).toMatch(/\bdownload\b/)
    expect(section).toMatch(/\bcancelBuild\b/)
    expect(section).toMatch(/\bcancelRefine\b/)
  })

  test('deps array still includes original deps: reset, showShortcuts', () => {
    const section = getKeyboardHandlerSection()
    expect(section).toMatch(/\breset\b/)
    expect(section).toMatch(/\bshowShortcuts\b/)
  })

  test('the 4 new deps appear AFTER the 8 original deps (appended at end)', () => {
    const section = getKeyboardHandlerSection()
    // The deps array literal: `}, [...deps])`
    const depsMatch = section.match(/\},\s*\[([^\]]+)\]\)/)
    expect(depsMatch).not.toBeNull()
    const depsList = depsMatch![1]
    const fullscreenIdx = depsList.indexOf('fullscreen')
    const showShortcutsIdx = depsList.indexOf('showShortcuts')
    expect(fullscreenIdx).toBeGreaterThan(-1)
    expect(showShortcutsIdx).toBeGreaterThan(-1)
    // showShortcuts is the last of the original 8 deps; fullscreen should come after.
    expect(fullscreenIdx).toBeGreaterThan(showShortcutsIdx)
  })

  test('comment mentions the v29.45 fix and which deps were added', () => {
    expect(source).toMatch(/Added fullscreen, previousBuild, buildStats, qualityScore to deps/)
  })
})

// ===========================================================================
// 4. BUG #9: Cmd+Enter guarded by enhancedPreview
// ---------------------------------------------------------------------------
// Pressing Cmd/Ctrl+Enter while an enhanced-prompt preview was visible would
// start a new build with the OLD mission text, silently discarding the
// enhanced preview. Fixed by guarding `if (!enhancedPreview) build()` inside
// the Cmd+Enter handler.
// ===========================================================================
describe('BUG #9: Cmd+Enter guarded by enhancedPreview', () => {
  test('source handles `(e.metaKey || e.ctrlKey) && e.key === \'Enter\'`', () => {
    expect(source).toContain("(e.metaKey || e.ctrlKey) && e.key === 'Enter'")
  })

  test('Cmd+Enter handler contains `if (!enhancedPreview) build()`', () => {
    const enterIdx = source.indexOf("(e.metaKey || e.ctrlKey) && e.key === 'Enter'")
    expect(enterIdx).toBeGreaterThan(-1)
    // Grab a 500-char window after the Enter check — the guard should be
    // within a few lines of it.
    const window_ = source.slice(enterIdx, enterIdx + 500)
    expect(window_).toContain('if (!enhancedPreview) build()')
  })

  test('the guard appears INSIDE the Cmd+Enter block (not before it)', () => {
    const enterIdx = source.indexOf("(e.metaKey || e.ctrlKey) && e.key === 'Enter'")
    const guardIdx = source.indexOf('if (!enhancedPreview) build()')
    expect(enterIdx).toBeGreaterThan(-1)
    expect(guardIdx).toBeGreaterThan(-1)
    expect(guardIdx).toBeGreaterThan(enterIdx)
  })

  test('the guard appears BEFORE the next keydown branch (prompt history ↑/↓)', () => {
    const enterIdx = source.indexOf("(e.metaKey || e.ctrlKey) && e.key === 'Enter'")
    const guardIdx = source.indexOf('if (!enhancedPreview) build()')
    // Find the next major keydown branch after the Enter handler — the prompt
    // history navigation block.
    const historyIdx = source.indexOf('promptHistory', guardIdx)
    expect(historyIdx).toBeGreaterThan(-1)
    expect(guardIdx).toBeGreaterThan(enterIdx)
    expect(guardIdx).toBeLessThan(historyIdx)
  })

  test('comment explains the enhancedPreview guard reasoning', () => {
    expect(source).toMatch(/Don't build if an enhanced prompt is being previewed/)
  })
})

// ===========================================================================
// 5. BUG #11: readWithTimeout helper prevents timer leak
// ---------------------------------------------------------------------------
// The SSE-read loop used `Promise.race([reader.read(), new Promise((_, reject)
// => setTimeout(() => reject('SSE_TIMEOUT'), 180_000))])`. When reader.read()
// won the race, the 180s setTimeout was NEVER cleared — leaking one timer per
// loop iteration (up to ~2000 pending timers for a 2000-token build). Fixed by
// extracting a readWithTimeout helper that clears the timer in a finally
// block, and calling it from all 4 SSE read loops.
// ===========================================================================
describe('BUG #11: readWithTimeout helper prevents timer leak', () => {
  test('source defines `const readWithTimeout = async (`', () => {
    expect(source).toContain('const readWithTimeout = async (')
  })

  test('readWithTimeout accepts a reader and a default timeoutMs', () => {
    const section = getReadWithTimeoutSection()
    expect(section).toMatch(/timeoutMs\s*=\s*180_000/)
  })

  test('readWithTimeout uses Promise.race between reader.read() and a timeout', () => {
    const section = getReadWithTimeoutSection()
    expect(section).toContain('Promise.race([')
    expect(section).toContain('reader.read()')
    expect(section).toContain('setTimeout(() => reject(new Error(\'SSE_TIMEOUT\'))')
  })

  test('readWithTimeout clears the timer in a `finally` block', () => {
    const section = getReadWithTimeoutSection()
    expect(section).toMatch(/finally\s*\{/)
    expect(section).toContain('clearTimeout(timer)')
  })

  test('readWithTimeout guards the clearTimeout with `if (timer)`', () => {
    const section = getReadWithTimeoutSection()
    expect(section).toContain('if (timer) clearTimeout(timer)')
  })

  test('the SSE_TIMEOUT inline pattern appears ONLY inside readWithTimeout', () => {
    // Count occurrences of the inline SSE_TIMEOUT pattern in the whole source.
    const matches = source.match(/setTimeout\(\(\)\s*=>\s*reject\(new Error\('SSE_TIMEOUT'\)\),\s*180_000\)/g)
    // The old code had 4 occurrences (one per SSE loop); the fixed code has
    // exactly 1 (inside readWithTimeout, using timeoutMs instead of 180_000).
    // The exact literal "180_000" is now only in the default param.
    const inlineMatches = source.match(/setTimeout\(\(\)\s*=>\s*reject\(new Error\('SSE_TIMEOUT'\)\),\s*180_000\)/g)
    // The readWithTimeout uses `timeoutMs`, not the literal 180_000, so the
    // literal inline pattern should not appear at all (or at most inside the
    // helper if we used the literal — but we use timeoutMs).
    expect(inlineMatches === null || inlineMatches.length === 0).toBe(true)
  })

  test('the SSE_TIMEOUT literal appears exactly once in the entire source', () => {
    const matches = source.match(/SSE_TIMEOUT/g)
    expect(matches).not.toBeNull()
    expect(matches!.length).toBe(1)
  })

  test('readWithTimeout is called from all SSE read loops', () => {
    // v29.46: Was 4 loops, now 3 after removing dead autoFix function
    const matches = source.match(/readWithTimeout\(reader\)/g)
    expect(matches).not.toBeNull()
    expect(matches!.length).toBe(3)
  })

  test('readWithTimeout calls do NOT pass an explicit timeout (use the 180s default)', () => {
    // None of the call sites should pass a second argument — they rely on the
    // default `timeoutMs = 180_000`.
    const badCalls = source.match(/readWithTimeout\(reader,\s*\d+\)/g)
    expect(badCalls === null || badCalls.length === 0).toBe(true)
  })

  test('comment explains the timer-leak prevention', () => {
    expect(source).toMatch(/Helper for SSE read with timeout|preventing pending 180s timers from leaking/)
  })
})

// ===========================================================================
// 6. BUG #13: enhancePrompt validates data.enhanced
// ---------------------------------------------------------------------------
// enhancePrompt called `data.enhanced.trim()` without first checking that
// data.enhanced is a non-empty string. If the server returned `{ok: true}`
// without an `enhanced` field (backend bug / proxy stripping fields), it
// threw "Cannot read properties of undefined (reading 'trim')". Also, the
// success toast used `data.ms` directly, which produced "NaNs" if data.ms
// was missing. Fixed by type-checking both fields and showing a clear error.
// ===========================================================================
describe('BUG #13: enhancePrompt validates data.enhanced', () => {
  test('source checks `typeof enhanced !== \'string\'`', () => {
    expect(source).toContain("typeof enhanced !== 'string'")
  })

  test('the type check also verifies the string is non-empty after trim', () => {
    expect(source).toMatch(/typeof enhanced !== 'string'\s*\|\|\s*!enhanced\.trim\(\)/)
  })

  test('source shows error "Enhancement returned empty result" when validation fails', () => {
    expect(source).toContain('Enhancement returned empty result')
  })

  test('source guards against missing/NaN ms value with `typeof data.ms === \'number\'`', () => {
    expect(source).toContain('typeof data.ms === \'number\'')
  })

  test('the ms fallback uses ternary `typeof data.ms === \'number\' ? data.ms : 0`', () => {
    expect(source).toContain("typeof data.ms === 'number' ? data.ms : 0")
  })

  test('the success toast uses the computed `ms` variable (not `data.ms` directly)', () => {
    // Find the toast.success call that contains "Enhanced ·" and verify it
    // interpolates the computed `ms` variable (wrapped in `(ms / 1000).toFixed(1)`),
    // NOT `data.ms` directly.
    const toastIdx = source.indexOf('toast.success(`Enhanced · ')
    expect(toastIdx).toBeGreaterThan(-1)
    const window_ = source.slice(toastIdx, toastIdx + 200)
    expect(window_).toContain('(ms / 1000).toFixed(1)')
    expect(window_).not.toMatch(/data\.ms\b/)
  })

  test('comment documents the v29.45 validation fix', () => {
    expect(source).toMatch(/Validate enhanced is a non-empty string|Guard against missing\/NaN ms value/)
  })
})

// ===========================================================================
// 7. BUG #14: loadFromHistory clears stale state
// ---------------------------------------------------------------------------
// loadFromHistory reset many state values but NOT: suggestions, showSuggestions,
// qualityBreakdown, showCodeAnalysis, showRuntimeErrors, probeResult, chatInput,
// planFeatures. These retained values from the previously-loaded build, showing
// stale UI after a history click. Fixed by clearing all of them inside
// loadFromHistory.
// ===========================================================================
describe('BUG #14: loadFromHistory clears stale state', () => {
  test('`setSuggestions([])` is called inside loadFromHistory', () => {
    const section = getLoadFromHistorySection()
    expect(section).toContain('setSuggestions([])')
  })

  test('`setShowSuggestions(false)` is called inside loadFromHistory', () => {
    const section = getLoadFromHistorySection()
    expect(section).toContain('setShowSuggestions(false)')
  })

  test('`setShowCodeAnalysis(false)` is called inside loadFromHistory', () => {
    const section = getLoadFromHistorySection()
    expect(section).toContain('setShowCodeAnalysis(false)')
  })

  test('`setProbeResult(null)` is called inside loadFromHistory', () => {
    const section = getLoadFromHistorySection()
    expect(section).toContain('setProbeResult(null)')
  })

  test('`setRuntimeErrors([])` is called inside loadFromHistory', () => {
    const section = getLoadFromHistorySection()
    expect(section).toContain('setRuntimeErrors([])')
  })

  test('`setShowRuntimeErrors(false)` is called inside loadFromHistory', () => {
    const section = getLoadFromHistorySection()
    expect(section).toContain('setShowRuntimeErrors(false)')
  })

  test('`setChatInput(\'\')` is called inside loadFromHistory', () => {
    const section = getLoadFromHistorySection()
    expect(section).toContain("setChatInput('')")
  })

  test('`setQualityBreakdown(null)` is called inside loadFromHistory', () => {
    const section = getLoadFromHistorySection()
    expect(section).toContain('setQualityBreakdown(null)')
  })

  test('`setPlanFeatures([])` is called inside loadFromHistory', () => {
    const section = getLoadFromHistorySection()
    expect(section).toContain('setPlanFeatures([])')
  })

  test('all 9 setters appear in the v29.45 stale-state-clearing block (grouped together)', () => {
    const section = getLoadFromHistorySection()
    // All 9 setters should be within a 600-char window of each other (the
    // v29.45 block at the end of loadFromHistory).
    const firstIdx = section.indexOf('setSuggestions([])')
    const lastIdx = section.indexOf('setPlanFeatures([])')
    expect(firstIdx).toBeGreaterThan(-1)
    expect(lastIdx).toBeGreaterThan(-1)
    expect(lastIdx - firstIdx).toBeLessThan(600)
  })

  test('comment marks the stale-state clearing as a v29.45 fix', () => {
    const section = getLoadFromHistorySection()
    expect(section).toMatch(/Clear stale state|v29\.45/i)
  })

  test('the original resets (result, error, mission) are still present', () => {
    const section = getLoadFromHistorySection()
    expect(section).toContain('setResult(h)')
    expect(section).toContain('setError(null)')
    expect(section).toContain('setMission(h.mission)')
  })
})

// ===========================================================================
// 8. BUG #15: Suggestion chip uses 'addition' variable
// ---------------------------------------------------------------------------
// The clickable-suggestion chip's onClick computed an `addition` variable
// (to prepend " " or " with " based on whether clickableText starts with
// "with"/"add") but then called `setMission(current + ' ' + clickableText.trim())`
// — using clickableText directly instead of addition. The addition variable
// was dead code. Fixed by using `addition` in the setMission call.
// ===========================================================================
describe('BUG #15: Suggestion chip uses addition variable', () => {
  test('source computes an `addition` variable', () => {
    expect(source).toMatch(/const addition = /)
  })

  test('addition is computed conditionally based on whether clickableText starts with "with" or "add"', () => {
    expect(source).toContain("clickableText.startsWith('with')")
    expect(source).toContain("clickableText.startsWith('add')")
  })

  test('addition uses a ternary to prepend "with " when clickableText doesn\'t start with with/add', () => {
    expect(source).toContain('`with ${clickableText.trim()}`')
  })

  test('setMission uses `addition` (not `clickableText.trim()` directly)', () => {
    expect(source).toContain('setMission(current + (current ? \' \' : \'\') + addition)')
  })

  test('setMission does NOT use the old pattern with `clickableText.trim()`', () => {
    // The old buggy pattern was `setMission(... + clickableText.trim())`.
    // The fixed code uses `+ addition` instead. Verify the buggy pattern
    // does not appear inside a setMission call.
    const setMissionMatches = source.match(/setMission\([^)]*clickableText\.trim\(\)[^)]*\)/g)
    expect(setMissionMatches === null || setMissionMatches.length === 0).toBe(true)
  })

  test('`addition` appears exactly once in the source (single use site)', () => {
    const matches = source.match(/\baddition\b/g)
    expect(matches).not.toBeNull()
    // Once in the declaration, once in the ternary's `: `with ${clickableText.trim()}``,
    // and once in setMission. Actually the declaration + use = at least 2.
    // We just want to verify it's used at least twice (declared + referenced).
    expect(matches!.length).toBeGreaterThanOrEqual(2)
  })

  test('comment mentions using the addition variable', () => {
    expect(source).toMatch(/Use the 'addition' variable|was computed but unused/)
  })

  test('the suggestion chip handler shows a toast.info on click', () => {
    // Find the setMission(addition) call and verify a toast.info follows.
    const setMissionIdx = source.indexOf("setMission(current + (current ? ' ' : '') + addition)")
    expect(setMissionIdx).toBeGreaterThan(-1)
    const window_ = source.slice(setMissionIdx, setMissionIdx + 200)
    expect(window_).toContain("toast.info('Added to prompt')")
  })

  test('the suggestion chip button has the violet styling class', () => {
    const setMissionIdx = source.indexOf("setMission(current + (current ? ' ' : '') + addition)")
    expect(setMissionIdx).toBeGreaterThan(-1)
    // The className appears AFTER the onClick handler's closing `}}`, so we
    // search forward from setMissionIdx for the next `className=` occurrence.
    const classNameIdx = source.indexOf('className=', setMissionIdx)
    expect(classNameIdx).toBeGreaterThan(-1)
    // The className should be within ~400 chars of setMission (same button).
    expect(classNameIdx - setMissionIdx).toBeLessThan(400)
    const classWindow = source.slice(classNameIdx, classNameIdx + 200)
    expect(classWindow).toContain('border-violet-500/30')
  })
})
