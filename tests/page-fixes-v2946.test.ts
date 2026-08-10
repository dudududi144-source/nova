// Characterization tests for v29.46 bug fixes in src/app/page.tsx.
// These tests read the source file as text (no React rendering) because page.tsx
// is a 4235-line 'use client' component with browser-only dependencies (iframe,
// localStorage, ResizeObserver, IntersectionObserver, matchMedia). It cannot be
// imported in bun:test without a jsdom shim, and even with jsdom the React 19
// use() hooks + dynamic imports would still fail. Reading the source as text is
// the convention used by the existing page-fixes-comprehensive.test.ts and
// page-characterization-comprehensive.test.ts.
//
// Coverage: 7 bug-fix areas (BUG #3, #4, #7, #8, #10, #12, #16).
// All tests are hermetic — no dev server, no network, no DOM.
import { describe, expect, test } from 'bun:test'
import * as fs from 'fs'
import * as path from 'path'

const source = fs.readFileSync(
  path.join(process.cwd(), 'src/app/page.tsx'),
  'utf-8'
)

// ---------------------------------------------------------------------------
// Helper: extract the body of a useCallback by name. Walks from the declaration
// to the closing `}, [...])` of its dependency array. Returns the slice.
// ---------------------------------------------------------------------------
function getUseCallbackBody(name: string): string {
  const start = source.indexOf(`const ${name} = useCallback`)
  expect(start).toBeGreaterThan(-1)
  // The dependency array closes the useCallback. Find the next `}, [` after the
  // start — this is the canonical pattern for useCallback endings in page.tsx.
  const end = source.indexOf('}, [', start)
  expect(end).toBeGreaterThan(-1)
  // Include the closing `)` so callers can also inspect the deps array.
  const closeParen = source.indexOf(')', end)
  return source.slice(start, closeParen + 1)
}

// ---------------------------------------------------------------------------
// Helper: extract the delete-history onClick handler (the trash button that
// removes a single build from history). Located via the confirm() prompt.
// ---------------------------------------------------------------------------
function getDeleteHistoryOnClickSection(): string {
  const confirmIdx = source.indexOf('Delete this build from history')
  expect(confirmIdx).toBeGreaterThan(-1)
  // Walk backwards to find the opening `onClick={(e) => {` or `onClick={() => {`.
  const onClickOpenIdx = source.lastIndexOf('onClick={', confirmIdx)
  // Walk forwards to find the closing `}}` of the onClick handler.
  // The handler ends with `toast.success('Build deleted from history')` followed
  // by `}}`. We find the toast line, then the next `}}` after it.
  const toastIdx = source.indexOf('toast.success', confirmIdx)
  expect(toastIdx).toBeGreaterThan(-1)
  const closeIdx = source.indexOf('}}', toastIdx)
  expect(closeIdx).toBeGreaterThan(-1)
  return source.slice(onClickOpenIdx, closeIdx + 2)
}

// ---------------------------------------------------------------------------
// Helper: extract the model-selector button group (the 3 buttons: Z.AI, Qwen,
// Kimi K3). Located via the `flex items-center gap-0.5` container className.
// ---------------------------------------------------------------------------
function getModelSelectorButtonsSection(): string {
  // The model-selector button group is the only place with three <button>
  // children labeled Z.AI / Qwen / Kimi (the Kimi button text is just "Kimi",
  // not "Kimi K3" — that string only appears in the title attribute).
  const zaiBtnIdx = source.indexOf(">Z.AI<")
  expect(zaiBtnIdx).toBeGreaterThan(-1)
  // Find the Kimi button text that comes AFTER the Z.AI button.
  const kimiBtnIdx = source.indexOf(">Kimi<", zaiBtnIdx)
  expect(kimiBtnIdx).toBeGreaterThan(-1)
  // Walk backwards from the Z.AI button to find the opening <button tag.
  const start = source.lastIndexOf('<button', zaiBtnIdx)
  // Walk forwards from the Kimi button to find the closing </button>.
  const end = source.indexOf('</button>', kimiBtnIdx)
  expect(start).toBeGreaterThan(-1)
  expect(end).toBeGreaterThan(-1)
  return source.slice(start, end + '</button>'.length)
}

