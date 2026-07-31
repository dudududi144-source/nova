// Unit tests for RateLimiter
import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { RateLimiter } from '../src/lib/rate-limit'

describe('RateLimiter', () => {
  let limiter: RateLimiter

  beforeEach(() => {
    limiter = new RateLimiter(3, 1000) // 3 requests per 1 second (fast for testing)
  })

  afterEach(() => {
    limiter.destroy()
  })

  it('allows first request', () => {
    const r = limiter.check('ip1')
    expect(r.ok).toBe(true)
    expect(r.remaining).toBe(2)
  })

  it('counts down remaining', () => {
    expect(limiter.check('ip1').remaining).toBe(2)
    expect(limiter.check('ip1').remaining).toBe(1)
    expect(limiter.check('ip1').remaining).toBe(0)
  })

  it('blocks after max reached', () => {
    limiter.check('ip1')
    limiter.check('ip1')
    limiter.check('ip1')
    const r = limiter.check('ip1')
    expect(r.ok).toBe(false)
    expect(r.remaining).toBe(0)
  })

  it('tracks different keys independently', () => {
    limiter.check('ip1')
    limiter.check('ip1')
    limiter.check('ip1')
    // ip1 is now exhausted, but ip2 should be fresh
    const r = limiter.check('ip2')
    expect(r.ok).toBe(true)
    expect(r.remaining).toBe(2)
  })

  it('resets after the window expires', async () => {
    limiter.check('ip1')
    limiter.check('ip1')
    limiter.check('ip1')
    expect(limiter.check('ip1').ok).toBe(false)

    // Wait for window to expire (1 second)
    await new Promise(resolve => setTimeout(resolve, 1100))

    const r = limiter.check('ip1')
    expect(r.ok).toBe(true)
    expect(r.remaining).toBe(2)
  })

  it('returns resetInMs > 0 when blocked', () => {
    limiter.check('ip1')
    limiter.check('ip1')
    limiter.check('ip1')
    const r = limiter.check('ip1')
    expect(r.ok).toBe(false)
    expect(r.resetInMs).toBeGreaterThan(0)
    expect(r.resetInMs).toBeLessThanOrEqual(1000)
  })

  it('reset(key) clears a single key', () => {
    limiter.check('ip1')
    limiter.check('ip1')
    limiter.check('ip1')
    expect(limiter.check('ip1').ok).toBe(false)

    limiter.reset('ip1')
    expect(limiter.check('ip1').ok).toBe(true)
  })

  it('resetAll() clears all keys', () => {
    limiter.check('ip1')
    limiter.check('ip1')
    limiter.check('ip1')
    limiter.check('ip2')
    limiter.check('ip2')
    limiter.check('ip2')

    limiter.resetAll()

    expect(limiter.check('ip1').ok).toBe(true)
    expect(limiter.check('ip2').ok).toBe(true)
  })

  it('cleanup() removes expired entries', async () => {
    limiter.check('ip1')
    await new Promise(resolve => setTimeout(resolve, 1100))
    limiter.cleanup()
    // After cleanup, the entry should be gone, so a new check starts fresh
    const r = limiter.check('ip1')
    expect(r.remaining).toBe(2) // fresh start, not 1
  })

  it('handles unknown key gracefully', () => {
    const r = limiter.check('never-seen')
    expect(r.ok).toBe(true)
    expect(r.remaining).toBe(2)
  })
})
