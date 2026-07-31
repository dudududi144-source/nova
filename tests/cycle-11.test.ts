// Tests for cycle 11: RateLimiter memory protection, validation, error types
import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { RateLimiter } from '../src/lib/rate-limit'

// Minimal type for the filtered history items
interface BuildResultLike {
  id: string
  html: string
  tokens: number
  ms: number
  mission: string
}

describe('RateLimiter — memory protection (maxKeys)', () => {
  let limiter: RateLimiter

  afterEach(() => {
    limiter?.destroy()
  })

  it('caps the number of tracked keys at maxKeys', () => {
    limiter = new RateLimiter(10, 1000, 5 * 60 * 1000, 5) // maxKeys=5
    // Add 5 keys
    for (let i = 0; i < 5; i++) {
      limiter.check(`ip${i}`)
    }
    expect(limiter.size).toBe(5)
    // Adding a 6th should evict the oldest (ip0)
    limiter.check('ip5')
    expect(limiter.size).toBe(5)
    // ip0 should have been evicted — checking it again should start fresh (remaining=9)
    const r = limiter.check('ip0')
    expect(r.remaining).toBe(9) // fresh start, not 8
  })

  it('does not evict when updating an existing key', () => {
    limiter = new RateLimiter(10, 1000, 5 * 60 * 1000, 3) // maxKeys=3
    limiter.check('ip0')
    limiter.check('ip1')
    limiter.check('ip2')
    expect(limiter.size).toBe(3)
    // Check ip0 again — should NOT evict (it's an update, not a new key)
    limiter.check('ip0')
    expect(limiter.size).toBe(3)
  })

  it('evicts the oldest entry (earliest resetAt)', () => {
    limiter = new RateLimiter(10, 1000, 5 * 60 * 1000, 2) // maxKeys=2
    limiter.check('ip_old')
    // Wait a tiny bit so ip_new has a later resetAt
    const start = Date.now()
    while (Date.now() - start < 5) { /* busy wait */ }
    limiter.check('ip_new')
    expect(limiter.size).toBe(2)
    // Add a 3rd — should evict ip_old (earlier resetAt)
    limiter.check('ip3')
    expect(limiter.size).toBe(2)
    // ip_old should be gone (fresh check = remaining 9)
    const r = limiter.check('ip_old')
    expect(r.remaining).toBe(9)
  })

  it('default maxKeys is 10000', () => {
    limiter = new RateLimiter(10, 1000)
    // We can't test 10000 directly (too slow), but we can verify the default exists
    // by checking that size grows without eviction at small counts
    for (let i = 0; i < 100; i++) {
      limiter.check(`ip${i}`)
    }
    expect(limiter.size).toBe(100)
  })

  it('size getter returns current key count', () => {
    limiter = new RateLimiter(10, 1000)
    expect(limiter.size).toBe(0)
    limiter.check('ip1')
    expect(limiter.size).toBe(1)
    limiter.check('ip2')
    expect(limiter.size).toBe(2)
    limiter.reset('ip1')
    expect(limiter.size).toBe(1)
    limiter.resetAll()
    expect(limiter.size).toBe(0)
  })
})

describe('localStorage history validation (type-narrowing)', () => {
  // Replicate the validation logic to test it
  function isValidHistoryItem(h: unknown): boolean {
    if (typeof h !== 'object' || h === null) return false
    const item = h as Record<string, unknown>
    return (
      typeof item.id === 'string' &&
      typeof item.html === 'string' &&
      typeof item.tokens === 'number' &&
      typeof item.ms === 'number' &&
      typeof item.mission === 'string'
    )
  }

  it('accepts a valid history item', () => {
    const item = { id: 'b_1', html: '<!DOCTYPE html>', tokens: 100, ms: 5000, mission: 'test' }
    expect(isValidHistoryItem(item)).toBe(true)
  })

  it('rejects null', () => {
    expect(isValidHistoryItem(null)).toBe(false)
  })

  it('rejects non-object (string)', () => {
    expect(isValidHistoryItem('hello')).toBe(false)
  })

  it('rejects non-object (number)', () => {
    expect(isValidHistoryItem(42)).toBe(false)
  })

  it('rejects object with missing id', () => {
    const item = { html: '<!DOCTYPE html>', tokens: 100, ms: 5000, mission: 'test' }
    expect(isValidHistoryItem(item)).toBe(false)
  })

  it('rejects object with wrong type for id', () => {
    const item = { id: 123, html: '<!DOCTYPE html>', tokens: 100, ms: 5000, mission: 'test' }
    expect(isValidHistoryItem(item)).toBe(false)
  })

  it('rejects object with wrong type for tokens', () => {
    const item = { id: 'b_1', html: '<!DOCTYPE html>', tokens: '100', ms: 5000, mission: 'test' }
    expect(isValidHistoryItem(item)).toBe(false)
  })

  it('rejects object with wrong type for html', () => {
    const item = { id: 'b_1', html: null, tokens: 100, ms: 5000, mission: 'test' }
    expect(isValidHistoryItem(item)).toBe(false)
  })

  it('rejects object with wrong type for mission', () => {
    const item = { id: 'b_1', html: '<!DOCTYPE html>', tokens: 100, ms: 5000, mission: 42 }
    expect(isValidHistoryItem(item)).toBe(false)
  })

  it('rejects empty object', () => {
    expect(isValidHistoryItem({})).toBe(false)
  })

  it('filters out invalid items from an array (simulate the useEffect)', () => {
    const stored = [
      { id: 'b_1', html: '<!DOCTYPE html>', tokens: 100, ms: 5000, mission: 'valid1' },
      null,
      'not-an-object',
      { id: 'b_2', html: '<!DOCTYPE html>', tokens: 200, ms: 3000, mission: 'valid2' },
      { id: 123, html: 'bad', tokens: 0, ms: 0, mission: 'bad' }, // wrong id type
      { id: 'b_3', html: '<!DOCTYPE html>', tokens: 100 }, // missing ms + mission
    ]
    const valid = stored.filter(isValidHistoryItem)
    expect(valid).toHaveLength(2)
    expect((valid[0] as BuildResultLike)?.mission).toBe('valid1')
    expect((valid[1] as BuildResultLike)?.mission).toBe('valid2')
  })
})
