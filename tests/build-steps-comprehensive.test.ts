// Comprehensive tests for src/lib/build-steps.ts
// Tests extractStepsFromMission, extractStepsFromPlan, getPlanSummary, plus edge cases.
import { describe, expect, test } from 'bun:test'
import {
  extractStepsFromMission,
  extractStepsFromPlan,
  getPlanSummary,
} from '../src/lib/build-steps'

// ─────────────────────────────────────────────────────────────────────────────
// extractStepsFromMission — type detection
// ─────────────────────────────────────────────────────────────────────────────

describe('extractStepsFromMission — type detection', () => {
  test('snake mission yields game steps', () => {
    const steps = extractStepsFromMission('Build a snake game')
    expect(steps).toContain('Planning game mechanics...')
    expect(steps).toContain('Designing the game board...')
    expect(steps).toContain('Building the game loop...')
    expect(steps).toContain('Adding snake movement & collision...')
    expect(steps).toContain('Implementing scoring system...')
    expect(steps).toContain('Adding game-over & restart...')
    expect(steps).toContain('Styling the game UI...')
  })

  test('generic "game" mission also yields game steps', () => {
    const steps = extractStepsFromMission('Build a game')
    expect(steps).toContain('Planning game mechanics...')
  })

  test('todo mission yields todo steps', () => {
    const steps = extractStepsFromMission('Build a todo app')
    expect(steps).toContain('Planning the task structure...')
    expect(steps).toContain('Building the input form...')
    expect(steps).toContain('Adding task list display...')
    expect(steps).toContain('Implementing add/complete/delete...')
    expect(steps).toContain('Adding filters (all/active/completed)...')
    expect(steps).toContain('Styling the todo UI...')
  })

  test('task mission also yields todo steps', () => {
    const steps = extractStepsFromMission('Build a task tracker')
    expect(steps).toContain('Planning the task structure...')
  })

  test('calculator mission yields calculator steps', () => {
    const steps = extractStepsFromMission('Build a calculator')
    expect(steps).toContain('Planning the calculator logic...')
    expect(steps).toContain('Building the display & buttons...')
    expect(steps).toContain('Implementing arithmetic operations...')
    expect(steps).toContain('Adding keyboard support...')
    expect(steps).toContain('Styling the calculator UI...')
  })

  test('"calc" (short form) also yields calculator steps', () => {
    const steps = extractStepsFromMission('Build a calc')
    expect(steps).toContain('Planning the calculator logic...')
  })

  test('color palette mission yields color steps', () => {
    const steps = extractStepsFromMission('Build a color palette generator')
    expect(steps).toContain('Planning the color system...')
    expect(steps).toContain('Building the color generator...')
    expect(steps).toContain('Adding copy-to-clipboard...')
    expect(steps).toContain('Implementing color display...')
    expect(steps).toContain('Styling the palette UI...')
  })

  test('"palette" alone yields color steps', () => {
    const steps = extractStepsFromMission('Build a palette')
    expect(steps).toContain('Planning the color system...')
  })

  test('markdown editor mission yields markdown steps', () => {
    const steps = extractStepsFromMission('Build a markdown editor')
    expect(steps).toContain('Planning the editor layout...')
    expect(steps).toContain('Building the text input area...')
    expect(steps).toContain('Implementing markdown parsing...')
    expect(steps).toContain('Adding live preview...')
    expect(steps).toContain('Styling the editor UI...')
  })

  test('"editor" alone yields markdown steps', () => {
    const steps = extractStepsFromMission('Build a code editor')
    expect(steps).toContain('Planning the editor layout...')
  })

  test('"text" alone yields markdown steps', () => {
    const steps = extractStepsFromMission('Build a text formatter')
    expect(steps).toContain('Planning the editor layout...')
  })

  test('clock mission yields timer steps', () => {
    const steps = extractStepsFromMission('Build a clock')
    expect(steps).toContain('Planning the time logic...')
    expect(steps).toContain('Building the display...')
    expect(steps).toContain('Implementing start/stop/reset...')
    expect(steps).toContain('Adding time formatting...')
    expect(steps).toContain('Styling the timer UI...')
  })

  test('timer mission yields timer steps', () => {
    const steps = extractStepsFromMission('Build a timer')
    expect(steps).toContain('Planning the time logic...')
  })

  test('stopwatch mission yields timer steps', () => {
    const steps = extractStepsFromMission('Build a stopwatch')
    expect(steps).toContain('Planning the time logic...')
  })

  test('weather mission yields weather steps', () => {
    const steps = extractStepsFromMission('Build a weather app')
    expect(steps).toContain('Planning the weather display...')
    expect(steps).toContain('Building the layout...')
    expect(steps).toContain('Adding mock weather data...')
    expect(steps).toContain('Styling the weather UI...')
  })

  test('music player mission yields music steps', () => {
    const steps = extractStepsFromMission('Build a music player')
    expect(steps).toContain('Planning the music player...')
    expect(steps).toContain('Building the playback controls...')
    expect(steps).toContain('Adding playlist display...')
    expect(steps).toContain('Styling the music UI...')
  })

  test('unknown mission yields generic steps', () => {
    const steps = extractStepsFromMission('Build a quantum physics simulator')
    expect(steps).toContain('Planning the architecture...')
    expect(steps).toContain('Designing the UI layout...')
    expect(steps).toContain('Building HTML structure...')
    expect(steps).toContain('Styling with CSS...')
    expect(steps).toContain('Adding JavaScript logic...')
    expect(steps).toContain('Implementing interactivity...')
  })

  test('empty mission yields generic steps', () => {
    const steps = extractStepsFromMission('')
    expect(steps).toContain('Planning the architecture...')
  })

  test('different missions yield different step arrays', () => {
    const game = extractStepsFromMission('Build a snake game')
    const todo = extractStepsFromMission('Build a todo app')
    const calc = extractStepsFromMission('Build a calculator')
    expect(game).not.toEqual(todo)
    expect(game).not.toEqual(calc)
    expect(todo).not.toEqual(calc)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// extractStepsFromMission — structure invariants
// ─────────────────────────────────────────────────────────────────────────────

describe('extractStepsFromMission — structure', () => {
  test('always starts with "Analyzing your request..."', () => {
    const missions = ['snake', 'todo', 'calculator', 'weather', 'music', 'unknown', '']
    for (const m of missions) {
      expect(extractStepsFromMission(m)[0]).toBe('Analyzing your request...')
    }
  })

  test('always ends with "Finalizing the code..."', () => {
    const missions = ['snake', 'todo', 'calculator', 'weather', 'music', 'unknown', '']
    for (const m of missions) {
      const steps = extractStepsFromMission(m)
      expect(steps[steps.length - 1]).toBe('Finalizing the code...')
    }
  })

  test('always returns at least 3 steps', () => {
    const missions = ['', 'snake', 'unknown']
    for (const m of missions) {
      expect(extractStepsFromMission(m).length).toBeGreaterThanOrEqual(3)
    }
  })

  test('returns string array', () => {
    const steps = extractStepsFromMission('Build a snake game')
    expect(Array.isArray(steps)).toBe(true)
    for (const s of steps) {
      expect(typeof s).toBe('string')
    }
  })

  test('case-insensitive mission matching', () => {
    const lower = extractStepsFromMission('build a snake game')
    const upper = extractStepsFromMission('BUILD A SNAKE GAME')
    expect(lower).toEqual(upper)
  })

  test('mission with extra prose around keyword still matches', () => {
    const steps = extractStepsFromMission('I would like to build a snake game please')
    expect(steps).toContain('Planning game mechanics...')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// extractStepsFromPlan — with valid plan
// ─────────────────────────────────────────────────────────────────────────────

describe('extractStepsFromPlan — with plan', () => {
  test('uses plan title when present', () => {
    const plan = { title: 'Snake Game', features: ['game board'], keyFunctions: [] }
    const steps = extractStepsFromPlan(plan, 'Build a snake game')
    expect(steps).toContain('Architect decided: Snake Game')
  })

  test('falls back to "Planning the architecture..." when no title', () => {
    const plan = { features: ['game board'] }
    const steps = extractStepsFromPlan(plan, 'Build a snake game')
    expect(steps).toContain('Planning the architecture...')
    expect(steps.some(s => s.startsWith('Architect decided:'))).toBe(false)
  })

  test('includes layout step when plan has layout', () => {
    const plan = { title: 'App', layout: 'centered column' }
    const steps = extractStepsFromPlan(plan, 'Build an app')
    expect(steps.some(s => s.includes('Layout:') && s.includes('centered column'))).toBe(true)
  })

  test('truncates long layout to 60 chars with ellipsis', () => {
    const longLayout = 'x'.repeat(80)
    const plan = { title: 'App', layout: longLayout }
    const steps = extractStepsFromPlan(plan, 'Build an app')
    const layoutStep = steps.find(s => s.startsWith('Layout:'))
    expect(layoutStep).toBeTruthy()
    expect(layoutStep!).toContain('...')
    // 60 chars + '...' + 'Layout: ' prefix
    expect(layoutStep!.length).toBeLessThan(80)
  })

  test('does NOT add ellipsis when layout <= 60 chars', () => {
    const plan = { title: 'App', layout: 'short layout' }
    const steps = extractStepsFromPlan(plan, 'Build an app')
    const layoutStep = steps.find(s => s.startsWith('Layout:'))
    expect(layoutStep).toBeTruthy()
    expect(layoutStep!).not.toContain('...')
  })

  test('uses plan features (camelCase) when present', () => {
    const plan = {
      title: 'App',
      features: ['auth module', 'dashboard', 'reports'],
    }
    const steps = extractStepsFromPlan(plan, 'Build an app')
    expect(steps).toContain('Building: auth module...')
    expect(steps).toContain('Building: dashboard...')
    expect(steps).toContain('Building: reports...')
  })

  test('uses plan key_features (snake_case) when features is absent', () => {
    const plan = {
      title: 'App',
      key_features: ['snake_feature_1', 'snake_feature_2'],
    }
    const steps = extractStepsFromPlan(plan, 'Build an app')
    expect(steps).toContain('Building: snake_feature_1...')
    expect(steps).toContain('Building: snake_feature_2...')
  })

  test('limits plan features to 5 (slices)', () => {
    const plan = {
      title: 'App',
      features: ['f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7'],
    }
    const steps = extractStepsFromPlan(plan, 'Build an app')
    const buildingSteps = steps.filter(s => s.startsWith('Building:'))
    expect(buildingSteps.length).toBe(5)
  })

  test('handles non-string feature entries (calls String())', () => {
    // BuildPlan.features is typed as string[]; we intentionally pass mixed types
    // to verify the runtime type guard `typeof f === 'string' ? f : String(f)`.
    const plan = {
      title: 'App',
      features: ['real feature', 42, { toString: () => 'obj-feature' }, null] as unknown as string[],
    }
    const steps = extractStepsFromPlan(plan, 'Build an app')
    // The first entry is a string; the others are coerced via String()
    expect(steps).toContain('Building: real feature...')
    // Numeric/null entries: String(42)='42', String(null)='null'
    expect(steps.some(s => s.includes('42'))).toBe(true)
  })

  test('uses keyFunctions (camelCase) when present', () => {
    const plan = {
      title: 'App',
      features: ['feat'],
      keyFunctions: ['init', 'render'],
    }
    const steps = extractStepsFromPlan(plan, 'Build an app')
    expect(steps).toContain('Implementing: init...')
    expect(steps).toContain('Implementing: render...')
  })

  test('key_functions (snake_case) is NOT supported for key functions (only key_features)', () => {
    // Source code only checks `keyFunctions` (camelCase) — key_functions is ignored.
    // (key_features IS supported for features, but key_functions is NOT for functions.)
    const plan = {
      title: 'App',
      features: ['feat'],
      key_functions: ['snake_fn_1'],
    }
    const steps = extractStepsFromPlan(plan, 'Build an app')
    expect(steps).not.toContain('Implementing: snake_fn_1...')
  })

  test('limits keyFunctions to 3 (slices)', () => {
    const plan = {
      title: 'App',
      features: ['feat'],
      keyFunctions: ['f1', 'f2', 'f3', 'f4', 'f5'],
    }
    const steps = extractStepsFromPlan(plan, 'Build an app')
    const implSteps = steps.filter(s => s.startsWith('Implementing:'))
    expect(implSteps.length).toBe(3)
  })

  test('always ends with "Finalizing the code..."', () => {
    const plan = { title: 'App', features: ['f1'] }
    const steps = extractStepsFromPlan(plan, 'Build an app')
    expect(steps[steps.length - 1]).toBe('Finalizing the code...')
  })

  test('always starts with "Analyzing your request..."', () => {
    const plan = { title: 'App', features: ['f1'] }
    const steps = extractStepsFromPlan(plan, 'Build an app')
    expect(steps[0]).toBe('Analyzing your request...')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// extractStepsFromPlan — fallback paths
// ─────────────────────────────────────────────────────────────────────────────

describe('extractStepsFromPlan — fallbacks', () => {
  test('null plan → falls back to mission steps', () => {
    const steps = extractStepsFromPlan(null, 'Build a snake game')
    expect(steps).toContain('Planning game mechanics...')
    expect(steps).toContain('Finalizing the code...')
  })

  test('undefined plan → falls back to mission steps', () => {
    const steps = extractStepsFromPlan(undefined, 'Build a calculator')
    expect(steps).toContain('Planning the calculator logic...')
  })

  test('non-object plan (string) → falls back to mission steps', () => {
    const steps = extractStepsFromPlan('not an object', 'Build a todo app')
    expect(steps).toContain('Planning the task structure...')
  })

  test('plan with no features and no key_features → falls back to mission steps', () => {
    const plan = { title: 'Test' }
    const steps = extractStepsFromPlan(plan, 'Build a calculator')
    expect(steps).toContain('Architect decided: Test')
    // Falls back to mission-based feature steps (from index 2 to length-1)
    expect(steps).toContain('Building the display & buttons...')
  })

  test('plan with empty features array → falls back to mission steps (starting at index 2)', () => {
    const plan = { title: 'Test', features: [] }
    const steps = extractStepsFromPlan(plan, 'Build a snake game')
    // The fallback loop starts at index 2 of missionSteps, so 'Planning game mechanics...'
    // (index 1) is NOT included. 'Designing the game board...' (index 2) IS included.
    expect(steps).toContain('Designing the game board...')
    expect(steps).toContain('Building the game loop...')
  })

  test('plan with non-array features → falls back to mission steps', () => {
    const plan = { title: 'Test', features: 'not-an-array' }
    const steps = extractStepsFromPlan(plan, 'Build a calculator')
    expect(steps).toContain('Building the display & buttons...')
  })

  test('plan with no keyFunctions → no Implementing steps', () => {
    const plan = { title: 'Test', features: ['feat'] }
    const steps = extractStepsFromPlan(plan, 'Build an app')
    expect(steps.some(s => s.startsWith('Implementing:'))).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// getPlanSummary
// ─────────────────────────────────────────────────────────────────────────────

describe('getPlanSummary', () => {
  test('returns null for null', () => {
    expect(getPlanSummary(null)).toBeNull()
  })

  test('returns null for undefined', () => {
    expect(getPlanSummary(undefined)).toBeNull()
  })

  test('returns null for non-object (string)', () => {
    expect(getPlanSummary('not an object')).toBeNull()
  })

  test('returns null for non-object (number)', () => {
    expect(getPlanSummary(42)).toBeNull()
  })

  test('returns null for empty object', () => {
    expect(getPlanSummary({})).toBeNull()
  })

  test('returns summary with title only', () => {
    expect(getPlanSummary({ title: 'Snake Game' })).toBe('Snake Game')
  })

  test('returns summary with type only', () => {
    expect(getPlanSummary({ type: 'game' })).toBe('game')
  })

  test('returns summary with features only', () => {
    expect(getPlanSummary({ features: ['a'] })).toBe('1 features')
    expect(getPlanSummary({ features: ['a', 'b', 'c'] })).toBe('3 features')
  })

  test('returns summary with title + type + features', () => {
    const plan = { title: 'Snake Game', type: 'game', features: ['a', 'b', 'c'] }
    expect(getPlanSummary(plan)).toBe('Snake Game · game · 3 features')
  })

  test('returns summary with title + type (no features)', () => {
    expect(getPlanSummary({ title: 'App', type: 'tool' })).toBe('App · tool')
  })

  test('returns summary with title + features (no type)', () => {
    expect(getPlanSummary({ title: 'App', features: ['a', 'b'] })).toBe('App · 2 features')
  })

  test('non-array features field is ignored', () => {
    // features is not an array → not added to parts
    expect(getPlanSummary({ title: 'App', features: 'not-an-array' })).toBe('App')
  })

  test('empty features array is included as "0 features"', () => {
    expect(getPlanSummary({ title: 'App', features: [] })).toBe('App · 0 features')
  })

  test('uses dot-space separator (" · ")', () => {
    const plan = { title: 'X', type: 'Y', features: ['a'] }
    expect(getPlanSummary(plan)).toBe('X · Y · 1 features')
  })

  test('returns a string (not null) when at least one field is present', () => {
    const result = getPlanSummary({ title: 'X' })
    expect(typeof result).toBe('string')
  })

  test('handles long title', () => {
    const longTitle = 'A'.repeat(100)
    expect(getPlanSummary({ title: longTitle })).toBe(longTitle)
  })

  test('preserves special characters in title', () => {
    expect(getPlanSummary({ title: 'App: The "Best" One!' })).toBe('App: The "Best" One!')
  })
})