// ===========================================================================
// 1. build() uses functional state update for buildStats — BUG #3 fix
//    The build() function was reading `buildStats` from the closure, which
//    could be stale if multiple builds fired in quick succession. The fix
//    uses the functional update form `setBuildStats(prevStats => ...)`.
// ===========================================================================
describe('BUG #3 — build() uses functional state update for buildStats', () => {
  test('source contains the functional update pattern setBuildStats(prevStats =>', () => {
    expect(source).toContain('setBuildStats(prevStats =>')
  })

  test('build() passes prevStats (not buildStats) to recordBuildInStats', () => {
    const buildSection = getUseCallbackBody('build')
    expect(buildSection).toContain('recordBuildInStats(prevStats,')
  })

  test('build() does NOT use the stale recordBuildInStats(buildStats, pattern', () => {
    const buildSection = getUseCallbackBody('build')
    expect(buildSection).not.toContain('recordBuildInStats(buildStats,')
  })

  test('the functional update is inside the build function (after const build = useCallback)', () => {
    const buildStart = source.indexOf('const build = useCallback')
    expect(buildStart).toBeGreaterThan(-1)
    const functionalUpdateIdx = source.indexOf('setBuildStats(prevStats =>', buildStart)
    expect(functionalUpdateIdx).toBeGreaterThan(buildStart)
    // Ensure it's within the build function (before the deps array close).
    const depsClose = source.indexOf('}, [', buildStart)
    expect(functionalUpdateIdx).toBeLessThan(depsClose)
  })

  test('build() contains the v29.46 comment documenting the fix', () => {
    const buildSection = getUseCallbackBody('build')
    expect(buildSection).toContain('v29.46')
    expect(buildSection).toContain('functional update')
  })
})

// ===========================================================================
// 2. sendChat() uses functional state update for buildStats — BUG #4 fix
//    Same stale-closure class as BUG #3, but in the refine path. The fix
//    uses `recordRefineInStats(prevStats)` instead of `recordRefineInStats(buildStats)`.
// ===========================================================================
describe('BUG #4 — sendChat() uses functional state update for buildStats', () => {
  test('source contains recordRefineInStats(prevStats)', () => {
    expect(source).toContain('recordRefineInStats(prevStats)')
  })

  test('source does NOT contain the stale recordRefineInStats(buildStats) pattern', () => {
    expect(source).not.toContain('recordRefineInStats(buildStats)')
  })

  test('the functional update appears inside the sendChat function', () => {
    const sendChatSection = getUseCallbackBody('sendChat')
    expect(sendChatSection).toContain('setBuildStats(prevStats =>')
    expect(sendChatSection).toContain('recordRefineInStats(prevStats)')
  })

  test('sendChat contains the v29.46 comment documenting the fix', () => {
    const sendChatSection = getUseCallbackBody('sendChat')
    expect(sendChatSection).toContain('v29.46')
    expect(sendChatSection).toContain('functional update')
  })
})

