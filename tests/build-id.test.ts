// Test that newBuildId generates unique IDs
import { describe, it, expect } from 'bun:test'
import { newBuildId, sanitizeFilename, validateHistory, isValidHistoryItem } from '../src/lib/helpers'
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

  it('caps at 10 items', () => {
    const stored = Array(15).fill(validItem).map((item, i) => ({ ...item, id: `b_${i}` }))
    const result = validateHistory(stored)
    expect(result).toHaveLength(10)
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
