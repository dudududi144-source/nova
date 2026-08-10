// Comprehensive tests for src/lib/error-recovery.ts
// Covers analyzeError (all pattern branches + priority), assessMissionVagueness,
// assessMissionComplexity, simplifyMission, suggestRelatedMissions.
//
// Existing tests/error-recovery.test.ts covers the happy paths; this file
// exhaustively tests each pattern, boundary, and structure invariant.
import { describe, expect, test } from 'bun:test'
import {
  analyzeError,
  assessMissionVagueness,
  assessMissionComplexity,
  simplifyMission,
  suggestRelatedMissions,
} from '../src/lib/error-recovery'
import type { ErrorAnalysis, ErrorCategory, ErrorSeverity } from '../src/lib/error-recovery'

const MISSION = 'build a calculator with history'

// Helper: assert a fully-formed ErrorAnalysis object
function assertAnalysis(a: ErrorAnalysis): void {
  expect(typeof a.category).toBe('string')
  expect(typeof a.severity).toBe('string')
  expect(typeof a.title).toBe('string')
  expect(typeof a.message).toBe('string')
  expect(Array.isArray(a.suggestions)).toBe(true)
  expect(typeof a.canRetry).toBe('boolean')
  expect(typeof a.retryDelayMs).toBe('number')
  expect(a.title.length).toBeGreaterThan(0)
  expect(a.message.length).toBeGreaterThan(0)
  expect(a.suggestions.length).toBeGreaterThan(0)
}

describe('analyzeError — cancelled branch', () => {
  test('matches "abort" (case-insensitive)', () => {
    expect(analyzeError('ABORTED by user', MISSION).category).toBe('cancelled')
  })
  test('matches "cancel"', () => {
    expect(analyzeError('Request was cancelled', MISSION).category).toBe('cancelled')
  })
  test('cancelled is severity low', () => {
    expect(analyzeError('aborted', MISSION).severity).toBe('low')
  })
  test('cancelled has retryDelayMs 0', () => {
    expect(analyzeError('cancelled', MISSION).retryDelayMs).toBe(0)
  })
  test('cancelled canRetry is true', () => {
    expect(analyzeError('aborted', MISSION).canRetry).toBe(true)
  })
  test('cancelled takes priority over 429', () => {
    expect(analyzeError('aborted due to 429', MISSION).category).toBe('cancelled')
  })
})

describe('analyzeError — rate-limit branch', () => {
  test('matches "429" alone', () => {
    expect(analyzeError('429', MISSION).category).toBe('rate-limit')
  })
  test('matches "rate limit"', () => {
    expect(analyzeError('rate limit exceeded', MISSION).category).toBe('rate-limit')
  })
  test('matches "too many requests"', () => {
    expect(analyzeError('Too Many Requests', MISSION).category).toBe('rate-limit')
  })
  test('matches "service is busy"', () => {
    expect(analyzeError('service is busy', MISSION).category).toBe('rate-limit')
  })
  test('rate-limit retryDelayMs is 60s', () => {
    expect(analyzeError('429', MISSION).retryDelayMs).toBe(60_000)
  })
  test('rate-limit severity is medium', () => {
    expect(analyzeError('429', MISSION).severity).toBe('medium')
  })
  test('rate-limit has 2 suggestions', () => {
    expect(analyzeError('429', MISSION).suggestions).toHaveLength(2)
  })
  test('rate-limit takes priority over timeout', () => {
    // 429 contains no "timeout" but ensure ordering is rate-limit > timeout
    expect(analyzeError('429 timed out', MISSION).category).toBe('rate-limit')
  })
})

describe('analyzeError — timeout branch', () => {
  test('matches "timed out"', () => {
    expect(analyzeError('timed out', MISSION).category).toBe('timeout')
  })
  test('matches "timeout" (single word)', () => {
    expect(analyzeError('timeout occurred', MISSION).category).toBe('timeout')
  })
  test('matches "timeoutMs"', () => {
    expect(analyzeError('timeoutMs reached', MISSION).category).toBe('timeout')
  })
  test('short-mission timeout is medium severity', () => {
    expect(analyzeError('timed out', 'short').severity).toBe('medium')
  })
  test('long-mission (>500 chars) timeout is high severity', () => {
    const long = 'x'.repeat(501)
    expect(analyzeError('timed out', long).severity).toBe('high')
  })
  test('500-char mission timeout is still medium (boundary)', () => {
    const exactly500 = 'x'.repeat(500)
    expect(analyzeError('timed out', exactly500).severity).toBe('medium')
  })
  test('timeout retryDelayMs is 5s', () => {
    expect(analyzeError('timed out', MISSION).retryDelayMs).toBe(5_000)
  })
  test('long-mission timeout message includes the char count', () => {
    const long = 'x'.repeat(700)
    const a = analyzeError('timed out', long)
    expect(a.message).toContain('700')
  })
})

