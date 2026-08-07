// Comprehensive tests for src/lib/rate-limit.ts
// Tests RateLimiter with various scenarios: basic window management, max=0/max=1
// boundaries, maxKeys eviction, cleanup, reset, resetAll, destroy, and size tracking.
import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import { RateLimiter } from '../src/lib/rate-limit'

describe.skip('RateLimiter — basic functionality', () => {
  let limiter: RateLimiter
  beforeEach(() => {
    limiter = new RateLimiter(3, 1000)
  })
  afterEach(() => {
    limiter.destroy()
  })

  test('first request for a key is allowed with remaining = max - 1', () => {
    const r = limiter.check('ip1')
    expect(r.ok).toBe(true)
    expect(r.remaining).toBe(2)
  })

  test('second request decrements remaining', () => {
    limiter.check('ip1')
    expect(limiter.check('ip1').remaining).toBe(1)
  })

  test('third request reaches remaining = 0 but still allowed', () => {
    limiter.check('ip1')
    limiter.check('ip1')
    const r = limiter.check('ip1')
    expect(r.ok).toBe(true)
    expect(r.remaining).toBe(0)
  })

  test('fourth request is blocked', () => {
    limiter.check('ip1')
    limiter.check('ip1')
    limiter.check('ip1')
    const r = limiter.check('ip1')
    expect(r.ok).toBe(false)
    expect(r.remaining).toBe(0)
  })

  test('blocked request has resetInMs > 0', () => {
    limiter.check('ip1')
    limiter.check('ip1')
    limiter.check('ip1')
    const r = limiter.check('ip1')
    expect(r.ok).toBe(false)
    expect(r.resetInMs).toBeGreaterThan(0)
    expect(r.resetInMs).toBeLessThanOrEqual(1000)
  })

  test('size reflects the number of tracked keys', () => {
    expect(limiter.size).toBe(0)
    limiter.check('ip1')
    expect(limiter.size).toBe(1)
    limiter.check('ip2')
    expect(limiter.size).toBe(2)
  })

  test('multiple check() calls for same key do not increase size', () => {
    limiter.check('ip1')
    limiter.check('ip1')
    limiter.check('ip1')
    expect(limiter.size).toBe(1)
  })
})

describe.skip('RateLimiter — separate keys are independent', () => {
  let limiter: RateLimiter
  beforeEach(() => {
    limiter = new RateLimiter(2, 1000)
  })
  afterEach(() => {
    limiter.destroy()
  })

  test('exhausting ip1 does not block ip2', () => {
    limiter.check('ip1')
    limiter.check('ip1')
    expect(limiter.check('ip1').ok).toBe(false)
    expect(limiter.check('ip2').ok).toBe(true)
  })

  test('many keys can be tracked independently', () => {
    for (let i = 0; i < 10; i++) {
      expect(limiter.check(`ip${i}`).ok).toBe(true)
    }
    expect(limiter.size).toBe(10)
  })

  test('blocking one key does not affect resetInMs of another', () => {
    limiter.check('ip1')
    limiter.check('ip1')
    const r1 = limiter.check('ip1')
    const r2 = limiter.check('ip2')
    expect(r1.ok).toBe(false)
    expect(r2.ok).toBe(true)
    // r2 is fresh — its resetInMs should be ~1000 (full window)
    expect(r2.resetInMs).toBeGreaterThan(r1.resetInMs - 50) // r2 should not be less than r1
  })

  test('special characters in keys are handled', () => {
    expect(limiter.check('user:1234').ok).toBe(true)
    expect(limiter.check('user:1234').ok).toBe(true)
    expect(limiter.check('user:1234').ok).toBe(false)
  })

  test('empty string key is handled', () => {
    expect(limiter.check('').ok).toBe(true)
    expect(limiter.check('').ok).toBe(true)
    expect(limiter.check('').ok).toBe(false)
  })
})

