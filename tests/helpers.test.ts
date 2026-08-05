// Tests for helpers.ts — newBuildId, sanitizeFilename, isValidHistoryItem, validateHistory,
// normalizeMission, groupHistoryByMission.
import { describe, it, expect } from 'bun:test'
import {
  newBuildId,
  sanitizeFilename,
  isValidHistoryItem,
  validateHistory,
  normalizeMission,
  groupHistoryByMission,
  type BuildResult,
} from '../src/lib/helpers'

function makeBuild(overrides: Partial<BuildResult> = {}): BuildResult {
  return {
    id: 'b1',
    html: '<html></html>',
    tokens: 100,
    ms: 200,
    mission: 'test',
    ...overrides,
  }
}

describe('newBuildId', () => {
  it('returns a string', () => {
    expect(typeof newBuildId()).toBe('string')
  })

  it('starts with "b_" prefix', () => {
    expect(newBuildId().startsWith('b_')).toBe(true)
  })

  it('contains three underscore-separated parts (b_, timestamp, random)', () => {
    const id = newBuildId()
    const parts = id.split('_')
    expect(parts.length).toBe(3)
    expect(parts[0]).toBe('b')
  })

  it('returns unique values on consecutive calls', () => {
    const ids = new Set<string>()
    for (let i = 0; i < 100; i++) ids.add(newBuildId())
    expect(ids.size).toBe(100)
  })
})

describe('sanitizeFilename', () => {
  it('lowercases the mission text', () => {
    expect(sanitizeFilename('HELLO WORLD')).toMatch(/^hello-world\.html$/)
  })

  it('collapses consecutive non-alphanumeric chars to a single dash', () => {
    expect(sanitizeFilename('a!!!b???c')).toBe('a-b-c.html')
  })

  it('trims leading and trailing dashes', () => {
    expect(sanitizeFilename('!!!hello!!!')).toBe('hello.html')
  })

  it('limits the mission to 30 chars before sanitizing', () => {
    const long = 'A'.repeat(50)
    const result = sanitizeFilename(long)
    // Should be 30 'a's + .html
    expect(result).toBe('a'.repeat(30) + '.html')
    expect(result.length).toBe(35)
  })

  it('falls back to "app.html" when the result is empty after sanitizing', () => {
    expect(sanitizeFilename('!!!???')).toBe('app.html')
  })

  it('falls back to "app.html" for empty input', () => {
    expect(sanitizeFilename('')).toBe('app.html')
  })

  it('appends ".html" extension', () => {
    expect(sanitizeFilename('snake game')).toBe('snake-game.html')
  })

  it('preserves numbers in the mission', () => {
    expect(sanitizeFilename('Game 2048')).toBe('game-2048.html')
  })

  it('collapses whitespace into a single dash', () => {
    expect(sanitizeFilename('hello   world')).toBe('hello-world.html')
  })

  it('handles unicode gracefully (non-ascii becomes dash)', () => {
    const result = sanitizeFilename('café résumé')
    expect(result.endsWith('.html')).toBe(true)
    expect(result).not.toContain('é')
  })
})