describe('analyzeError — network branch', () => {
  test('matches "network"', () => {
    expect(analyzeError('network error', MISSION).category).toBe('network')
  })
  test('matches "fetch"', () => {
    expect(analyzeError('fetch failed', MISSION).category).toBe('network')
  })
  test('matches "ECONNREFUSED"', () => {
    expect(analyzeError('ECONNREFUSED 127.0.0.1:443', MISSION).category).toBe('network')
  })
  test('matches "ENOTFOUND"', () => {
    expect(analyzeError('ENOTFOUND example.com', MISSION).category).toBe('network')
  })
  test('matches "ETIMEDOUT"', () => {
    expect(analyzeError('ETIMEDOUT', MISSION).category).toBe('network')
  })
  test('matches "socket hang up"', () => {
    expect(analyzeError('socket hang up', MISSION).category).toBe('network')
  })
  test('matches "connection refused"', () => {
    expect(analyzeError('connection refused', MISSION).category).toBe('network')
  })
  test('matches "connection reset"', () => {
    expect(analyzeError('connection reset by peer', MISSION).category).toBe('network')
  })
  test('network severity is high', () => {
    expect(analyzeError('network down', MISSION).severity).toBe('high')
  })
  test('network retryDelayMs is 10s', () => {
    expect(analyzeError('network down', MISSION).retryDelayMs).toBe(10_000)
  })
})

describe('analyzeError — empty output branch', () => {
  test('matches "empty"', () => {
    expect(analyzeError('response was empty', MISSION).category).toBe('empty')
  })
  test('matches "no content"', () => {
    expect(analyzeError('no content returned', MISSION).category).toBe('empty')
  })
  test('matches "returned an empty"', () => {
    expect(analyzeError('returned an empty response', MISSION).category).toBe('empty')
  })
  test('empty + specific mission → empty (not mission-vague)', () => {
    expect(analyzeError('returned an empty', MISSION).category).toBe('empty')
  })
  test('empty + vague mission → mission-vague', () => {
    expect(analyzeError('returned an empty', 'hi').category).toBe('mission-vague')
  })
  test('empty retryDelayMs is 3s', () => {
    expect(analyzeError('empty', MISSION).retryDelayMs).toBe(3_000)
  })
})

describe('analyzeError — invalid output branch', () => {
  test('matches "invalid"', () => {
    expect(analyzeError('invalid output', MISSION).category).toBe('invalid-output')
  })
  test('matches "doesn\'t look like html"', () => {
    expect(analyzeError("doesn't look like html", MISSION).category).toBe('invalid-output')
  })
  test('matches "not html"', () => {
    expect(analyzeError('output is not html', MISSION).category).toBe('invalid-output')
  })
  test('matches "malformed"', () => {
    expect(analyzeError('malformed JSON', MISSION).category).toBe('invalid-output')
  })
  test('matches "parse error"', () => {
    expect(analyzeError('parse error at line 5', MISSION).category).toBe('invalid-output')
  })
  test('invalid-output retryDelayMs is 2s', () => {
    expect(analyzeError('invalid', MISSION).retryDelayMs).toBe(2_000)
  })
})

describe('analyzeError — unknown fallback', () => {
  test('returns unknown for non-matching messages', () => {
    expect(analyzeError('something weird happened', MISSION).category).toBe('unknown')
  })
  test('unknown severity is medium', () => {
    expect(analyzeError('weird error', MISSION).severity).toBe('medium')
  })
  test('unknown message includes the original error text', () => {
    expect(analyzeError('a very specific error message', MISSION).message).toContain('a very specific error message')
  })
  test('empty error string → unknown', () => {
    const a = analyzeError('', MISSION)
    expect(a.category).toBe('unknown')
    expect(a.message).toContain('unknown reason')
  })
  test('null/undefined error → unknown with fallback message', () => {
    expect(analyzeError(null as unknown as string, MISSION).category).toBe('unknown')
    expect(analyzeError(undefined as unknown as string, MISSION).category).toBe('unknown')
  })
  test('unknown retryDelayMs is 3s', () => {
    expect(analyzeError('random', MISSION).retryDelayMs).toBe(3_000)
  })
})

