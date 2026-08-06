// Comprehensive tests for recently fixed bugs in NOVA.
//
// Covers 4 bug fixes:
//   BUG #2: src/lib/multi-file.ts — parseOutput now extracts ALL ```file:path
//           fences (previously only the first fence was captured, silently
//           dropping subsequent files).
//   page-constants.ts — extracted constants module (smoke tests for the
//           refactored data + getSuggestionsForMission function).
//   BUG #3: src/lib/build-health.ts — `score` variable is now clamped to
//           0-100 and used in the A-grade check (previously dead code).
//   BUG #1: src/lib/interaction-probe.ts — security script is now injected
//           to block parent/top/opener access (prevention of data
//           exfiltration via parent.fetch()).
//
// All tests are hermetic (no dev server, no network, no DOM). The probe
// tests are characterization tests that read the source file directly
// because probeApp requires a browser environment.
import { describe, expect, test } from 'bun:test'
import * as fs from 'fs'
import * as path from 'path'
import { parseOutput } from '../src/lib/multi-file'
import {
  STARTER_CATEGORIES,
  EXAMPLES,
  SLASH_COMMANDS,
  REFINE_THINKING_STEPS,
  SUGGESTION_GROUPS,
  DEFAULT_SUGGESTIONS,
  getSuggestionsForMission,
} from '../src/lib/page-constants'
import { calculateBuildHealth } from '../src/lib/build-health'

// ═══════════════════════════════════════════════════════════════════════
// Section 1: Multi-file parseOutput — BUG #2 (multiple ```file:path fences)
// ═══════════════════════════════════════════════════════════════════════

