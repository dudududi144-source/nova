// Tests for error-recovery.ts — analyzeError, mission vagueness/complexity,
// simplifyMission, suggestRelatedMissions.
import { describe, it, expect } from 'bun:test'
import {
  analyzeError,
  assessMissionVagueness,
  assessMissionComplexity,
  simplifyMission,
  suggestRelatedMissions,
} from '../src/lib/error-recovery'

describe('analyzeError', () => {
  it('categorizes cancelled errors', () => {
    const result = analyzeError(new Error('The operation was aborted'), 'build a snake game')
    expect(result.category).toBe('cancelled')
    expect(result.severity).toBe('low')
    expect(result.canRetry).toBe(true)
  })

  it('categorizes 429 rate-limit errors', () => {
    const result = analyzeError('HTTP 429: Too Many Requests', 'build a snake game')
    expect(result.category).toBe('rate-limit')
    expect(result.retryDelayMs).toBeGreaterThanOrEqual(60_000)
  })

  it('categorizes rate limit text (no 429)', () => {
    const result = analyzeError('rate limit exceeded', 'build a snake game')
    expect(result.category).toBe('rate-limit')
  })

  it('categorizes timeout errors', () => {
    const result = analyzeError('The request timed out', 'build a snake game')
    expect(result.category).toBe('timeout')
    expect(result.canRetry).toBe(true)
  })

  it('flags long-mission timeout as high severity', () => {
    const longMission = 'build a snake game ' + 'with '.repeat(100) + 'more features'
    const result = analyzeError('timed out', longMission)
    expect(result.category).toBe('timeout')
    expect(result.severity).toBe('high')
  })

  it('categorizes network errors', () => {
    const result = analyzeError('fetch failed: ECONNREFUSED', 'build a snake game')
    expect(result.category).toBe('network')
    expect(result.severity).toBe('high')
  })

  it('categorizes empty output', () => {
    const result = analyzeError('returned an empty response', 'build a snake game')
    expect(result.category).toBe('empty')
    expect(result.canRetry).toBe(true)
  })

  it('categorizes invalid output', () => {
    const result = analyzeError("doesn't look like html", 'build a snake game')
    expect(result.category).toBe('invalid-output')
  })

  it('categorizes unknown errors as fallback', () => {
    const result = analyzeError('something went wrong', 'build a snake game')
    expect(result.category).toBe('unknown')
    expect(result.canRetry).toBe(true)
  })

  it('accepts Error objects', () => {
    const result = analyzeError(new Error('timed out'), 'mission')
    expect(result.category).toBe('timeout')
  })

  it('accepts string messages', () => {
    const result = analyzeError('timed out', 'mission')
    expect(result.category).toBe('timeout')
  })

  it('returns title and message for every category', () => {
    const inputs = ['abort', '429', 'timed out', 'fetch failed', 'empty', 'invalid', 'random error']
    for (const input of inputs) {
      const result = analyzeError(input, 'mission')
      expect(result.title.length).toBeGreaterThan(0)
      expect(result.message.length).toBeGreaterThan(0)
    }
  })

  it('returns at least one suggestion for every category', () => {
    const inputs = ['abort', '429', 'timed out', 'fetch failed', 'empty', 'invalid', 'random error']
    for (const input of inputs) {
      const result = analyzeError(input, 'mission')
      expect(result.suggestions.length).toBeGreaterThan(0)
    }
  })

  it('handles empty error message', () => {
    const result = analyzeError('', 'mission')
    expect(result.category).toBe('unknown')
  })

  it('handles null/undefined error gracefully', () => {
    const result = analyzeError(null as unknown as string, 'mission')
    expect(result.category).toBe('unknown')
  })

  it('detects empty output caused by vague mission', () => {
    const result = analyzeError('returned an empty response', 'hi')
    expect(result.category).toBe('mission-vague')
  })

  it('cancelled takes priority over 429', () => {
    const result = analyzeError('aborted due to 429', 'mission')
    expect(result.category).toBe('cancelled')
  })
})

describe('assessMissionVagueness', () => {
  it('returns null for empty mission', () => {
    expect(assessMissionVagueness('')).toBeNull()
    expect(assessMissionVagueness('   ')).toBeNull()
  })

  it('flags mission shorter than 12 chars as vague', () => {
    const result = assessMissionVagueness('snake')
    expect(result).not.toBeNull()
    expect(result!.category).toBe('mission-vague')
  })

  it('does not flag a 12+ char mission with enough words', () => {
    expect(assessMissionVagueness('build a snake game with score')).toBeNull()
  })

  it('flags mission with only filler words', () => {
    const result = assessMissionVagueness('build something cool')
    expect(result).not.toBeNull()
    expect(result!.category).toBe('mission-vague')
  })

  it('flags "make an app" as filler', () => {
    const result = assessMissionVagueness('make an app')
    expect(result).not.toBeNull()
  })

  it('does not flag a specific mission', () => {
    expect(assessMissionVagueness('build a calculator with history display')).toBeNull()
  })

  it('flags mission with one significant word', () => {
    const result = assessMissionVagueness('the the the the the')
    expect(result).not.toBeNull()
    expect(result!.category).toBe('mission-vague')
  })

  it('returns canRetry=false for vague missions', () => {
    const result = assessMissionVagueness('snake')
    expect(result).not.toBeNull()
    expect(result!.canRetry).toBe(false)
  })
})