// ===========================================================================
// 3. autoFixLoop uses runtimeErrorsRef — BUG #7 fix
//    autoFixLoop is a useCallback with `[runtimeErrors, autoFixLoopRunning]`
//    deps, but `runtimeErrors` could be stale inside the loop body because
//    `setRuntimeErrors([])` at line 1378 updates state asynchronously. The
//    fix mirrors runtimeErrors into a ref and reads `runtimeErrorsRef.current`
//    with a `?? runtimeErrors` fallback.
// ===========================================================================
describe('BUG #7 — autoFixLoop uses runtimeErrorsRef', () => {
  test('source declares const runtimeErrorsRef = useRef<ProbeError[]>([])', () => {
    expect(source).toContain('const runtimeErrorsRef = useRef<ProbeError[]>([])')
  })

  test('a useEffect syncs runtimeErrorsRef.current = runtimeErrors', () => {
    expect(source).toContain('runtimeErrorsRef.current = runtimeErrors')
    // Verify it's inside a useEffect (the sync should be reactive, not one-shot).
    const syncIdx = source.indexOf('runtimeErrorsRef.current = runtimeErrors')
    const useEffectOpen = source.lastIndexOf('useEffect', syncIdx)
    const useEffectClose = source.indexOf('}, [', syncIdx)
    expect(useEffectOpen).toBeGreaterThan(-1)
    expect(useEffectClose).toBeGreaterThan(syncIdx)
    // The deps array should contain runtimeErrors.
    const depsArray = source.slice(syncIdx, useEffectClose + 10)
    expect(depsArray).toContain('runtimeErrors')
  })

  test('autoFixLoop uses the fallback pattern runtimeErrorsRef.current ?? runtimeErrors', () => {
    const autoFixLoopSection = getUseCallbackBody('autoFixLoop')
    expect(autoFixLoopSection).toContain('runtimeErrorsRef.current ?? runtimeErrors')
  })

  test('the ref is used in the autoFixLoop error collection (allErrors array)', () => {
    const autoFixLoopSection = getUseCallbackBody('autoFixLoop')
    // The error collection spreads the ref (with fallback) into allErrors.
    expect(autoFixLoopSection).toContain('...(runtimeErrorsRef.current ?? runtimeErrors)')
    // And combines with probe.errors.
    expect(autoFixLoopSection).toContain('...probe.errors')
    // The result is sliced to cap at 10 errors.
    expect(autoFixLoopSection).toContain('.slice(0, 10)')
  })

  test('the runtimeErrorsRef declaration has a v29.46 comment', () => {
    const refIdx = source.indexOf('const runtimeErrorsRef = useRef<ProbeError[]>([])')
    // Look at the 2 lines above the declaration for the comment.
    const above = source.slice(Math.max(0, refIdx - 200), refIdx)
    expect(above).toContain('v29.46')
  })
})

// ===========================================================================
// 4. autoFixLoop wait is cancellable — BUG #8 fix
//    The 2-second wait between fix iterations used a plain `setTimeout(resolve,
//    2000)` with no way to cancel. If the user clicked reset or cancelled
//    during the wait, the loop would continue to the next iteration on stale
//    state. The fix wires the wait to the refineAbortRef signal so it rejects
//    with AbortError when aborted.
// ===========================================================================
describe('BUG #8 — autoFixLoop wait is cancellable', () => {
  test('the 2-second wait uses setTimeout(resolve, 2000) inside a Promise', () => {
    const autoFixLoopSection = getUseCallbackBody('autoFixLoop')
    expect(autoFixLoopSection).toContain('setTimeout(resolve, 2000)')
  })

  test('the wait logic calls clearTimeout(t) on abort', () => {
    const autoFixLoopSection = getUseCallbackBody('autoFixLoop')
    expect(autoFixLoopSection).toContain('clearTimeout(t)')
  })

  test('the wait rejects with new DOMException(\'Aborted\', \'AbortError\')', () => {
    const autoFixLoopSection = getUseCallbackBody('autoFixLoop')
    expect(autoFixLoopSection).toContain("reject(new DOMException('Aborted', 'AbortError'))")
  })

  test('the wait adds an abort listener via addEventListener(\'abort\', onAbort', () => {
    const autoFixLoopSection = getUseCallbackBody('autoFixLoop')
    expect(autoFixLoopSection).toContain("addEventListener('abort', onAbort")
  })

  test('the abort listener is registered with { once: true }', () => {
    const autoFixLoopSection = getUseCallbackBody('autoFixLoop')
    expect(autoFixLoopSection).toContain('{ once: true }')
  })

  test('the catch block breaks the loop on AbortError', () => {
    const autoFixLoopSection = getUseCallbackBody('autoFixLoop')
    // The try/catch around the wait should break on any error (abort or net).
    const waitIdx = autoFixLoopSection.indexOf('setTimeout(resolve, 2000)')
    expect(waitIdx).toBeGreaterThan(-1)
    const afterWait = autoFixLoopSection.slice(waitIdx)
    expect(afterWait).toContain('break')
    expect(afterWait).toContain('Aborted during wait')
  })

  test('the wait is wired to refineAbortRef.current?.signal', () => {
    const autoFixLoopSection = getUseCallbackBody('autoFixLoop')
    expect(autoFixLoopSection).toContain('refineAbortRef.current?.signal')
  })
})