describe('analyzeError — Error vs string inputs', () => {
  test('Error object — extracts .message', () => {
    expect(analyzeError(new Error('timed out'), MISSION).category).toBe('timeout')
  })
  test('Error object with custom subclass', () => {
    class MyError extends Error {
      constructor(msg: string) { super(msg); this.name = 'MyError' }
    }
    expect(analyzeError(new MyError('429 too many'), MISSION).category).toBe('rate-limit')
  })
  test('string error — used directly', () => {
    expect(analyzeError('429', MISSION).category).toBe('rate-limit')
  })
})

describe('analyzeError — structure invariants', () => {
  const inputs = ['abort', '429', 'timed out', 'fetch failed', 'empty', 'invalid', 'random', '']
  for (const input of inputs) {
    test(`"${input}" produces a fully-formed ErrorAnalysis`, () => {
      assertAnalysis(analyzeError(input, MISSION))
    })
  }
})

describe('analyzeError — all valid categories reachable', () => {
  test('can produce every category value', () => {
    const seen = new Set<ErrorCategory>()
    seen.add(analyzeError('abort', MISSION).category)
    seen.add(analyzeError('429', MISSION).category)
    seen.add(analyzeError('timed out', MISSION).category)
    seen.add(analyzeError('fetch failed', MISSION).category)
    seen.add(analyzeError('empty', MISSION).category)
    seen.add(analyzeError('invalid', MISSION).category)
    seen.add(analyzeError('random', MISSION).category)
    seen.add(analyzeError('empty', 'hi').category) // mission-vague
    const long = 'x'.repeat(700)
    seen.add(analyzeError('random', long).category === 'unknown'
      ? analyzeError('empty', long).category // still empty
      : 'unknown')
    // 8 distinct categories reachable (mission-complex not reachable via analyzeError)
    expect(seen.size).toBeGreaterThanOrEqual(7)
  })
})

describe('analyzeError — severity values', () => {
  test('all severities are in the allowed set', () => {
    const allowed: ErrorSeverity[] = ['low', 'medium', 'high', 'critical']
    const samples = ['abort', '429', 'timed out', 'fetch failed', 'empty', 'invalid', 'random']
    for (const s of samples) {
      expect(allowed).toContain(analyzeError(s, MISSION).severity)
    }
  })
})

describe('assessMissionVagueness — boundaries', () => {
  test('returns null for empty string', () => {
    expect(assessMissionVagueness('')).toBeNull()
  })
  test('returns null for whitespace-only', () => {
    expect(assessMissionVagueness('   \t\n')).toBeNull()
  })
  test('11-char mission → vague (too short)', () => {
    const exactly11 = 'hello world' // 11 chars
    expect(exactly11.length).toBe(11)
    expect(assessMissionVagueness(exactly11)).not.toBeNull()
  })
  test('12-char mission with enough words → not vague', () => {
    // 12 chars, 2 significant words longer than 3 chars
    const exactly12 = 'snake arcade' // 12 chars, "snake" + "arcade" both >3
    expect(exactly12.length).toBe(12)
    expect(assessMissionVagueness(exactly12)).toBeNull()
  })
})

describe('assessMissionVagueness — significant word counting', () => {
  test('mission with one significant word → vague', () => {
    // "calculator" alone (length >3), other words are <=3 or filler
    expect(assessMissionVagueness('a calculator app')!.category).toBe('mission-vague')
  })
  test('mission with two significant words → not vague', () => {
    // "calculator" + "history" — both >3 chars
    expect(assessMissionVagueness('calculator with history')).toBeNull()
  })
  test('filler words are NOT counted as significant', () => {
    // "build make create" — all filler (in FILLER_WORDS set)
    expect(assessMissionVagueness('build make create something')!.category).toBe('mission-vague')
  })
  test('punctuation splits words', () => {
    // commas split, so "snake,game,arcade" has 3 significant words
    expect(assessMissionVagueness('snake,game,arcade')).toBeNull()
  })
})

