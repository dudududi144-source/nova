// Comprehensive tests for src/lib/mission-analysis.ts
// Covers analyzeMission: complexity detection, vagueness detection,
// feature counting, over-scope detection, time/token estimation, model
// recommendation, suggestions, and edge cases — 40+ tests across 30+ missions.
import { describe, expect, test } from 'bun:test'
import { analyzeMission } from '../src/lib/mission-analysis'

// ─────────────────────────────────────────────────────────────────────────────
// Complexity detection — simple
// ─────────────────────────────────────────────────────────────────────────────

describe('analyzeMission — complexity: simple', () => {
  test('"Build a counter app" → simple', () => {
    expect(analyzeMission('Build a counter app').complexity).toBe('simple')
  })

  test('"Build a clock" → simple', () => {
    expect(analyzeMission('Build a clock').complexity).toBe('simple')
  })

  test('"Build a list of items" → simple', () => {
    expect(analyzeMission('Build a list of items').complexity).toBe('simple')
  })

  test('"Build a note-taking app" → simple', () => {
    expect(analyzeMission('Build a note-taking app').complexity).toBe('simple')
  })

  test('"Build a counter" → simple', () => {
    expect(analyzeMission('Build a counter').complexity).toBe('simple')
  })

  test('"Build a badge generator" → medium ("generator" is a medium keyword)', () => {
    // 'badge' is simple, but 'generator' is medium — medium wins
    expect(analyzeMission('Build a badge generator').complexity).toBe('medium')
  })

  test('"Build a counter" provides a complexityReason', () => {
    const r = analyzeMission('Build a counter')
    expect(r.complexityReason).toBeTruthy()
    expect(r.complexityReason.length).toBeGreaterThan(0)
  })

  test('"Build a counter" complexityReason mentions simple', () => {
    const r = analyzeMission('Build a counter')
    expect(r.complexityReason.toLowerCase()).toContain('simple')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Complexity detection — medium
// ─────────────────────────────────────────────────────────────────────────────

describe('analyzeMission — complexity: medium', () => {
  test('"Build a todo app with add, delete, and filter" → medium (featureCount >= 3)', () => {
    expect(analyzeMission('Build a todo app with add, delete, and filter').complexity).toBe('medium')
  })

  test('"Build a snake game" → medium (game keyword)', () => {
    expect(analyzeMission('Build a snake game').complexity).toBe('medium')
  })

  test('"Build a dashboard" → medium (dashboard keyword)', () => {
    expect(analyzeMission('Build a dashboard').complexity).toBe('medium')
  })

  test('"Build an editor" → medium (editor keyword)', () => {
    expect(analyzeMission('Build an editor').complexity).toBe('medium')
  })

  test('"Build a calculator" → medium (calculator keyword)', () => {
    expect(analyzeMission('Build a calculator').complexity).toBe('medium')
  })

  test('"Build a tracker" → medium (tracker keyword)', () => {
    expect(analyzeMission('Build a tracker').complexity).toBe('medium')
  })

  test('"Build a manager" → medium (manager keyword)', () => {
    expect(analyzeMission('Build a manager').complexity).toBe('medium')
  })

  test('"Build a planner" → medium (planner keyword)', () => {
    expect(analyzeMission('Build a planner').complexity).toBe('medium')
  })

  test('complexityReason mentions the medium keyword when one is hit', () => {
    const r = analyzeMission('Build a calculator')
    expect(r.complexityReason.toLowerCase()).toContain('calculator')
  })

  test('complexityReason mentions feature count when no keyword is hit', () => {
    // 3 features, no keywords → medium via featureCount
    // Note: 'paint' contains 'ai' substring which would trigger complex keyword,
    // so we use neutral words that don't contain any keyword substrings.
    const r = analyzeMission('build, draw, sketch')
    expect(r.featureCount).toBeGreaterThanOrEqual(3)
    expect(r.complexityReason).toContain('Multiple features')
  })

  test('long prompt (> 20 words) without keywords → medium', () => {
    const long = 'Build something that has lots of words but no specific keywords anywhere in the entire sentence structure that we are writing right now today'
    expect(analyzeMission(long).complexity).toBe('medium')
  })

  test('long prompt complexityReason mentions word count', () => {
    const long = 'Build something that has lots of words but no specific keywords anywhere in the entire sentence structure that we are writing right now today'
    const r = analyzeMission(long)
    expect(r.complexityReason).toContain('words')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Complexity detection — complex
// ─────────────────────────────────────────────────────────────────────────────

describe('analyzeMission — complexity: complex', () => {
  test('2+ complex keywords → complex (real-time + streaming)', () => {
    expect(analyzeMission('Build a real-time streaming app').complexity).toBe('complex')
  })

  test('2+ complex keywords → complex (websocket + 3d)', () => {
    expect(analyzeMission('Build a websocket 3d viewer').complexity).toBe('complex')
  })

  test('2+ complex keywords → complex (multiplayer + canvas)', () => {
    expect(analyzeMission('Build a multiplayer canvas game').complexity).toBe('complex')
  })

  test('2+ complex keywords → complex (ai + ml)', () => {
    expect(analyzeMission('Build an ai ml tool').complexity).toBe('complex')
  })

  test('1 complex keyword + 3+ features → complex', () => {
    // 'physics' (complex) + features: build a physics app, gravity, collision, momentum
    const r = analyzeMission('Build a physics app with gravity, collision, and momentum')
    expect(r.complexity).toBe('complex')
  })

  test('complex complexityReason lists the complex keywords', () => {
    const r = analyzeMission('Build a real-time streaming app')
    expect(r.complexityReason.toLowerCase()).toContain('complex')
    // Reason should mention at least one of the detected keywords
    const lower = r.complexityReason.toLowerCase()
    expect(lower.includes('real-time') || lower.includes('streaming')).toBe(true)
  })

  test('complex mission estimates more time than medium', () => {
    const simple = analyzeMission('Build a counter')
    const medium = analyzeMission('Build a calculator')
    const complex = analyzeMission('Build a real-time collaborative 3D dashboard with streaming and physics')
    expect(complex.estimatedTime).toBeGreaterThan(medium.estimatedTime)
    expect(medium.estimatedTime).toBeGreaterThan(simple.estimatedTime)
  })

  test('only 1 complex keyword without 3+ features → medium', () => {
    // 'physics' alone with only 1 feature
    const r = analyzeMission('Build a physics tool')
    expect(r.complexity).toBe('medium')
  })

  test('complex keyword "machine learning" is matched as a single phrase', () => {
    const r = analyzeMission('Build a machine learning app')
    expect(r.complexity).toBe('medium') // 1 complex keyword, 1 feature
  })

  test('complex keyword "neural" alone → medium (1 keyword, 1 feature)', () => {
    const r = analyzeMission('Build a neural visualizer')
    expect(r.complexity).toBe('medium')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Vagueness detection
// ─────────────────────────────────────────────────────────────────────────────

describe('analyzeMission — vagueness: too-vague', () => {
  test('"todo" alone → too-vague', () => {
    expect(analyzeMission('todo').vagueness).toBe('too-vague')
  })

  test('"app" alone → too-vague', () => {
    expect(analyzeMission('app').vagueness).toBe('too-vague')
  })

  test('"game" alone → too-vague', () => {
    expect(analyzeMission('game').vagueness).toBe('too-vague')
  })

  test('"tool" alone → too-vague', () => {
    expect(analyzeMission('tool').vagueness).toBe('too-vague')
  })

  test('"site" alone → too-vague', () => {
    expect(analyzeMission('site').vagueness).toBe('too-vague')
  })

  test('"page" alone → too-vague', () => {
    expect(analyzeMission('page').vagueness).toBe('too-vague')
  })

  test('"dashboard" alone → too-vague', () => {
    expect(analyzeMission('dashboard').vagueness).toBe('too-vague')
  })

  test('"calculator" alone → too-vague', () => {
    expect(analyzeMission('calculator').vagueness).toBe('too-vague')
  })

  test('"an app" → too-vague (VAGUE_PATTERNS[1])', () => {
    expect(analyzeMission('an app').vagueness).toBe('too-vague')
  })

  test('"a game" → too-vague (VAGUE_PATTERNS[1])', () => {
    expect(analyzeMission('a game').vagueness).toBe('too-vague')
  })

  test('"some tool" → too-vague (VAGUE_PATTERNS[1])', () => {
    expect(analyzeMission('some tool').vagueness).toBe('too-vague')
  })

  test('"build a game" → too-vague (VAGUE_PATTERNS[2])', () => {
    expect(analyzeMission('build a game').vagueness).toBe('too-vague')
  })

  test('"make a tool" → too-vague (VAGUE_PATTERNS[2])', () => {
    expect(analyzeMission('make a tool').vagueness).toBe('too-vague')
  })

  test('"create an app" → too-vague (VAGUE_PATTERNS[2])', () => {
    expect(analyzeMission('create an app').vagueness).toBe('too-vague')
  })

  test('too-vague provides a vaguenessReason', () => {
    const r = analyzeMission('todo')
    expect(r.vaguenessReason).toBeTruthy()
    expect(r.vaguenessReason.length).toBeGreaterThan(0)
  })

  test('too-vague triggers 3 specific suggestions', () => {
    const r = analyzeMission('todo')
    expect(r.suggestions.length).toBeGreaterThanOrEqual(3)
    // Should mention features, interactions, and visual style
    const joined = r.suggestions.join(' ').toLowerCase()
    expect(joined).toContain('feature')
    expect(joined).toContain('interaction')
    expect(joined).toContain('style')
  })
})

describe('analyzeMission — vagueness: vague', () => {
  test('short prompt (< 5 words) without vague pattern → vague', () => {
    expect(analyzeMission('todo app').vagueness).toBe('vague')
  })

  test('"Build a thing" → vague (4 words)', () => {
    expect(analyzeMission('Build a thing').vagueness).toBe('vague')
  })

  test('single feature with < 10 words → vague', () => {
    // 1 feature, 7 words → vague
    const r = analyzeMission('Build a custom app for visualizing data')
    // split by ,|and|with|plus|including → ["build a custom app for visualizing data"]
    // filter passes → 1 feature
    expect(r.featureCount).toBe(1)
    expect(r.wordCount).toBeLessThan(10)
    expect(r.vagueness).toBe('vague')
  })

  test('vague provides a vaguenessReason', () => {
    const r = analyzeMission('todo app')
    expect(r.vaguenessReason).toBeTruthy()
    expect(r.vaguenessReason.length).toBeGreaterThan(0)
  })

  test('vague triggers 2 specific suggestions (add features, mention interactions)', () => {
    const r = analyzeMission('todo app')
    expect(r.suggestions.length).toBeGreaterThanOrEqual(2)
    const joined = r.suggestions.join(' ').toLowerCase()
    expect(joined).toContain('feature')
  })
})

describe('analyzeMission — vagueness: none', () => {
  test('detailed prompt with multiple features → none', () => {
    const r = analyzeMission('Build a todo app with add, delete, complete, filter by status, and drag-and-drop reordering')
    expect(r.vagueness).toBe('none')
    expect(r.vaguenessReason).toBe('')
  })

  test('medium prompt with 5+ words and 2+ features → none', () => {
    const r = analyzeMission('Build a calculator with history and memory')
    expect(r.vagueness).toBe('none')
  })

  test('vagueness none and not too complex triggers "looks good" suggestion', () => {
    const r = analyzeMission('Build a calculator with history and memory')
    expect(r.suggestions.some(s => s.toLowerCase().includes('good') || s.toLowerCase().includes('ready'))).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Feature counting
// ─────────────────────────────────────────────────────────────────────────────

describe('analyzeMission — feature counting', () => {
  test('single feature (no separators)', () => {
    expect(analyzeMission('Build a counter app').featureCount).toBe(1)
  })

  test('comma-separated features', () => {
    // 'alpha', 'beta', 'gamma' all pass the length > 2 filter
    const r = analyzeMission('Build an app with alpha, beta, gamma')
    expect(r.featureCount).toBeGreaterThanOrEqual(3)
  })

  test('"and" splits features', () => {
    const r = analyzeMission('Build an app with feature one and feature two')
    expect(r.featureCount).toBeGreaterThanOrEqual(3) // "build an app", "feature one", "feature two"
  })

  test('"with" splits features', () => {
    const r = analyzeMission('paint something with colors')
    // split → ["paint something ", " colors"] → both pass filter → 2
    expect(r.featureCount).toBe(2)
  })

  test('"plus" splits features', () => {
    const r = analyzeMission('chart plus graph')
    expect(r.featureCount).toBe(2)
  })

  test('"including" splits features', () => {
    const r = analyzeMission('build including feature x')
    expect(r.featureCount).toBeGreaterThanOrEqual(2)
  })

  test('stopwords (the, a, an, for, to, by, or, is, app, game) are filtered out', () => {
    // Splitting "app, game, the, a, an, for, to, by, or, is, realfeature" produces 11 items.
    // After filtering stopwords and length > 2, only "realfeature" remains.
    const r = analyzeMission('app, game, the, a, an, for, to, by, or, is, realfeature')
    expect(r.featureCount).toBe(1)
  })

  test('feature count is clamped to max 8', () => {
    // 9 features with names longer than 2 chars each → clamped to 8
    const r = analyzeMission('aaa, bbb, ccc, ddd, eee, fff, ggg, hhh, iii')
    expect(r.featureCount).toBe(8)
  })

  test('feature count minimum is 1 (never 0)', () => {
    expect(analyzeMission('').featureCount).toBeGreaterThanOrEqual(1)
    expect(analyzeMission('   ').featureCount).toBeGreaterThanOrEqual(1)
  })

  test('phrases of length <= 2 are filtered out', () => {
    // "ab" has length 2 → filtered out. "abc" passes.
    const r = analyzeMission('ab, abc')
    // only "abc" passes (and possibly the prefix "ab, abc" if split doesn't separate)
    // Actually split: ["ab", " abc"] → trim → ["ab", "abc"] → filter removes "ab" → ["abc"]
    expect(r.featureCount).toBe(1)
  })

  test('word count is calculated correctly', () => {
    expect(analyzeMission('one two three four').wordCount).toBe(4)
  })

  test('word count of empty string is 0', () => {
    expect(analyzeMission('').wordCount).toBe(0)
  })

  test('word count of whitespace-only is 0', () => {
    expect(analyzeMission('   ').wordCount).toBe(0)
  })

  test('word count handles leading/trailing whitespace', () => {
    expect(analyzeMission('  hello world  ').wordCount).toBe(2)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Over-scope detection
// ─────────────────────────────────────────────────────────────────────────────

describe('analyzeMission — over-scope detection', () => {
  test('"operating system" triggers isTooComplex', () => {
    expect(analyzeMission('Build an operating system').isTooComplex).toBe(true)
  })

  test('"database server" triggers isTooComplex', () => {
    expect(analyzeMission('Build a database server').isTooComplex).toBe(true)
  })

  test('"backend server" triggers isTooComplex', () => {
    expect(analyzeMission('Build a backend server').isTooComplex).toBe(true)
  })

  test('"authentication system" triggers isTooComplex', () => {
    expect(analyzeMission('Build an authentication system').isTooComplex).toBe(true)
  })

  test('"user management" triggers isTooComplex', () => {
    expect(analyzeMission('Build a user management tool').isTooComplex).toBe(true)
  })

  test('"payment processing" triggers isTooComplex', () => {
    expect(analyzeMission('Build a payment processing app').isTooComplex).toBe(true)
  })

  test('"multi-user" triggers isTooComplex', () => {
    expect(analyzeMission('Build a multi-user app').isTooComplex).toBe(true)
  })

  test('"neural network training" triggers isTooComplex', () => {
    expect(analyzeMission('Build a neural network training tool').isTooComplex).toBe(true)
  })

  test('normal app does NOT trigger isTooComplex', () => {
    expect(analyzeMission('Build a todo app with add and delete').isTooComplex).toBe(false)
  })

  test('isTooComplex true → tooComplexReason is non-empty', () => {
    const r = analyzeMission('Build an operating system')
    expect(r.tooComplexReason).toBeTruthy()
    expect(r.tooComplexReason.length).toBeGreaterThan(0)
  })

  test('isTooComplex false → tooComplexReason is empty string', () => {
    const r = analyzeMission('Build a todo app')
    expect(r.isTooComplex).toBe(false)
    expect(r.tooComplexReason).toBe('')
  })

  test('isTooComplex triggers simplify suggestions', () => {
    const r = analyzeMission('Build an operating system with file manager')
    expect(r.suggestions.some(s => s.toLowerCase().includes('simplif') || s.toLowerCase().includes('single-file'))).toBe(true)
    expect(r.suggestions.some(s => s.toLowerCase().includes('in-memory') || s.toLowerCase().includes('backend'))).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Time & token estimation
// ─────────────────────────────────────────────────────────────────────────────

describe('analyzeMission — time & token estimation', () => {
  test('simple mission estimatedTime is around 150', () => {
    const r = analyzeMission('Build a counter')
    expect(r.estimatedTime).toBeGreaterThanOrEqual(135)
    expect(r.estimatedTime).toBeLessThanOrEqual(165)
  })

  test('medium mission estimatedTime is around 240', () => {
    const r = analyzeMission('Build a calculator')
    expect(r.estimatedTime).toBeGreaterThanOrEqual(216)
    expect(r.estimatedTime).toBeLessThanOrEqual(264)
  })

  test('complex mission estimatedTime is around 360', () => {
    const r = analyzeMission('Build a real-time streaming 3d app')
    expect(r.estimatedTime).toBeGreaterThanOrEqual(324)
    expect(r.estimatedTime).toBeLessThanOrEqual(396)
  })

  test('estimatedTokens scales with complexity', () => {
    const simple = analyzeMission('Build a counter')
    const medium = analyzeMission('Build a calculator')
    const complex = analyzeMission('Build a real-time streaming 3d app')
    expect(complex.estimatedTokens).toBeGreaterThan(medium.estimatedTokens)
    expect(medium.estimatedTokens).toBeGreaterThan(simple.estimatedTokens)
  })

  test('simple estimatedTokens is around 5000', () => {
    const r = analyzeMission('Build a counter')
    expect(r.estimatedTokens).toBeGreaterThanOrEqual(4500)
    expect(r.estimatedTokens).toBeLessThanOrEqual(5500)
  })

  test('complex estimatedTokens is around 10000', () => {
    const r = analyzeMission('Build a real-time streaming 3d app')
    expect(r.estimatedTokens).toBeGreaterThanOrEqual(9000)
    expect(r.estimatedTokens).toBeLessThanOrEqual(11000)
  })

  test('more features increases estimatedTime', () => {
    const few = analyzeMission('Build a todo app with add')
    const many = analyzeMission('Build a todo app with add, delete, complete, filter, search, and drag-and-drop')
    expect(many.estimatedTime).toBeGreaterThanOrEqual(few.estimatedTime)
  })

  test('estimatedTime is reasonable (60-900 seconds)', () => {
    const r = analyzeMission('Build a calculator with history')
    expect(r.estimatedTime).toBeGreaterThan(60)
    expect(r.estimatedTime).toBeLessThan(900)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Model recommendation
// ─────────────────────────────────────────────────────────────────────────────

describe('analyzeMission — model recommendation', () => {
  test('simple → qwen', () => {
    expect(analyzeMission('Build a counter').recommendedModel).toBe('qwen')
  })

  test('medium → z-ai', () => {
    expect(analyzeMission('Build a calculator').recommendedModel).toBe('z-ai')
  })

  test('complex → kimi', () => {
    expect(analyzeMission('Build a real-time streaming 3d app').recommendedModel).toBe('kimi')
  })

  test('simple modelReason mentions Qwen', () => {
    const r = analyzeMission('Build a counter')
    expect(r.modelReason.toLowerCase()).toContain('qwen')
  })

  test('medium modelReason mentions Z.AI', () => {
    const r = analyzeMission('Build a calculator')
    expect(r.modelReason.toLowerCase()).toContain('z.ai')
  })

  test('complex modelReason mentions Kimi', () => {
    const r = analyzeMission('Build a real-time streaming 3d app')
    expect(r.modelReason.toLowerCase()).toContain('kimi')
  })

  test('recommendedModel is always one of z-ai, qwen, kimi', () => {
    const missions = ['todo', 'app', 'Build a counter', 'Build a calculator', 'Build a real-time 3d streaming app', '']
    for (const m of missions) {
      const r = analyzeMission(m)
      expect(['z-ai', 'qwen', 'kimi']).toContain(r.recommendedModel)
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Suggestions
// ─────────────────────────────────────────────────────────────────────────────

describe('analyzeMission — suggestions', () => {
  test('too-vague → 3+ suggestions', () => {
    const r = analyzeMission('todo')
    expect(r.suggestions.length).toBeGreaterThanOrEqual(3)
  })

  test('too many features (8) → "Many features" suggestion', () => {
    const r = analyzeMission('Build a dashboard with charts, filters, search, export, settings, themes, notifications, and analytics')
    expect(r.suggestions.some(s => s.includes('Many features') || s.includes('splitting'))).toBe(true)
  })

  test('over-scoped → simplify suggestion', () => {
    const r = analyzeMission('Build an operating system')
    expect(r.suggestions.some(s => s.toLowerCase().includes('simplif') || s.toLowerCase().includes('single-file'))).toBe(true)
  })

  test('good prompt → "ready" suggestion', () => {
    const r = analyzeMission('Build a todo app with add, delete, complete, filter by status, and drag-and-drop reordering')
    expect(r.suggestions.some(s => s.toLowerCase().includes('good') || s.toLowerCase().includes('ready'))).toBe(true)
  })

  test('suggestions is always an array', () => {
    expect(Array.isArray(analyzeMission('todo').suggestions)).toBe(true)
    expect(Array.isArray(analyzeMission('').suggestions)).toBe(true)
    expect(Array.isArray(analyzeMission('Build a complex real-time 3d streaming multiplayer collaborative app').suggestions)).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Edge cases & invariants
// ─────────────────────────────────────────────────────────────────────────────

describe('analyzeMission — edge cases', () => {
  test('empty string', () => {
    const r = analyzeMission('')
    expect(r.wordCount).toBe(0)
    expect(r.featureCount).toBeGreaterThanOrEqual(1)
    expect(r.complexity).toBeDefined()
    expect(['simple', 'medium', 'complex']).toContain(r.complexity)
  })

  test('whitespace-only string', () => {
    const r = analyzeMission('   \n\t  ')
    expect(r.wordCount).toBe(0)
    expect(r.complexity).toBeDefined()
  })

  test('very long prompt', () => {
    const long = 'Build a ' + 'feature '.repeat(50) + 'app'
    const r = analyzeMission(long)
    expect(r.wordCount).toBeGreaterThan(50)
  })

  test('case-insensitive complexity', () => {
    const lower = analyzeMission('build a todo app')
    const upper = analyzeMission('BUILD A TODO APP')
    expect(lower.complexity).toBe(upper.complexity)
  })

  test('case-insensitive vagueness', () => {
    const lower = analyzeMission('todo')
    const upper = analyzeMission('TODO')
    expect(lower.vagueness).toBe(upper.vagueness)
  })

  test('case-insensitive feature count', () => {
    const lower = analyzeMission('build a todo app with add, delete, and filter')
    const upper = analyzeMission('BUILD A TODO APP WITH ADD, DELETE, AND FILTER')
    expect(lower.featureCount).toBe(upper.featureCount)
  })

  test('unicode in mission does not crash', () => {
    const r = analyzeMission('Build a 🎮 game with 日本語 support')
    expect(r.wordCount).toBeGreaterThan(0)
    expect(r.complexity).toBeDefined()
  })

  test('returns all expected fields', () => {
    const r = analyzeMission('Build a calculator')
    expect(r).toHaveProperty('complexity')
    expect(r).toHaveProperty('complexityReason')
    expect(r).toHaveProperty('vagueness')
    expect(r).toHaveProperty('vaguenessReason')
    expect(r).toHaveProperty('isTooComplex')
    expect(r).toHaveProperty('tooComplexReason')
    expect(r).toHaveProperty('estimatedTime')
    expect(r).toHaveProperty('estimatedTokens')
    expect(r).toHaveProperty('recommendedModel')
    expect(r).toHaveProperty('modelReason')
    expect(r).toHaveProperty('suggestions')
    expect(r).toHaveProperty('featureCount')
    expect(r).toHaveProperty('wordCount')
  })

  test('complexity is always one of simple/medium/complex', () => {
    const missions = ['', 'todo', 'Build a counter', 'Build a calculator', 'Build a real-time streaming 3d app', 'random text', 'a, b, c, d, e, f, g, h, i']
    for (const m of missions) {
      expect(['simple', 'medium', 'complex']).toContain(analyzeMission(m).complexity)
    }
  })

  test('vagueness is always one of none/vague/too-vague', () => {
    const missions = ['', 'todo', 'Build a counter', 'Build a calculator', 'app', 'an app', 'a, b, c']
    for (const m of missions) {
      expect(['none', 'vague', 'too-vague']).toContain(analyzeMission(m).vagueness)
    }
  })

  test('pure function — same input always produces same output', () => {
    const mission = 'Build a todo app with add and delete'
    const r1 = analyzeMission(mission)
    const r2 = analyzeMission(mission)
    expect(r1).toEqual(r2)
  })

  test('returns an object (not null/undefined)', () => {
    expect(analyzeMission('')).toBeTruthy()
    expect(typeof analyzeMission('todo')).toBe('object')
  })
})