// ===========================================================================
// 5. Delete history syncs historyRef — BUG #10 fix
//    The delete-history onClick called setHistory(newHistory) but did NOT
//    update historyRef.current. The useEffect that syncs the ref runs AFTER
//    render, so addBuildToHistory (which reads historyRef.current) could
//    re-add the just-deleted item if it fired in the same tick. The fix
//    sets historyRef.current = newHistory synchronously inside the onClick.
// ===========================================================================
describe('BUG #10 — Delete history syncs historyRef synchronously', () => {
  test('the delete-history onClick sets historyRef.current = newHistory', () => {
    const deleteSection = getDeleteHistoryOnClickSection()
    expect(deleteSection).toContain('historyRef.current = newHistory')
  })

  test('the sync appears AFTER setHistory(newHistory) in the onClick', () => {
    const deleteSection = getDeleteHistoryOnClickSection()
    const setHistoryIdx = deleteSection.indexOf('setHistory(newHistory)')
    const refSyncIdx = deleteSection.indexOf('historyRef.current = newHistory')
    expect(setHistoryIdx).toBeGreaterThan(-1)
    expect(refSyncIdx).toBeGreaterThan(-1)
    expect(refSyncIdx).toBeGreaterThan(setHistoryIdx)
  })

  test('the sync is synchronous (not inside setTimeout() or useEffect())', () => {
    const deleteSection = getDeleteHistoryOnClickSection()
    const refSyncIdx = deleteSection.indexOf('historyRef.current = newHistory')
    expect(refSyncIdx).toBeGreaterThan(-1)
    // Walk backwards from the sync to ensure no setTimeout( or useEffect(
    // CALL opens between the start of the onClick and the sync line.
    // (We match the opening paren to avoid false positives from comments
    // that merely mention "useEffect" in prose — the v29.46 comment does.)
    const before = deleteSection.slice(0, refSyncIdx)
    expect(before).not.toContain('setTimeout(')
    expect(before).not.toContain('useEffect(')
  })

  test('the delete-history onClick contains the v29.46 comment', () => {
    const deleteSection = getDeleteHistoryOnClickSection()
    expect(deleteSection).toContain('v29.46')
  })
})

// ===========================================================================
// 6. Dead autoFix function removed — BUG #12 fix
//    A 169-line single-iteration `autoFix` useCallback existed but was never
//    called anywhere — only `autoFixLoop` (which has its own multi-iteration
//    logic) is invoked. The dead function was removed to reduce bundle size.
// ===========================================================================
describe('BUG #12 — Dead autoFix function removed', () => {
  test('source does NOT contain const autoFix = useCallback(async () => {', () => {
    expect(source).not.toContain('const autoFix = useCallback(async () => {')
  })

  test('source still contains const autoFixLoop = useCallback (the loop is kept)', () => {
    expect(source).toContain('const autoFixLoop = useCallback')
  })

  test('source contains a comment mentioning DEAD CODE or removed in v29.46', () => {
    // The comment block at line 1063 documents the removal.
    expect(source).toContain('DEAD CODE')
    expect(source).toContain('removed in v29.46')
  })

  test('source does NOT contain setAutoFixing(true) (old autoFix was the only caller)', () => {
    // The dead autoFix function was the only caller of setAutoFixing(true).
    // With it removed, setAutoFixing(true) should not appear anywhere.
    // (setAutoFixing is still declared as part of useState, but never set true.)
    expect(source).not.toContain('setAutoFixing(true)')
  })

  test('the DEAD CODE comment explains the rationale (bundle size / maintenance)', () => {
    const deadCodeIdx = source.indexOf('DEAD CODE')
    expect(deadCodeIdx).toBeGreaterThan(-1)
    const commentBlock = source.slice(deadCodeIdx, deadCodeIdx + 400)
    expect(commentBlock).toContain('169 lines')
    expect(commentBlock).toMatch(/bundle size|maintenance|never called/)
  })
})