describe('BUG #2: parseOutput extracts ALL ```file:path fences', () => {
  test('single ```file:app.py fence → returns 1 file', () => {
    const input = '```file:app.py\nprint("hello")\n```'
    const result = parseOutput(input)
    expect(result.files).toHaveLength(1)
    expect(result.files[0]!.path).toBe('app.py')
  })

  test('two fences: app.py + utils.py → returns 2 files with correct paths and content', () => {
    const input = [
      '```file:app.py',
      'print("hello")',
      '```',
      '',
      '```file:utils.py',
      'def helper():',
      '    return 42',
      '```',
    ].join('\n')
    const result = parseOutput(input)
    expect(result.files).toHaveLength(2)
    expect(result.files[0]!.path).toBe('app.py')
    expect(result.files[1]!.path).toBe('utils.py')
    expect(result.files[0]!.content).toContain('print("hello")')
    expect(result.files[1]!.content).toContain('def helper():')
    expect(result.files[1]!.content).toContain('return 42')
  })

  test('three fences: app.py, utils.py, config.json → returns 3 files', () => {
    const input = [
      '```file:app.py',
      'print("main")',
      '```',
      '',
      '```file:utils.py',
      'def helper():',
      '    pass',
      '```',
      '',
      '```file:config.json',
      '{"name": "nova", "version": 1}',
      '```',
    ].join('\n')
    const result = parseOutput(input)
    expect(result.files).toHaveLength(3)
    expect(result.files[0]!.path).toBe('app.py')
    expect(result.files[1]!.path).toBe('utils.py')
    expect(result.files[2]!.path).toBe('config.json')
  })

  test('fence with empty content (only whitespace) → skipped, not included in files', () => {
    const input = [
      '```file:app.py',
      'print("real")',
      '```',
      '',
      '```file:empty.py',
      '   ',
      '```',
      '',
      '```file:also_empty.py',
      '',
      '```',
    ].join('\n')
    const result = parseOutput(input)
    expect(result.files).toHaveLength(1)
    expect(result.files[0]!.path).toBe('app.py')
  })

  test('fence content is preserved exactly (no trimming of internal content)', () => {
    // Internal whitespace, leading spaces, and blank lines must survive.
    const input = '```file:app.py\n  \nprint("a")\n\n\nprint("b")\n  \n```'
    const result = parseOutput(input)
    expect(result.files).toHaveLength(1)
    const content = result.files[0]!.content
    // Leading whitespace line preserved
    expect(content.startsWith('  \n')).toBe(true)
    // Middle blank lines preserved
    expect(content).toContain('print("a")\n\n\nprint("b")')
    // Trailing whitespace line preserved
    expect(content.endsWith('  \n')).toBe(true)
  })

  test('primary file detection: main.py is chosen as primaryFile when present', () => {
    const input = [
      '```file:utils.py',
      'def helper():',
      '    return 1',
      '```',
      '',
      '```file:main.py',
      'from utils import helper',
      'print(helper())',
      '```',
    ].join('\n')
    const result = parseOutput(input)
    expect(result.files).toHaveLength(2)
    expect(result.primaryFile).toBe('main.py')
  })

  test('language detection from path: .py → python', () => {
    const input = '```file:script.py\nprint("hi")\n```'
    const result = parseOutput(input)
    expect(result.files[0]!.language).toBe('python')
  })

  test('language detection from path: .js → javascript', () => {
    const input = '```file:index.js\nconsole.log("hi")\n```'
    const result = parseOutput(input)
    expect(result.files[0]!.language).toBe('javascript')
  })

  test('language detection from path: .ts → typescript', () => {
    const input = '```file:index.ts\nconst x: number = 1\n```'
    const result = parseOutput(input)
    expect(result.files[0]!.language).toBe('typescript')
  })

  test('mixed languages: app.py + styles.css + data.json → correct languages for each', () => {
    const input = [
      '```file:app.py',
      'print("main")',
      '```',
      '',
      '```file:styles.css',
      'body { margin: 0; }',
      '```',
      '',
      '```file:data.json',
      '{"key": "value"}',
      '```',
    ].join('\n')
    const result = parseOutput(input)
    expect(result.files).toHaveLength(3)
    const langs = result.files.map(f => f.language)
    expect(langs).toContain('python')
    expect(langs).toContain('css')
    expect(langs).toContain('json')
    // Spot-check the path → language mapping is per-file, not global
    expect(result.files[0]!.language).toBe('python')
    expect(result.files[1]!.language).toBe('css')
    expect(result.files[2]!.language).toBe('json')
  })

  test('order of files in result matches order of fences in input', () => {
    const input = [
      '```file:zeta.py',
      'print("z")',
      '```',
      '',
      '```file:alpha.py',
      'print("a")',
      '```',
      '',
      '```file:mid.py',
      'print("m")',
      '```',
    ].join('\n')
    const result = parseOutput(input)
    expect(result.files.map(f => f.path)).toEqual(['zeta.py', 'alpha.py', 'mid.py'])
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Section 2: page-constants.ts module tests
// ═══════════════════════════════════════════════════════════════════════

describe('page-constants: STARTER_CATEGORIES', () => {
  test('has exactly 4 categories', () => {
    expect(STARTER_CATEGORIES).toHaveLength(4)
  })

  test('each category has icon, label, and prompts (array of strings)', () => {
    for (const cat of STARTER_CATEGORIES) {
      expect(typeof cat.icon).toBe('string')
      expect(cat.icon.length).toBeGreaterThan(0)
      expect(typeof cat.label).toBe('string')
      expect(cat.label.length).toBeGreaterThan(0)
      expect(Array.isArray(cat.prompts)).toBe(true)
      expect(cat.prompts.length).toBeGreaterThan(0)
      for (const p of cat.prompts) {
        expect(typeof p).toBe('string')
        expect(p.length).toBeGreaterThan(0)
      }
    }
  })

  test('EXAMPLES is the flatMap of all prompts (12 total)', () => {
    const expected = STARTER_CATEGORIES.flatMap(c => c.prompts)
    expect(EXAMPLES).toEqual(expected)
    expect(EXAMPLES).toHaveLength(12)
  })
})

describe('page-constants: SLASH_COMMANDS', () => {
  test('has exactly 5 commands', () => {
    expect(SLASH_COMMANDS).toHaveLength(5)
  })

  test('each command has cmd, label, icon, action fields', () => {
    for (const cmd of SLASH_COMMANDS) {
      expect(typeof cmd.cmd).toBe('string')
      expect(cmd.cmd.startsWith('/')).toBe(true)
      expect(typeof cmd.label).toBe('string')
      expect(cmd.label.length).toBeGreaterThan(0)
      expect(typeof cmd.icon).toBe('string')
      expect(['filter', 'insert']).toContain(cmd.action)
    }
  })
})

describe('page-constants: REFINE_THINKING_STEPS', () => {
  test('has exactly 3 steps', () => {
    expect(REFINE_THINKING_STEPS).toHaveLength(3)
  })

  test('each step is a non-empty string', () => {
    for (const step of REFINE_THINKING_STEPS) {
      expect(typeof step).toBe('string')
      expect(step.length).toBeGreaterThan(0)
    }
  })
})

describe('page-constants: SUGGESTION_GROUPS (BUG #2 duplicate removal)', () => {
  test('has exactly 6 groups (NOT 7 — duplicate was removed)', () => {
    expect(SUGGESTION_GROUPS).toHaveLength(6)
  })

  test('each group has match and suggestions arrays (non-empty)', () => {
    for (const g of SUGGESTION_GROUPS) {
      expect(Array.isArray(g.match)).toBe(true)
      expect(g.match.length).toBeGreaterThan(0)
      expect(Array.isArray(g.suggestions)).toBe(true)
      expect(g.suggestions.length).toBeGreaterThan(0)
    }
  })

  test('no duplicate suggestion groups — "paint" keyword appears in exactly 1 group', () => {
    const paintGroups = SUGGESTION_GROUPS.filter(g => g.match.includes('paint'))
    expect(paintGroups).toHaveLength(1)
  })

  test('no duplicate suggestion groups — "game" keyword appears in exactly 1 group', () => {
    const gameGroups = SUGGESTION_GROUPS.filter(g => g.match.includes('game'))
    expect(gameGroups).toHaveLength(1)
  })

  test('"art" and "paint" are in the SAME group (not split across duplicates)', () => {
    const artGroup = SUGGESTION_GROUPS.find(g => g.match.includes('art'))
    expect(artGroup).toBeDefined()
    expect(artGroup!.match).toContain('paint')
    expect(artGroup!.match).toContain('draw')
  })
})

describe('page-constants: DEFAULT_SUGGESTIONS', () => {
  test('has exactly 4 entries', () => {
    expect(DEFAULT_SUGGESTIONS).toHaveLength(4)
  })

  test('each entry is a non-empty string', () => {
    for (const s of DEFAULT_SUGGESTIONS) {
      expect(typeof s).toBe('string')
      expect(s.length).toBeGreaterThan(0)
    }
  })
})

describe('page-constants: getSuggestionsForMission', () => {
  test('"build a snake game" → returns game suggestions (first match wins)', () => {
    const result = getSuggestionsForMission('build a snake game')
    const gameGroup = SUGGESTION_GROUPS.find(g => g.match.includes('game'))!
    expect(result).toBe(gameGroup.suggestions)
  })

  test('"build a dashboard" → returns dashboard suggestions', () => {
    const result = getSuggestionsForMission('build a dashboard')
    const dashboardGroup = SUGGESTION_GROUPS.find(g => g.match.includes('dashboard'))!
    expect(result).toBe(dashboardGroup.suggestions)
  })

  test('"build a todo app" → returns todo suggestions', () => {
    const result = getSuggestionsForMission('build a todo app')
    const todoGroup = SUGGESTION_GROUPS.find(g => g.match.includes('todo'))!
    expect(result).toBe(todoGroup.suggestions)
  })

  test('"build a timer" → returns timer suggestions', () => {
    const result = getSuggestionsForMission('build a timer')
    const timerGroup = SUGGESTION_GROUPS.find(g => g.match.includes('timer'))!
    expect(result).toBe(timerGroup.suggestions)
  })

  test('"build a paint app" → returns art suggestions (NOT duplicated)', () => {
    const result = getSuggestionsForMission('build a paint app')
    const artGroup = SUGGESTION_GROUPS.find(g => g.match.includes('paint'))!
    expect(result).toBe(artGroup.suggestions)
    // Verify only one art group exists (the duplicate was removed)
    const artGroups = SUGGESTION_GROUPS.filter(g => g.match.includes('paint'))
    expect(artGroups).toHaveLength(1)
  })

  test('mission with no matching keywords → returns DEFAULT_SUGGESTIONS', () => {
    // Note: "text" IS a keyword (matches the editor group), so we use a string
    // that contains no keyword substrings at all.
    const result = getSuggestionsForMission('build a weather widget')
    expect(result).toBe(DEFAULT_SUGGESTIONS)
  })

  test('empty string → returns DEFAULT_SUGGESTIONS', () => {
    const result = getSuggestionsForMission('')
    expect(result).toBe(DEFAULT_SUGGESTIONS)
  })

  test('case-insensitive: "GAME" (uppercase) matches the game group', () => {
    const result = getSuggestionsForMission('BUILD A GAME')
    const gameGroup = SUGGESTION_GROUPS.find(g => g.match.includes('game'))!
    expect(result).toBe(gameGroup.suggestions)
  })

  test('deterministic: same input returns the same array reference', () => {
    const a = getSuggestionsForMission('build a snake game')
    const b = getSuggestionsForMission('build a snake game')
    expect(a).toBe(b) // referential equality
  })

  test('deterministic: same default-input returns DEFAULT_SUGGESTIONS reference', () => {
    const a = getSuggestionsForMission('totally unrelated string')
    const b = getSuggestionsForMission('another unrelated string')
    expect(a).toBe(DEFAULT_SUGGESTIONS)
    expect(b).toBe(DEFAULT_SUGGESTIONS)
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Section 3: build-health.ts score usage — BUG #3
// ═══════════════════════════════════════════════════════════════════════

describe('BUG #3: calculateBuildHealth uses clamped score for grading', () => {
  test('Quality 100, 0 missing, 0 errors, 1min → grade A', () => {
    const h = calculateBuildHealth({
      quality: 100, missingFeatures: 0, staticErrors: 0, buildTimeMs: 60_000, truncated: false,
    })
    expect(h.grade).toBe('A')
    expect(h.label).toBe('Excellent')
  })

  test('Quality 85, 0 missing, 0 errors, 3min → grade A (boundary: buildTimeMin === 3)', () => {
    const h = calculateBuildHealth({
      quality: 85, missingFeatures: 0, staticErrors: 0, buildTimeMs: 180_000, truncated: false,
    })
    expect(h.grade).toBe('A')
  })

  test('Quality 85, 0 missing, 0 errors, 5min → grade B (buildTimeMin > 3)', () => {
    const h = calculateBuildHealth({
      quality: 85, missingFeatures: 0, staticErrors: 0, buildTimeMs: 300_000, truncated: false,
    })
    expect(h.grade).toBe('B')
    expect(h.label).toBe('Good')
  })

  test('Quality 70, 1 missing, 0 errors, 3min → grade B', () => {
    const h = calculateBuildHealth({
      quality: 70, missingFeatures: 1, staticErrors: 0, buildTimeMs: 180_000, truncated: false,
    })
    expect(h.grade).toBe('B')
  })

  test('Quality 50, 3 missing, 2 errors, 5min → grade C', () => {
    const h = calculateBuildHealth({
      quality: 50, missingFeatures: 3, staticErrors: 2, buildTimeMs: 300_000, truncated: false,
    })
    expect(h.grade).toBe('C')
    expect(h.label).toBe('Acceptable')
  })

  test('Quality 30, 5 missing, 4 errors, 10min → grade D', () => {
    const h = calculateBuildHealth({
      quality: 30, missingFeatures: 5, staticErrors: 4, buildTimeMs: 600_000, truncated: false,
    })
    expect(h.grade).toBe('D')
    expect(h.label).toBe('Poor')
  })

  test('truncated output → always grade D regardless of quality', () => {
    // Even with quality=100 and no errors, truncated must be D
    const h = calculateBuildHealth({
      quality: 100, missingFeatures: 0, staticErrors: 0, buildTimeMs: 60_000, truncated: true,
    })
    expect(h.grade).toBe('D')
    expect(h.label).toBe('Poor')
  })

  test('truncated output → reasons mentions truncation', () => {
    const h = calculateBuildHealth({
      quality: 100, missingFeatures: 0, staticErrors: 0, buildTimeMs: 60_000, truncated: true,
    })
    expect(h.reasons.length).toBeGreaterThan(0)
    expect(h.reasons.some(r => r.toLowerCase().includes('truncat'))).toBe(true)
  })

  test('reasons array is populated with human-readable strings for a B-grade build', () => {
    const h = calculateBuildHealth({
      quality: 75, missingFeatures: 1, staticErrors: 0, buildTimeMs: 240_000, truncated: false,
    })
    expect(h.grade).toBe('B')
    expect(h.reasons.length).toBeGreaterThan(0)
    for (const r of h.reasons) {
      expect(typeof r).toBe('string')
      expect(r.length).toBeGreaterThan(0)
    }
  })

  test('reasons array is populated for a C-grade build with multiple issues', () => {
    const h = calculateBuildHealth({
      quality: 55, missingFeatures: 3, staticErrors: 2, buildTimeMs: 360_000, truncated: false,
    })
    expect(h.grade).toBe('C')
    expect(h.reasons.length).toBeGreaterThanOrEqual(2)
    for (const r of h.reasons) {
      expect(typeof r).toBe('string')
      expect(r.length).toBeGreaterThan(0)
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Section 4: interaction-probe.ts security script injection — BUG #1
// ═══════════════════════════════════════════════════════════════════════

// Characterization test: probeApp requires a browser DOM (creates an iframe),
// so we test the security script injection by inspecting the source code.

const PROBE_SOURCE_PATH = path.join(process.cwd(), 'src', 'lib', 'interaction-probe.ts')
const probeSource: string = fs.readFileSync(PROBE_SOURCE_PATH, 'utf-8')

describe('BUG #1: interaction-probe.ts injects security script', () => {
  test('source defines window.parent as window (blocks parent access)', () => {
    expect(probeSource).toContain("Object.defineProperty(window, 'parent'")
    // Getter returns window (so parent === self inside the iframe)
    const parentIdx = probeSource.indexOf("Object.defineProperty(window, 'parent'")
    expect(parentIdx).toBeGreaterThanOrEqual(0)
    const parentSlice = probeSource.slice(parentIdx, parentIdx + 200)
    expect(parentSlice).toContain('get')
    expect(parentSlice).toContain('=>')
    expect(parentSlice).toContain('window')
  })

  test('source defines window.top as window (blocks top access)', () => {
    expect(probeSource).toContain("Object.defineProperty(window, 'top'")
    const topIdx = probeSource.indexOf("Object.defineProperty(window, 'top'")
    expect(topIdx).toBeGreaterThanOrEqual(0)
    const topSlice = probeSource.slice(topIdx, topIdx + 200)
    expect(topSlice).toContain('get')
    expect(topSlice).toContain('=>')
    expect(topSlice).toContain('window')
  })

  test('source defines window.opener as null (blocks opener access)', () => {
    expect(probeSource).toContain("Object.defineProperty(window, 'opener'")
    // The full opener definition uses `get: () => null` — check the broader
    // context (a narrow [^)]* regex stops at the `()` in the arrow function).
    const openerIdx = probeSource.indexOf("Object.defineProperty(window, 'opener'")
    expect(openerIdx).toBeGreaterThanOrEqual(0)
    // Grab a generous slice after the opener defineProperty call so we see
    // the getter body that returns null.
    const openerSlice = probeSource.slice(openerIdx, openerIdx + 200)
    expect(openerSlice).toContain('get')
    expect(openerSlice).toContain('=>')
    expect(openerSlice).toContain('null')
  })

  test('security script is injected before iframe.srcdoc assignment', () => {
    // The `parent` defineProperty call must appear BEFORE `iframe.srcdoc =`
    // in the source file. This ensures the security script runs first.
    const defineParentIdx = probeSource.indexOf("Object.defineProperty(window, 'parent'")
    const srcdocIdx = probeSource.indexOf('iframe.srcdoc')
    expect(defineParentIdx).toBeGreaterThanOrEqual(0)
    expect(srcdocIdx).toBeGreaterThanOrEqual(0)
    expect(defineParentIdx).toBeLessThan(srcdocIdx)
  })

  test('security script is injected via a securityScript variable before srcdoc', () => {
    // The variable that holds the security script must be defined before srcdoc assignment
    const securityScriptIdx = probeSource.indexOf('securityScript')
    const srcdocIdx = probeSource.indexOf('iframe.srcdoc')
    expect(securityScriptIdx).toBeGreaterThanOrEqual(0)
    expect(securityScriptIdx).toBeLessThan(srcdocIdx)
  })

  test('uses Object.defineProperty with configurable: false', () => {
    // All three property definitions must use configurable: false so the
    // attacker cannot redefine them.
    expect(probeSource).toContain('configurable: false')
    // Count occurrences — should be at least 3 (one per property)
    const matches = probeSource.match(/configurable:\s*false/g)
    expect(matches).not.toBeNull()
    expect(matches!.length).toBeGreaterThanOrEqual(3)
  })

  test('security script handles errors with try/catch', () => {
    // Each defineProperty call is wrapped in try/catch so that if the
    // property is already defined, the script doesn't crash.
    const tryCount = (probeSource.match(/try\s*\{/g) || []).length
    const catchCount = (probeSource.match(/catch\s*\(/g) || []).length
    expect(tryCount).toBeGreaterThanOrEqual(3)
    expect(catchCount).toBeGreaterThanOrEqual(3)
    // Verify try/catch is near the security script (within the securityScript block)
    const securityScriptStart = probeSource.indexOf('securityScript')
    expect(securityScriptStart).toBeGreaterThanOrEqual(0)
    const securityBlock = probeSource.slice(securityScriptStart, securityScriptStart + 1500)
    const blockTryCount = (securityBlock.match(/try\s*\{/g) || []).length
    expect(blockTryCount).toBeGreaterThanOrEqual(3)
  })

  test('security script is referenced in safeHtml construction (injected into the iframe)', () => {
    // The securityScript must be inserted into safeHtml (via replace or concatenation)
    // before the iframe is loaded. This is what actually injects it into the iframe.
    const securityScriptIdx = probeSource.indexOf('securityScript')
    const safeHtmlIdx = probeSource.indexOf('safeHtml')
    expect(securityScriptIdx).toBeGreaterThanOrEqual(0)
    expect(safeHtmlIdx).toBeGreaterThanOrEqual(0)
    // The injection happens AFTER both variables are defined.
    // Verify safeHtml references securityScript somewhere.
    const afterSafeHtml = probeSource.slice(safeHtmlIdx)
    expect(afterSafeHtml).toContain('securityScript')
  })

  test('source contains a comment explaining the security rationale', () => {
    // Documentation: the script should explain WHY it blocks parent/top/opener.
    // Look for keywords like "security", "exfiltrat", or "block".
    const lower = probeSource.toLowerCase()
    const hasSecurityComment =
      lower.includes('security') ||
      lower.includes('exfiltrat') ||
      lower.includes('block access')
    expect(hasSecurityComment).toBe(true)
  })
})