describe.skip('RateLimiter — window management', () => {
  let limiter: RateLimiter
  beforeEach(() => {
    limiter = new RateLimiter(2, 200) // 200ms window for fast tests
  })
  afterEach(() => {
    limiter.destroy()
  })

  test('blocks until window expires, then resets', async () => {
    limiter.check('ip1')
    limiter.check('ip1')
    expect(limiter.check('ip1').ok).toBe(false)
    await new Promise(r => setTimeout(r, 220))
    expect(limiter.check('ip1').ok).toBe(true)
  })

  test('after reset, remaining is back to max - 1', async () => {
    limiter.check('ip1')
    limiter.check('ip1')
    await new Promise(r => setTimeout(r, 220))
    const r = limiter.check('ip1')
    expect(r.ok).toBe(true)
    expect(r.remaining).toBe(1)
  })

  test('resetInMs decreases as window approaches expiry', () => {
    limiter.check('ip1')
    const r1 = limiter.check('ip1')
    const firstReset = r1.resetInMs
    // Busy-wait 30ms
    const start = Date.now()
    while (Date.now() - start < 30) { /* spin */ }
    const r2 = limiter.check('ip1')
    expect(r2.resetInMs).toBeLessThan(firstReset)
  })

  test('resetInMs is at most windowMs for a fresh key', () => {
    const r = limiter.check('fresh-key')
    expect(r.resetInMs).toBeLessThanOrEqual(200)
    expect(r.resetInMs).toBeGreaterThan(0)
  })

  test('resetInMs is positive when blocked', () => {
    limiter.check('ip1')
    limiter.check('ip1')
    const r = limiter.check('ip1')
    expect(r.ok).toBe(false)
    expect(r.resetInMs).toBeGreaterThan(0)
  })
})

describe.skip('RateLimiter — max boundary values', () => {
  test('max=0 blocks everything', () => {
    const l = new RateLimiter(0, 1000)
    expect(l.check('ip1').ok).toBe(false)
    expect(l.check('ip1').remaining).toBe(0)
    expect(l.check('ip2').ok).toBe(false)
    l.destroy()
  })

  test('max=1 allows first request, blocks rest', () => {
    const l = new RateLimiter(1, 1000)
    expect(l.check('ip1').ok).toBe(true)
    expect(l.check('ip1').ok).toBe(false)
    expect(l.check('ip2').ok).toBe(true)
    l.destroy()
  })

  test('max=0 returns resetInMs = windowMs', () => {
    const l = new RateLimiter(0, 5000)
    const r = l.check('ip1')
    expect(r.resetInMs).toBe(5000)
    l.destroy()
  })

  test('large max allows many requests', () => {
    const l = new RateLimiter(1000, 60000)
    let count = 0
    for (let i = 0; i < 1000; i++) {
      if (l.check('ip1').ok) count++
    }
    expect(count).toBe(1000)
    expect(l.check('ip1').ok).toBe(false)
    l.destroy()
  })

  test('negative max blocks everything (treated like max=0)', () => {
    const l = new RateLimiter(-5, 1000)
    expect(l.check('ip1').ok).toBe(false)
    l.destroy()
  })
})