// ===========================================================================
// 7. Model-selector buttons update selectedModelRef synchronously — BUG #16 fix
//    The Z.AI / Qwen / Kimi K3 selector buttons called setSelectedModel(model)
//    but did NOT update selectedModelRef.current. The ref is read by
//    keyboard handlers and retryWithModel, so a stale ref meant pressing
//    Cmd+M or retrying right after switching models used the OLD model. The
//    fix sets selectedModelRef.current = '<model>' synchronously in each
//    button's onClick.
// ===========================================================================
describe('BUG #16 — Model-selector buttons update selectedModelRef synchronously', () => {
  test('the Z.AI button onClick sets selectedModelRef.current = \'z-ai\'', () => {
    const buttonsSection = getModelSelectorButtonsSection()
    expect(buttonsSection).toContain("selectedModelRef.current = 'z-ai'")
  })

  test('the Qwen button onClick sets selectedModelRef.current = \'qwen\'', () => {
    const buttonsSection = getModelSelectorButtonsSection()
    expect(buttonsSection).toContain("selectedModelRef.current = 'qwen'")
  })

  test('the Kimi button onClick sets selectedModelRef.current = \'kimi\'', () => {
    const buttonsSection = getModelSelectorButtonsSection()
    expect(buttonsSection).toContain("selectedModelRef.current = 'kimi'")
  })

  test('each button updates setSelectedModel AND selectedModelRef in the same onClick', () => {
    const buttonsSection = getModelSelectorButtonsSection()
    // The synchronous pattern is: setSelectedModel('X'); selectedModelRef.current = 'X';
    expect(buttonsSection).toContain("setSelectedModel('z-ai'); selectedModelRef.current = 'z-ai'")
    expect(buttonsSection).toContain("setSelectedModel('qwen'); selectedModelRef.current = 'qwen'")
    expect(buttonsSection).toContain("setSelectedModel('kimi'); selectedModelRef.current = 'kimi'")
  })

  test('the model-selector literals do NOT appear in retryWithModel (it uses variables)', () => {
    // retryWithModel receives `model` as a parameter and sets
    // selectedModelRef.current = model (variable, not literal).
    const retrySection = getUseCallbackBody('retryWithModel')
    expect(retrySection).not.toContain("selectedModelRef.current = 'z-ai'")
    expect(retrySection).not.toContain("selectedModelRef.current = 'qwen'")
    expect(retrySection).not.toContain("selectedModelRef.current = 'kimi'")
    // But it DOES update the ref (via the variable).
    expect(retrySection).toContain('selectedModelRef.current = model')
  })

  test('all 3 selector buttons also persist to localStorage synchronously', () => {
    const buttonsSection = getModelSelectorButtonsSection()
    // The fix should also keep localStorage in sync (the original bug was that
    // the ref was stale; the same onClick should persist the choice).
    expect(buttonsSection).toContain("localStorage.setItem('nova_model', 'z-ai')")
    expect(buttonsSection).toContain("localStorage.setItem('nova_model', 'qwen')")
    expect(buttonsSection).toContain("localStorage.setItem('nova_model', 'kimi')")
  })
})

// ===========================================================================
// 8. page.tsx line count decreased — dead-code removal shrunk the file
//    The file was 4342 lines in v29.45; removing the 169-line dead autoFix
//    function (plus a few other cleanups) brought it to ~4235 lines.
// ===========================================================================
describe('page.tsx line count decreased after v29.46 dead-code removal', () => {
  test('source has fewer than 4300 lines (was 4342, target ~4235)', () => {
    const lineCount = source.split('\n').length
    expect(lineCount).toBeLessThan(4300)
  })

  test('source has approximately 4000 lines (within ±100 of the target)', () => {
    const lineCount = source.split('\n').length
    expect(lineCount).toBeGreaterThanOrEqual(3900)
    expect(lineCount).toBeLessThanOrEqual(4100)
  })
})
