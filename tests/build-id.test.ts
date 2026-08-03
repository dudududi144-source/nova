// Test that newBuildId generates unique IDs
import { describe, it, expect } from 'bun:test'
import { newBuildId, sanitizeFilename, validateHistory, isValidHistoryItem, normalizeMission, groupHistoryByMission } from '../src/lib/helpers'
import type { BuildResult } from '../src/lib/helpers'

describe('newBuildId uniqueness', () => {
  it('generates unique IDs in rapid succession', () => {
    const ids = new Set<string>()
    for (let i = 0; i < 10000; i++) {
      ids.add(newBuildId())
    }
    expect(ids.size).toBe(10000)
  })

  it('generates IDs with the correct prefix', () => {
    const id = newBuildId()
    expect(id.startsWith('b_')).toBe(true)
  })

  it('generates IDs with 3 parts (prefix, timestamp, random)', () => {
    const id = newBuildId()
    const parts = id.split('_')
    expect(parts).toHaveLength(3)
    expect(parts[0]).toBe('b')
    expect(parts[1].length).toBeGreaterThan(0)
    expect(parts[2].length).toBe(10)
  })

  it('generates IDs that are sortable by time (roughly)', () => {
    const id1 = newBuildId()
    const id2 = newBuildId()
    const ts1 = parseInt(id1.split('_')[1], 36)
    const ts2 = parseInt(id2.split('_')[1], 36)
    expect(ts2).toBeGreaterThanOrEqual(ts1)
  })
})

describe('sanitizeFilename', () => {
  it('handles normal mission', () => {
    expect(sanitizeFilename('Build a snake game')).toBe('build-a-snake-game.html')
  })

  it('collapses consecutive non-alphanumeric chars', () => {
    expect(sanitizeFilename('Build --- a --- game')).toBe('build-a-game.html')
  })

  it('trims leading and trailing dashes', () => {
    expect(sanitizeFilename('---hello---')).toBe('hello.html')
  })

  it('falls back to app.html when mission is all non-alphanumeric', () => {
    expect(sanitizeFilename('---!!!???')).toBe('app.html')
  })

  it('handles empty mission', () => {
    expect(sanitizeFilename('')).toBe('app.html')
  })

  it('handles unicode mission (non-alphanumeric stripped)', () => {
    expect(sanitizeFilename('Build a 日本語 app')).toBe('build-a-app.html')
  })

  it('truncates to 30 chars before sanitizing', () => {
    const long = 'a'.repeat(50)
    const result = sanitizeFilename(long)
    expect(result).toBe('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.html')
  })

  it('handles mission with numbers', () => {
    expect(sanitizeFilename('Build a 2048 game')).toBe('build-a-2048-game.html')
  })

  it('handles mission with special chars', () => {
    expect(sanitizeFilename('Build a "quote" app')).toBe('build-a-quote-app.html')
  })

  it('handles mission with only spaces', () => {
    expect(sanitizeFilename('     ')).toBe('app.html')
  })
})

describe('validateHistory', () => {
  const validItem: BuildResult = {
    id: 'b_1', html: '<!DOCTYPE html>', tokens: 100, ms: 5000, mission: 'test'
  }

  it('returns empty array for non-array input', () => {
    expect(validateHistory(null)).toEqual([])
    expect(validateHistory('not an array')).toEqual([])
    expect(validateHistory({})).toEqual([])
    expect(validateHistory(undefined)).toEqual([])
  })

  it('returns empty array for empty array', () => {
    expect(validateHistory([])).toEqual([])
  })

  it('filters out invalid items', () => {
    const stored = [
      validItem,
      null,
      'not-an-object',
      { id: 123, html: 'bad', tokens: 0, ms: 0, mission: 'bad' },
      { id: 'b_2', html: '<!DOCTYPE html>', tokens: 100 }, // missing ms + mission
    ]
    const result = validateHistory(stored)
    expect(result).toHaveLength(1)
    expect(result[0]?.id).toBe('b_1')
  })

  it('caps at 30 items', () => {
    const stored = Array(45).fill(validItem).map((item, i) => ({ ...item, id: `b_${i}` }))
    const result = validateHistory(stored)
    expect(result).toHaveLength(30)
  })

  it('accepts all-valid array', () => {
    const stored = [
      { ...validItem, id: 'b_1' },
      { ...validItem, id: 'b_2' },
    ]
    const result = validateHistory(stored)
    expect(result).toHaveLength(2)
  })
})