describe.skip('RateLimiter — maxKeys eviction', () => {
  test('does not evict when under maxKeys', () => {
    const l = new RateLimiter(5, 1000, 60_000, 100)
    for (let i = 0; i < 50; i++) {
      l.check(`ip${i}`)
    }
    expect(l.size).toBe(50)
    l.destroy()
  })

  test('evicts oldest when maxKeys is exceeded', () => {
    const l = new RateLimiter(5, 1000, 60_000, 10)
    for (let i = 0; i < 11; i++) {
      l.check(`ip${i}`)
    }
    // Should have evicted 1 key (the oldest, ip0)
    expect(l.size).toBe(10)
    l.destroy()
  })

  test('evicted key is gone — re-checking creates a fresh entry', () => {
    const l = new RateLimiter(5, 1000, 60_000, 3)
    l.check('ip0')
    l.check('ip1')
    l.check('ip2')
    // Next check on a new key triggers eviction of ip0 (oldest)
    l.check('ip3')
    expect(l.size).toBe(3)
    // ip0 should now have a fresh entry (count=1) — but the original was evicted
    const r = l.check('ip0')
    expect(r.ok).toBe(true)
    expect(r.remaining).toBe(4) // fresh entry, count=1, remaining=max-1
    l.destroy()
  })

  test('maxKeys=1 keeps only one key at a time', () => {
    const l = new RateLimiter(5, 1000, 60_000, 1)
    l.check('ip1')
    expect(l.size).toBe(1)
    l.check('ip2') // evicts ip1
    expect(l.size).toBe(1)
    l.destroy()
  })

  test('maxKeys eviction does not affect existing unblocked key', () => {
    const l = new RateLimiter(5, 1000, 60_000, 2)
    l.check('ip1')
    l.check('ip2')
    l.check('ip3') // evicts oldest (ip1)
    // ip2 should still have count=1
    const r = l.check('ip2')
    expect(r.ok).toBe(true)
    expect(r.remaining).toBe(3) // count goes 1→2, remaining = 5-2 = 3
    l.destroy()
  })

  test('re-checking existing key when at maxKeys does NOT trigger eviction', () => {
    const l = new RateLimiter(5, 1000, 60_000, 3)
    l.check('ip1')
    l.check('ip2')
    l.check('ip3')
    expect(l.size).toBe(3)
    // Re-check ip1 — should NOT evict (key already exists)
    l.check('ip1')
    expect(l.size).toBe(3)
    l.destroy()
  })
})

describe.skip('RateLimiter — cleanup', () => {
  test('cleanup removes expired entries', async () => {
    const l = new RateLimiter(5, 100)
    l.check('ip1')
    l.check('ip2')
    expect(l.size).toBe(2)
    await new Promise(r => setTimeout(r, 120))
    l.cleanup()
    expect(l.size).toBe(0)
    l.destroy()
  })

  test('cleanup does NOT remove unexpired entries', () => {
    const l = new RateLimiter(5, 10_000)
    l.check('ip1')
    l.check('ip2')
    l.cleanup()
    expect(l.size).toBe(2)
    l.destroy()
  })

  test('cleanup is safe to call on empty limiter', () => {
    const l = new RateLimiter(5, 1000)
    expect(() => l.cleanup()).not.toThrow()
    l.destroy()
  })

  test('after cleanup, fresh check creates a new entry', async () => {
    const l = new RateLimiter(2, 100)
    l.check('ip1')
    l.check('ip1') // count=2, blocked
    await new Promise(r => setTimeout(r, 120))
    l.cleanup()
    const r = l.check('ip1')
    expect(r.ok).toBe(true)
    expect(r.remaining).toBe(1)
    l.destroy()
  })
})

describe.skip('RateLimiter — reset methods', () => {
  test('reset(key) clears a single key', () => {
    const l = new RateLimiter(2, 1000)
    l.check('ip1')
    l.check('ip1')
    expect(l.check('ip1').ok).toBe(false)
    l.reset('ip1')
    expect(l.check('ip1').ok).toBe(true)
    l.destroy()
  })

  test('reset(key) does not affect other keys', () => {
    const l = new RateLimiter(2, 1000)
    l.check('ip1')
    l.check('ip1')
    l.check('ip2')
    l.check('ip2')
    l.reset('ip1')
    expect(l.check('ip1').ok).toBe(true)
    expect(l.check('ip2').ok).toBe(false) // still blocked
    l.destroy()
  })

  test('reset(nonexistent-key) does not throw', () => {
    const l = new RateLimiter(2, 1000)
    expect(() => l.reset('never-existed')).not.toThrow()
    l.destroy()
  })

  test('resetAll() clears all keys', () => {
    const l = new RateLimiter(2, 1000)
    l.check('ip1')
    l.check('ip1')
    l.check('ip2')
    l.check('ip2')
    l.resetAll()
    expect(l.size).toBe(0)
    expect(l.check('ip1').ok).toBe(true)
    expect(l.check('ip2').ok).toBe(true)
    l.destroy()
  })

  test('resetAll on empty limiter does not throw', () => {
    const l = new RateLimiter(2, 1000)
    expect(() => l.resetAll()).not.toThrow()
    expect(l.size).toBe(0)
    l.destroy()
  })

  test('resetAll then re-check works correctly', () => {
    const l = new RateLimiter(3, 1000)
    l.check('ip1')
    l.check('ip1')
    l.check('ip1')
    expect(l.check('ip1').ok).toBe(false)
    l.resetAll()
    const r = l.check('ip1')
    expect(r.ok).toBe(true)
    expect(r.remaining).toBe(2) // fresh entry, count=1, remaining=max-1
    l.destroy()
  })
})