describe('isValidHistoryItem', () => {
  it('returns true for a valid BuildResult', () => {
    expect(isValidHistoryItem(makeBuild())).toBe(true)
  })

  it('returns false for null', () => {
    expect(isValidHistoryItem(null)).toBe(false)
  })

  it('returns false for undefined', () => {
    expect(isValidHistoryItem(undefined)).toBe(false)
  })

  it('returns false for a string', () => {
    expect(isValidHistoryItem('hello')).toBe(false)
  })

  it('returns false for a number', () => {
    expect(isValidHistoryItem(42)).toBe(false)
  })

  it('returns false when id is missing', () => {
    expect(isValidHistoryItem({ html: '', tokens: 0, ms: 0, mission: '' })).toBe(false)
  })

  it('returns false when id is not a string', () => {
    expect(isValidHistoryItem({ id: 123, html: '', tokens: 0, ms: 0, mission: '' })).toBe(false)
  })

  it('returns false when html is missing', () => {
    expect(isValidHistoryItem({ id: 'b1', tokens: 0, ms: 0, mission: '' })).toBe(false)
  })

  it('returns false when tokens is missing', () => {
    expect(isValidHistoryItem({ id: 'b1', html: '', ms: 0, mission: '' })).toBe(false)
  })

  it('returns false when tokens is not a number', () => {
    expect(isValidHistoryItem({ id: 'b1', html: '', tokens: '100', ms: 0, mission: '' })).toBe(false)
  })

  it('returns false when ms is missing', () => {
    expect(isValidHistoryItem({ id: 'b1', html: '', tokens: 0, mission: '' })).toBe(false)
  })

  it('returns false when mission is missing', () => {
    expect(isValidHistoryItem({ id: 'b1', html: '', tokens: 0, ms: 0 })).toBe(false)
  })

  it('returns true for an object with extra fields (extra fields ignored)', () => {
    expect(isValidHistoryItem({ ...makeBuild(), extra: 'ignored' })).toBe(true)
  })

  it('narrows the type (BuildResult access works after the check)', () => {
    const input: unknown = makeBuild()
    if (isValidHistoryItem(input)) {
      // TypeScript should allow this access.
      expect(input.id).toBe('b1')
    } else {
      expect.unreachable('should have been valid')
    }
  })
})

describe('validateHistory', () => {
  it('returns [] for a non-array input', () => {
    expect(validateHistory(null)).toEqual([])
    expect(validateHistory(undefined)).toEqual([])
    expect(validateHistory('hello')).toEqual([])
    expect(validateHistory({})).toEqual([])
    expect(validateHistory(42)).toEqual([])
  })

  it('returns [] for an empty array', () => {
    expect(validateHistory([])).toEqual([])
  })

  it('filters out invalid items from the array', () => {
    const input = [makeBuild({ id: 'b1' }), null, undefined, 'string', 42, makeBuild({ id: 'b2' })]
    const result = validateHistory(input)
    expect(result.length).toBe(2)
    expect(result[0].id).toBe('b1')
    expect(result[1].id).toBe('b2')
  })

  it('deduplicates items by id', () => {
    const input = [makeBuild({ id: 'b1' }), makeBuild({ id: 'b1' }), makeBuild({ id: 'b2' })]
    const result = validateHistory(input)
    expect(result.length).toBe(2)
  })

  it('caps the result to 30 items', () => {
    const input: BuildResult[] = []
    for (let i = 0; i < 50; i++) input.push(makeBuild({ id: `b${i}` }))
    const result = validateHistory(input)
    expect(result.length).toBe(30)
  })

  it('preserves order of valid items', () => {
    const input = [
      makeBuild({ id: 'b1', mission: 'first' }),
      makeBuild({ id: 'b2', mission: 'second' }),
    ]
    const result = validateHistory(input)
    expect(result[0].mission).toBe('first')
    expect(result[1].mission).toBe('second')
  })

  it('handles a mix of valid and invalid items with duplicates', () => {
    const input = [
      makeBuild({ id: 'b1' }),
      null,
      makeBuild({ id: 'b1' }), // duplicate
      makeBuild({ id: 'b2' }),
      'invalid',
      makeBuild({ id: 'b3' }),
    ]
    const result = validateHistory(input)
    expect(result.length).toBe(3)
    expect(result.map(r => r.id)).toEqual(['b1', 'b2', 'b3'])
  })
})