describe('assessMissionComplexity', () => {
  it('returns null for empty mission', () => {
    expect(assessMissionComplexity('')).toBeNull()
  })

  it('returns null for simple mission', () => {
    expect(assessMissionComplexity('build a snake game with score')).toBeNull()
  })

  it('flags very long mission (>600 chars) as complex', () => {
    const long = 'build a snake game ' + 'with '.repeat(200) + 'features'
    const result = assessMissionComplexity(long)
    expect(result).not.toBeNull()
    expect(result!.category).toBe('mission-complex')
  })

  it('flags missions with 4+ distinct app types', () => {
    const mission = 'build a game and a todo and a calculator and a clock'
    const result = assessMissionComplexity(mission)
    expect(result).not.toBeNull()
    expect(result!.category).toBe('mission-complex')
  })

  it('does not flag missions with 3 app types', () => {
    const mission = 'build a game and a todo and a calculator'
    expect(assessMissionComplexity(mission)).toBeNull()
  })

  it('includes simplified version in suggestions for long mission', () => {
    const long = 'build a snake game ' + 'with '.repeat(200) + 'features'
    const result = assessMissionComplexity(long)
    expect(result).not.toBeNull()
    // The last suggestion is the simplified version
    const simplified = result!.suggestions[result!.suggestions.length - 1]
    expect(typeof simplified).toBe('string')
    expect(simplified!.length).toBeGreaterThan(0)
  })

  it('returns canRetry=false for complex missions', () => {
    const long = 'build a snake game ' + 'with '.repeat(200) + 'features'
    const result = assessMissionComplexity(long)
    expect(result).not.toBeNull()
    expect(result!.canRetry).toBe(false)
  })
})

describe('simplifyMission', () => {
  it('returns empty for empty input', () => {
    expect(simplifyMission('')).toBe('')
    expect(simplifyMission('   ')).toBe('')
  })

  it('returns the input unchanged if short and simple', () => {
    const result = simplifyMission('build a snake game')
    expect(result).toBe('build a snake game')
  })

  it('cuts at the first "with" feature list', () => {
    const result = simplifyMission('build a snake game with score and pause and restart')
    expect(result).toBe('build a snake game')
  })

  it('cuts at the first "and" feature list', () => {
    const result = simplifyMission('build a todo app and a calendar and a clock')
    expect(result).toBe('build a todo app')
  })

  it('cuts at the first sentence', () => {
    const result = simplifyMission('Build a snake game. Also add a leaderboard. And achievements.')
    expect(result).toBe('Build a snake game')
  })

  it('cuts at "including"', () => {
    const result = simplifyMission('build a calculator including history and percentage')
    expect(result).toBe('build a calculator')
  })

  it('truncates very long single clauses to 200 chars', () => {
    const long = 'build a snake game ' + 'x'.repeat(300)
    const result = simplifyMission(long)
    expect(result.length).toBeLessThanOrEqual(203) // 200 + '...'
  })

  it('handles "featuring" separator', () => {
    const result = simplifyMission('build a clock featuring alarm and stopwatch')
    expect(result).toBe('build a clock')
  })
})

describe('suggestRelatedMissions', () => {
  it('returns 3 suggestions', () => {
    expect(suggestRelatedMissions('snake')).toHaveLength(3)
  })

  it('returns game suggestions for "snake"', () => {
    const suggestions = suggestRelatedMissions('build a snake game')
    expect(suggestions.length).toBe(3)
    // At least one should mention a game
    expect(suggestions.some(s => /game/i.test(s))).toBe(true)
  })

  it('returns todo suggestions for "task"', () => {
    const suggestions = suggestRelatedMissions('build a task tracker')
    expect(suggestions.length).toBe(3)
  })

  it('returns calculator suggestions for "calc"', () => {
    const suggestions = suggestRelatedMissions('build a calc')
    expect(suggestions.length).toBe(3)
  })

  it('returns timer suggestions for "timer"', () => {
    const suggestions = suggestRelatedMissions('build a timer')
    expect(suggestions.length).toBe(3)
  })

  it('returns color suggestions for "palette"', () => {
    const suggestions = suggestRelatedMissions('build a palette generator')
    expect(suggestions.length).toBe(3)
  })

  it('returns editor suggestions for "markdown"', () => {
    const suggestions = suggestRelatedMissions('build a markdown editor')
    expect(suggestions.length).toBe(3)
  })

  it('returns generic fallback for unrelated mission', () => {
    const suggestions = suggestRelatedMissions('build a quantum physics simulator')
    expect(suggestions.length).toBe(3)
    expect(suggestions[0]).toContain('snake') // fallback includes snake
  })

  it('returns non-empty strings', () => {
    const suggestions = suggestRelatedMissions('anything')
    for (const s of suggestions) {
      expect(s.length).toBeGreaterThan(0)
    }
  })

  it('handles empty mission gracefully', () => {
    const suggestions = suggestRelatedMissions('')
    expect(suggestions.length).toBe(3)
  })
})