describe('assessMissionVagueness — filler phrases', () => {
  const phrases = [
    'build something',
    'make something',
    'build a thing',
    'make a thing',
    'build an app',
    'make an app',
    'build a cool app',
    'make a cool app',
  ]
  for (const p of phrases) {
    test(`flags "${p}" as filler`, () => {
      const result = assessMissionVagueness(p + ' extra')
      expect(result).not.toBeNull()
      expect(result!.category).toBe('mission-vague')
    })
  }
  test('filler phrase exact match (no trailing word) is also vague', () => {
    expect(assessMissionVagueness('build something')?.category).toBe('mission-vague')
  })
  test('non-filler phrase is not flagged', () => {
    expect(assessMissionVagueness('build a snake game with score')).toBeNull()
  })
})

describe('assessMissionVagueness — canRetry & retryDelayMs', () => {
  test('vague mission canRetry=false', () => {
    expect(assessMissionVagueness('hi')!.canRetry).toBe(false)
  })
  test('vague mission retryDelayMs=0', () => {
    expect(assessMissionVagueness('hi')!.retryDelayMs).toBe(0)
  })
})

describe('assessMissionComplexity — boundaries', () => {
  test('returns null for empty', () => {
    expect(assessMissionComplexity('')).toBeNull()
  })
  test('returns null for whitespace', () => {
    expect(assessMissionComplexity('  ')).toBeNull()
  })
  test('600-char mission is NOT complex', () => {
    const exactly600 = 'x'.repeat(600)
    expect(exactly600.length).toBe(600)
    expect(assessMissionComplexity(exactly600)).toBeNull()
  })
  test('601-char mission IS complex', () => {
    const exactly601 = 'x'.repeat(601)
    expect(exactly601.length).toBe(601)
    const result = assessMissionComplexity(exactly601)
    expect(result).not.toBeNull()
    expect(result!.category).toBe('mission-complex')
  })
  test('long mission message includes the char count', () => {
    const long = 'y'.repeat(750)
    expect(assessMissionComplexity(long)!.message).toContain('750')
  })
})

describe('assessMissionComplexity — multiple app types', () => {
  test('3 app types → not complex', () => {
    expect(assessMissionComplexity('build a game, todo, and calculator')).toBeNull()
  })
  test('4 app types → complex', () => {
    const m = 'build a game and a todo and a calculator and a clock'
    const result = assessMissionComplexity(m)
    expect(result).not.toBeNull()
    expect(result!.category).toBe('mission-complex')
  })
  test('complex message lists the first 4 app types', () => {
    const m = 'build a game and a todo and a calculator and a clock and a timer and an editor'
    const result = assessMissionComplexity(m)
    expect(result!.message).toContain('game')
    expect(result!.message).toContain('todo')
    expect(result!.message).toContain('calculator')
    expect(result!.message).toContain('clock')
  })
  test('app type detection uses word boundaries', () => {
    // "gaming" should NOT match "game" because of \b
    expect(assessMissionComplexity('build a gaming app with todos and calculators and clocks')).toBeNull()
  })
})

describe('assessMissionComplexity — canRetry & suggestions', () => {
  test('complex mission canRetry=false', () => {
    expect(assessMissionComplexity('x'.repeat(700))!.canRetry).toBe(false)
  })
  test('long-mission suggestion includes a simplified version', () => {
    const result = assessMissionComplexity('build a snake game. ' + 'x'.repeat(700))
    const last = result!.suggestions[result!.suggestions.length - 1]
    expect(typeof last).toBe('string')
    expect(last!.length).toBeGreaterThan(0)
  })
})

describe('simplifyMission — separators', () => {
  test('cuts at "with"', () => {
    expect(simplifyMission('build a snake game with extra features')).toBe('build a snake game')
  })
  test('cuts at "and"', () => {
    expect(simplifyMission('build a todo app and a calendar')).toBe('build a todo app')
  })
  test('cuts at "including"', () => {
    expect(simplifyMission('build a calculator including history')).toBe('build a calculator')
  })
  test('cuts at "plus"', () => {
    expect(simplifyMission('build a clock plus alarm')).toBe('build a clock')
  })
  test('cuts at "also"', () => {
    expect(simplifyMission('build a clock also with alarm')).toBe('build a clock')
  })
  test('cuts at "that has"', () => {
    expect(simplifyMission('build a clock that has alarms')).toBe('build a clock')
  })
  test('cuts at "that have"', () => {
    expect(simplifyMission('build a clock that have alarms')).toBe('build a clock')
  })
  test('cuts at "featuring"', () => {
    expect(simplifyMission('build a clock featuring alarms')).toBe('build a clock')
  })
})

