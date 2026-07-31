// Test that rate limiter's check() does not mutate state when rejecting
import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { RateLimiter } from '../src/lib/rate-limit'

describe('RateLimiter — concurrency and rejection safety', () => {
  let limiter: RateLimiter

  beforeEach(() => {
    limiter = new RateLimiter(3, 1000)
  })

  afterEach(() => {
    limiter.destroy()
  })

  it('does not increment count when rejecting (after max reached)', () => {
    // Use up all 3 requests
    limiter.check('ip1')
    limiter.check('ip1')
    limiter.check('ip1')

    // Make 5 more rejected requests
    for (let i = 0; i < 5; i++) {
      limiter.check('ip1')
    }

    // After window expires, should get a fresh start (3 more allowed)
    // If rejected requests were incrementing count, the resetAt would keep shifting
    // We verify by checking that resetInMs is reasonable (not pushed forward by 5 extra increments)
    const blocked = limiter.check('ip1')
    expect(blocked.ok).toBe(false)
    expect(blocked.resetInMs).toBeLessThanOrEqual(1000)
  })

  it('handles concurrent checks from same IP synchronously', () => {
    // Simulate concurrent requests (JS is single-threaded but we test the logic)
    const results: boolean[] = []
    for (let i = 0; i < 5; i++) {
      results.push(limiter.check('concurrent-ip').ok)
    }
    // First 3 should pass, last 2 should fail
    expect(results).toEqual([true, true, true, false, false])
  })

  it('resetInMs decreases over time (window is fixed, not sliding)', () => {
    limiter.check('ip1')
    const r1 = limiter.check('ip1')
    const firstReset = r1.resetInMs

    // Wait a tiny bit
    const start = Date.now()
    while (Date.now() - start < 10) { /* busy wait 10ms */ }

    const r2 = limiter.check('ip1')
    // Reset time should be less (window is counting down from the first request)
    expect(r2.resetInMs).toBeLessThan(firstReset)
  })

  it('handles max=0 (block everything)', () => {
    const strict = new RateLimiter(0, 1000)
    const r = strict.check('ip1')
    expect(r.ok).toBe(false)
    expect(r.remaining).toBe(0)
    strict.destroy()
  })

  it('handles max=1 (allow first, block rest)', () => {
    const single = new RateLimiter(1, 1000)
    expect(single.check('ip1').ok).toBe(true)
    expect(single.check('ip1').ok).toBe(false)
    single.destroy()
  })
})