describe('normalizeMission', () => {
  it('lowercases and trims', () => {
    expect(normalizeMission('  Build A Snake Game  ')).toBe('build a snake game')
  })
  it('collapses whitespace', () => {
    expect(normalizeMission('build   a\t\nsnake')).toBe('build a snake')
  })
  it('removes punctuation', () => {
    expect(normalizeMission('Build a snake game!!')).toBe('build a snake game')
  })
  it('groups case variations together', () => {
    expect(normalizeMission('Build A SNAKE Game')).toBe(normalizeMission('build a snake game'))
  })
  it('groups punctuation variations together', () => {
    expect(normalizeMission('Build a snake game!!')).toBe(normalizeMission('build a snake game'))
  })
  it('handles empty string', () => {
    expect(normalizeMission('')).toBe('')
  })
})

describe('groupHistoryByMission', () => {
  const mk = (id: string, mission: string): BuildResult => ({
    id, html: '<!DOCTYPE html>', tokens: 100, ms: 5000, mission,
  })

  it('groups builds with the same normalized mission', () => {
    const builds = [
      mk('b_1', 'Build a snake game'),
      mk('b_2', 'build a snake game!!'),
      mk('b_3', 'Build a todo app'),
    ]
    const groups = groupHistoryByMission(builds)
    expect(groups).toHaveLength(2)
    // First group should be the snake game (2 versions)
    expect(groups[0]).toHaveLength(2)
    expect(groups[1]).toHaveLength(1)
  })

  it('keeps newest-first within each group', () => {
    const builds = [
      mk('b_1', 'Build a snake game'),
      mk('b_2', 'Build a snake game'),
      mk('b_3', 'Build a snake game'),
    ]
    const groups = groupHistoryByMission(builds)
    expect(groups).toHaveLength(1)
    expect(groups[0].map(b => b.id)).toEqual(['b_1', 'b_2', 'b_3'])
  })

  it('caps at maxPerGroup versions per mission', () => {
    const builds = Array(8).fill(0).map((_, i) => mk(`b_${i}`, 'Build a snake game'))
    const groups = groupHistoryByMission(builds, 12, 5)
    expect(groups).toHaveLength(1)
    expect(groups[0]).toHaveLength(5)
  })

  it('caps at maxGroups groups', () => {
    const builds = Array(20).fill(0).map((_, i) => mk(`b_${i}`, `Build app ${i}`))
    const groups = groupHistoryByMission(builds, 5, 5)
    expect(groups).toHaveLength(5)
  })

  it('returns empty for empty input', () => {
    expect(groupHistoryByMission([])).toEqual([])
  })
})

describe('isValidHistoryItem', () => {
  it('accepts valid item', () => {
    const item = { id: 'b_1', html: '<!DOCTYPE html>', tokens: 100, ms: 5000, mission: 'test' }
    expect(isValidHistoryItem(item)).toBe(true)
  })

  it('rejects null', () => {
    expect(isValidHistoryItem(null)).toBe(false)
  })

  it('rejects non-object', () => {
    expect(isValidHistoryItem('hello')).toBe(false)
    expect(isValidHistoryItem(42)).toBe(false)
  })

  it('rejects missing fields', () => {
    expect(isValidHistoryItem({})).toBe(false)
    expect(isValidHistoryItem({ id: 'b_1' })).toBe(false)
  })

  it('rejects wrong types', () => {
    expect(isValidHistoryItem({ id: 123, html: '', tokens: 0, ms: 0, mission: '' })).toBe(false)
    expect(isValidHistoryItem({ id: '', html: null, tokens: 0, ms: 0, mission: '' })).toBe(false)
    expect(isValidHistoryItem({ id: '', html: '', tokens: '0', ms: 0, mission: '' })).toBe(false)
  })

  it('type narrowing works (assigns to BuildResult)', () => {
    const item: unknown = { id: 'b_1', html: '', tokens: 0, ms: 0, mission: '' }
    if (isValidHistoryItem(item)) {
      // TypeScript knows item is BuildResult here
      expect(item.id).toBe('b_1')
    }
  })
})