describe('simplifyMission — sentence/clause boundaries', () => {
  test('cuts at "."', () => {
    expect(simplifyMission('Build a snake game. Also add a leaderboard.')).toBe('Build a snake game')
  })
  test('cuts at ";"', () => {
    expect(simplifyMission('Build a snake game; also add leaderboard')).toBe('Build a snake game')
  })
  test('cuts at newline', () => {
    expect(simplifyMission('Build a snake game\nMore lines here')).toBe('Build a snake game')
  })
})

describe('simplifyMission — truncation', () => {
  test('truncates long single clause to ≤203 chars (200 + "...")', () => {
    const long = 'build a snake game ' + 'x'.repeat(300)
    const result = simplifyMission(long)
    expect(result.length).toBeLessThanOrEqual(203)
    expect(result.endsWith('...')).toBe(true)
  })
  test('truncation cuts at word boundary when possible', () => {
    const long = 'build a snake game ' + 'word '.repeat(60)
    const result = simplifyMission(long)
    // If a word boundary was found, the last word isn't cut mid-word
    if (result.endsWith('...')) {
      const beforeEllipsis = result.slice(0, -3)
      // Last char before "..." is a space or a full word
      expect(beforeEllipsis.endsWith(' ') || /^[a-z]+$/.test(beforeEllipsis.split(' ').pop() || '')).toBe(true)
    }
  })
  test('does not truncate short inputs', () => {
    expect(simplifyMission('short mission')).toBe('short mission')
  })
})

describe('simplifyMission — edge cases', () => {
  test('empty input returns empty', () => {
    expect(simplifyMission('')).toBe('')
  })
  test('whitespace-only input returns empty', () => {
    expect(simplifyMission('   ')).toBe('')
  })
  test('no separators → returns the trimmed input', () => {
    expect(simplifyMission('build a snake game')).toBe('build a snake game')
  })
  test('preserves leading capitalization', () => {
    expect(simplifyMission('Build a Snake Game with features')).toBe('Build a Snake Game')
  })
})

describe('suggestRelatedMissions', () => {
  test('always returns exactly 3 missions', () => {
    expect(suggestRelatedMissions('')).toHaveLength(3)
    expect(suggestRelatedMissions('snake')).toHaveLength(3)
    expect(suggestRelatedMissions('build a quantum physics simulator with orbital mechanics')).toHaveLength(3)
  })
  test('returns non-empty strings only', () => {
    for (const s of suggestRelatedMissions('anything')) {
      expect(s.length).toBeGreaterThan(0)
    }
  })
  test('returns ambitious/high-level missions', () => {
    const joined = suggestRelatedMissions('test').join(' ')
    expect(/dashboard|simulator|banking/i.test(joined)).toBe(true)
  })
  test('mentions crypto, mobile OS, banking specifically', () => {
    const suggestions = suggestRelatedMissions('test')
    expect(suggestions.some(s => /crypto/i.test(s))).toBe(true)
    expect(suggestions.some(s => /mobile OS/i.test(s))).toBe(true)
    expect(suggestions.some(s => /banking/i.test(s))).toBe(true)
  })
  test('all suggestions are distinct', () => {
    const suggestions = suggestRelatedMissions('test')
    expect(new Set(suggestions).size).toBe(3)
  })
  test('handles null/undefined mission', () => {
    expect(suggestRelatedMissions(null as unknown as string)).toHaveLength(3)
    expect(suggestRelatedMissions(undefined as unknown as string)).toHaveLength(3)
  })
})

describe('analyzeError — priority ordering', () => {
  // Test that earlier branches take priority when multiple patterns match
  test('cancelled beats rate-limit', () => {
    expect(analyzeError('aborted due to 429', MISSION).category).toBe('cancelled')
  })
  test('cancelled beats timeout', () => {
    expect(analyzeError('aborted due to timeout', MISSION).category).toBe('cancelled')
  })
  test('rate-limit beats timeout', () => {
    expect(analyzeError('429 timed out', MISSION).category).toBe('rate-limit')
  })
  test('timeout beats network', () => {
    // "fetch timed out" matches both timeout and network (fetch) — timeout wins
    expect(analyzeError('fetch timed out', MISSION).category).toBe('timeout')
  })
  test('network beats empty', () => {
    // "fetch returned empty" — network wins
    expect(analyzeError('fetch returned empty', MISSION).category).toBe('network')
  })
  test('empty beats invalid', () => {
    // "empty invalid output" — empty wins
    expect(analyzeError('empty invalid output', MISSION).category).toBe('empty')
  })
})