describe('normalizeMission', () => {
  it('lowercases the mission text', () => {
    expect(normalizeMission('HELLO WORLD')).toBe('hello world')
  })

  it('trims leading and trailing whitespace', () => {
    expect(normalizeMission('   hello   ')).toBe('hello')
  })

  it('collapses multiple whitespace into a single space', () => {
    expect(normalizeMission('hello    world')).toBe('hello world')
  })

  it('replaces punctuation with spaces', () => {
    expect(normalizeMission('hello, world!')).toBe('hello world')
  })

  it('collapses multiple spaces created by punctuation replacement', () => {
    expect(normalizeMission('hello!!!world')).toBe('hello world')
  })

  it('returns empty string for empty input', () => {
    expect(normalizeMission('')).toBe('')
  })

  it('returns empty string for whitespace-only input', () => {
    expect(normalizeMission('   ')).toBe('')
  })

  it('normalizes "Build a snake game" and "build a snake game!!" to the same value', () => {
    expect(normalizeMission('Build a snake game')).toBe(normalizeMission('build a snake game!!'))
  })

  it('handles underscores as separators (treats _ as word char)', () => {
    // \w matches underscores, so "snake_game" stays as "snake_game"
    expect(normalizeMission('snake_game')).toBe('snake_game')
  })
})

describe('groupHistoryByMission', () => {
  it('returns [] for an empty input', () => {
    expect(groupHistoryByMission([])).toEqual([])
  })

  it('groups builds by normalized mission', () => {
    const builds = [
      makeBuild({ id: 'b1', mission: 'Snake Game' }),
      makeBuild({ id: 'b2', mission: 'snake game' }), // same group as b1
      makeBuild({ id: 'b3', mission: 'Todo App' }),
    ]
    const groups = groupHistoryByMission(builds)
    expect(groups.length).toBe(2)
  })

  it('preserves insertion order of groups (newest-first = first-occurrence-first)', () => {
    const builds = [
      makeBuild({ id: 'b1', mission: 'First App' }),
      makeBuild({ id: 'b2', mission: 'Second App' }),
    ]
    const groups = groupHistoryByMission(builds)
    expect(groups[0][0].mission).toBe('First App')
    expect(groups[1][0].mission).toBe('Second App')
  })

  it('caps each group to maxPerGroup', () => {
    const builds: BuildResult[] = []
    for (let i = 0; i < 10; i++) builds.push(makeBuild({ id: `b${i}`, mission: 'same mission' }))
    const groups = groupHistoryByMission(builds, 12, 5)
    expect(groups.length).toBe(1)
    expect(groups[0].length).toBe(5)
  })

  it('caps the number of groups to maxGroups', () => {
    const builds: BuildResult[] = []
    for (let i = 0; i < 20; i++) builds.push(makeBuild({ id: `b${i}`, mission: `mission ${i}` }))
    const groups = groupHistoryByMission(builds, 5, 5)
    expect(groups.length).toBe(5)
  })

  it('uses default maxGroups=12 and maxPerGroup=5 when not provided', () => {
    const builds: BuildResult[] = []
    for (let i = 0; i < 20; i++) builds.push(makeBuild({ id: `b${i}`, mission: `mission ${i}` }))
    const groups = groupHistoryByMission(builds)
    expect(groups.length).toBe(12)
  })

  it('groups missions with different punctuation/case together', () => {
    const builds = [
      makeBuild({ id: 'b1', mission: 'Build a Snake Game' }),
      makeBuild({ id: 'b2', mission: 'build a snake game!!!' }),
      makeBuild({ id: 'b3', mission: 'BUILD A SNAKE GAME' }),
    ]
    const groups = groupHistoryByMission(builds)
    expect(groups.length).toBe(1)
    expect(groups[0].length).toBe(3)
  })

  it('returns at least one build per group (preserves order within group)', () => {
    const builds = [
      makeBuild({ id: 'b1', mission: 'app' }),
      makeBuild({ id: 'b2', mission: 'app' }),
      makeBuild({ id: 'b3', mission: 'app' }),
    ]
    const groups = groupHistoryByMission(builds)
    expect(groups[0].map(b => b.id)).toEqual(['b1', 'b2', 'b3'])
  })

  it('handles builds with empty mission strings', () => {
    const builds = [
      makeBuild({ id: 'b1', mission: '' }),
      makeBuild({ id: 'b2', mission: '' }),
    ]
    const groups = groupHistoryByMission(builds)
    expect(groups.length).toBe(1)
    expect(groups[0].length).toBe(2)
  })
})