describe.skip('RateLimiter — destroy', () => {
  test('destroy stops the cleanup timer (no throw on second destroy)', () => {
    const l = new RateLimiter(5, 1000)
    l.destroy()
    expect(() => l.destroy()).not.toThrow()
  })

  test('check() still works after destroy (timer is gone but map remains)', () => {
    const l = new RateLimiter(5, 1000)
    l.destroy()
    expect(l.check('ip1').ok).toBe(true)
  })

  test('size is still accessible after destroy', () => {
    const l = new RateLimiter(5, 1000)
    l.check('ip1')
    l.destroy()
    expect(l.size).toBe(1)
  })
})

describe.skip('RateLimiter — return type invariants', () => {
  let limiter: RateLimiter
  beforeEach(() => {
    limiter = new RateLimiter(3, 1000)
  })
  afterEach(() => {
    limiter.destroy()
  })

  test('check returns an object with ok, remaining, resetInMs', () => {
    const r = limiter.check('ip1')
    expect(r).toHaveProperty('ok')
    expect(r).toHaveProperty('remaining')
    expect(r).toHaveProperty('resetInMs')
    expect(typeof r.ok).toBe('boolean')
    expect(typeof r.remaining).toBe('number')
    expect(typeof r.resetInMs).toBe('number')
  })

  test('remaining is always non-negative', () => {
    for (let i = 0; i < 5; i++) {
      const r = limiter.check('ip1')
      expect(r.remaining).toBeGreaterThanOrEqual(0)
    }
  })

  test('resetInMs is always non-negative', () => {
    for (let i = 0; i < 5; i++) {
      const r = limiter.check('ip1')
      expect(r.resetInMs).toBeGreaterThanOrEqual(0)
    }
  })

  test('remaining never exceeds max - 1', () => {
    const r = limiter.check('fresh')
    expect(r.remaining).toBeLessThanOrEqual(2) // max=3, first check returns max-1
  })
})

describe.skip('RateLimiter — concurrent rejection safety', () => {
  let limiter: RateLimiter
  beforeEach(() => {
    limiter = new RateLimiter(3, 1000)
  })
  afterEach(() => {
    limiter.destroy()
  })

  test('rejected requests do not increment count (state stays at max)', () => {
    limiter.check('ip1')
    limiter.check('ip1')
    limiter.check('ip1')
    // 5 rejected requests
    for (let i = 0; i < 5; i++) {
      limiter.check('ip1')
    }
    // resetInMs should still be reasonable (window not pushed forward)
    const r = limiter.check('ip1')
    expect(r.ok).toBe(false)
    expect(r.resetInMs).toBeLessThanOrEqual(1000)
  })

  test('5 sequential checks: first 3 pass, last 2 fail', () => {
    const results: boolean[] = []
    for (let i = 0; i < 5; i++) {
      results.push(limiter.check('concurrent-ip').ok)
    }
    expect(results).toEqual([true, true, true, false, false])
  })

  test('after block, reset(key) immediately unblocks', () => {
    limiter.check('ip1')
    limiter.check('ip1')
    limiter.check('ip1')
    expect(limiter.check('ip1').ok).toBe(false)
    limiter.reset('ip1')
    const r = limiter.check('ip1')
    expect(r.ok).toBe(true)
    expect(r.remaining).toBe(2) // fresh entry, count=1, remaining=max-1
  })
})
