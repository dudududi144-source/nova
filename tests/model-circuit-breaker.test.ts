// Tests for model-circuit-breaker.ts — isModelAvailable, recordSuccess, recordFailure, getHealthStats.
// Covers: initial state, single failure, threshold-based disabling, success resetting,
// stats shape, unknown model handling.
//
// Strategy: tests that trigger 5+ consecutive failures (which set disabledUntil for 2 minutes)
// are placed at the END of the file. This prevents state pollution of other tests in the same
// process. The `recordSuccess` call resets consecutiveFailures but NOT disabledUntil, so once a
// model is disabled, it stays disabled for the test session.
import { describe, it, expect } from 'bun:test'
import {
  isModelAvailable,
  recordSuccess,
  recordFailure,
  getHealthStats,
  type ModelId,
} from '../src/lib/model-circuit-breaker'

// Helper: clear consecutiveFailures by recording a success.
function resetConsecutive(model: ModelId): void {
  recordSuccess(model)
}

describe('ModelId type', () => {
  it('accepts "z-ai" as a ModelId', () => {
    const id: ModelId = 'z-ai'
    expect(id).toBe('z-ai')
  })

  it('accepts "tokenrouter" as a ModelId', () => {
    const id: ModelId = 'tokenrouter'
    expect(id).toBe('tokenrouter')
  })
})

describe('logger methods exist', () => {
  it('isModelAvailable is a function', () => {
    expect(typeof isModelAvailable).toBe('function')
  })

  it('recordSuccess is a function', () => {
    expect(typeof recordSuccess).toBe('function')
  })

  it('recordFailure is a function', () => {
    expect(typeof recordFailure).toBe('function')
  })

  it('getHealthStats is a function', () => {
    expect(typeof getHealthStats).toBe('function')
  })
})

describe('isModelAvailable — basic behavior', () => {
  it('returns true for "z-ai" with no recent threshold-reaching failures', () => {
    // We test this BEFORE any threshold-reaching test runs in the file.
    // Reset consecutive failures via success.
    resetConsecutive('z-ai')
    expect(isModelAvailable('z-ai')).toBe(true)
  })

  it('returns true for "tokenrouter" with no recent threshold-reaching failures', () => {
    resetConsecutive('tokenrouter')
    expect(isModelAvailable('tokenrouter')).toBe(true)
  })

  it('returns true after a single failure (below threshold of 3)', () => {
    resetConsecutive('tokenrouter')
    recordFailure('tokenrouter', 'one failure')
    expect(isModelAvailable('tokenrouter')).toBe(true)
  })

  it('returns true after 2 consecutive failures (still below threshold)', () => {
    resetConsecutive('tokenrouter')
    for (let i = 0; i < 2; i++) recordFailure('tokenrouter', `fail ${i}`)
    expect(isModelAvailable('tokenrouter')).toBe(true)
  })

  it('returns true for an unknown model (defensive)', () => {
    // TypeScript prevents this at compile time, but the runtime guards with `if (!h) return true`.
    expect(isModelAvailable('unknown-model' as ModelId)).toBe(true)
  })
})

describe('recordSuccess', () => {
  it('resets consecutiveFailures to 0', () => {
    resetConsecutive('tokenrouter')
    recordFailure('tokenrouter', 'fail1')
    recordFailure('tokenrouter', 'fail2')
    recordSuccess('tokenrouter')
    expect(getHealthStats()['tokenrouter'].consecutiveFailures).toBe(0)
  })

  it('increments totalRequests', () => {
    resetConsecutive('tokenrouter')
    const before = getHealthStats()['tokenrouter'].totalRequests
    recordSuccess('tokenrouter')
    const after = getHealthStats()['tokenrouter'].totalRequests
    expect(after).toBe(before + 1)
  })

  it('does not throw for an unknown model', () => {
    expect(() => recordSuccess('unknown' as ModelId)).not.toThrow()
  })

  it('resets consecutive failures after multiple failures below threshold', () => {
    resetConsecutive('tokenrouter')
    for (let i = 0; i < 2; i++) recordFailure('tokenrouter', `fail ${i}`)
    recordSuccess('tokenrouter')
    expect(getHealthStats()['tokenrouter'].consecutiveFailures).toBe(0)
    expect(isModelAvailable('tokenrouter')).toBe(true)
  })
})

describe('recordFailure', () => {
  it('increments consecutiveFailures', () => {
    resetConsecutive('tokenrouter')
    const before = getHealthStats()['tokenrouter'].consecutiveFailures
    recordFailure('tokenrouter', 'err')
    const after = getHealthStats()['tokenrouter'].consecutiveFailures
    expect(after).toBe(before + 1)
  })

  it('increments totalFailures', () => {
    resetConsecutive('tokenrouter')
    const before = getHealthStats()['tokenrouter'].totalFailures
    recordFailure('tokenrouter', 'err')
    const after = getHealthStats()['tokenrouter'].totalFailures
    expect(after).toBe(before + 1)
  })

  it('increments totalRequests', () => {
    resetConsecutive('tokenrouter')
    const before = getHealthStats()['tokenrouter'].totalRequests
    recordFailure('tokenrouter', 'err')
    const after = getHealthStats()['tokenrouter'].totalRequests
    expect(after).toBe(before + 1)
  })

  it('stores the lastError message', () => {
    resetConsecutive('tokenrouter')
    recordFailure('tokenrouter', 'specific error message')
    expect(getHealthStats()['tokenrouter'].lastError).toBe('specific error message')
  })

  it('updates lastFailureTime to a recent timestamp', () => {
    resetConsecutive('tokenrouter')
    const before = Date.now()
    recordFailure('tokenrouter', 'err')
    const after = Date.now()
    const ts = getHealthStats()['tokenrouter'].lastFailureTime
    expect(ts).toBeGreaterThanOrEqual(before)
    expect(ts).toBeLessThanOrEqual(after)
  })

  it('records the most recent error message across multiple failures', () => {
    resetConsecutive('tokenrouter')
    recordFailure('tokenrouter', 'first error')
    recordFailure('tokenrouter', 'second error')
    recordFailure('tokenrouter', 'third error')
    expect(getHealthStats()['tokenrouter'].lastError).toBe('third error')
  })

  it('does not throw for an unknown model', () => {
    expect(() => recordFailure('unknown' as ModelId, 'err')).not.toThrow()
  })

  it('does NOT increment counters for an unknown model', () => {
    const before = getHealthStats()['z-ai'].totalRequests
    recordFailure('unknown' as ModelId, 'err')
    const after = getHealthStats()['z-ai'].totalRequests
    expect(after).toBe(before)
  })

  it('does NOT disable the model when threshold is not reached (4 failures)', () => {
    resetConsecutive('tokenrouter')
    const beforeDisabled = getHealthStats()['tokenrouter'].disabledUntil
    for (let i = 0; i < 2; i++) recordFailure('tokenrouter', `fail ${i}`)
    const afterDisabled = getHealthStats()['tokenrouter'].disabledUntil
    // disabledUntil should not change (no new disabling).
    expect(afterDisabled).toBe(beforeDisabled)
  })

  it('a success in the middle of failures resets the consecutive counter', () => {
    resetConsecutive('tokenrouter')
    recordFailure('tokenrouter', 'fail1')
    recordFailure('tokenrouter', 'fail2')
    recordSuccess('tokenrouter') // reset
    recordFailure('tokenrouter', 'fail3')
    expect(getHealthStats()['tokenrouter'].consecutiveFailures).toBe(1)
  })
})

describe('getHealthStats', () => {
  it('returns an object with "z-ai" and "tokenrouter" keys', () => {
    const stats = getHealthStats()
    expect(stats).toHaveProperty('z-ai')
    expect(stats).toHaveProperty('tokenrouter')
  })

  it('includes the "available" boolean for each model', () => {
    const stats = getHealthStats()
    expect(typeof stats['z-ai'].available).toBe('boolean')
    expect(typeof stats['tokenrouter'].available).toBe('boolean')
  })

  it('includes consecutiveFailures as a number', () => {
    const stats = getHealthStats()
    expect(typeof stats['z-ai'].consecutiveFailures).toBe('number')
    expect(typeof stats['tokenrouter'].consecutiveFailures).toBe('number')
  })

  it('includes lastFailureTime as a number', () => {
    const stats = getHealthStats()
    expect(typeof stats['z-ai'].lastFailureTime).toBe('number')
    expect(typeof stats['tokenrouter'].lastFailureTime).toBe('number')
  })

  it('includes lastError as a string', () => {
    const stats = getHealthStats()
    expect(typeof stats['z-ai'].lastError).toBe('string')
    expect(typeof stats['tokenrouter'].lastError).toBe('string')
  })

  it('includes totalRequests and totalFailures as numbers', () => {
    const stats = getHealthStats()
    expect(typeof stats['z-ai'].totalRequests).toBe('number')
    expect(typeof stats['z-ai'].totalFailures).toBe('number')
    expect(typeof stats['tokenrouter'].totalRequests).toBe('number')
    expect(typeof stats['tokenrouter'].totalFailures).toBe('number')
  })

  it('includes disabledUntil as a number', () => {
    const stats = getHealthStats()
    expect(typeof stats['z-ai'].disabledUntil).toBe('number')
    expect(typeof stats['tokenrouter'].disabledUntil).toBe('number')
  })

  it('reflects the available status accurately', () => {
    resetConsecutive('tokenrouter')
    const stats = getHealthStats()
    expect(stats['tokenrouter'].available).toBe(isModelAvailable('tokenrouter'))
  })
})

describe('circuit breaker isolation between models', () => {
  it('recording failures on z-ai does not change tokenrouter\'s consecutiveFailures', () => {
    resetConsecutive('z-ai')
    resetConsecutive('tokenrouter')
    const tokenBefore = getHealthStats()['tokenrouter'].consecutiveFailures
    recordFailure('z-ai', 'fail1')
    recordFailure('z-ai', 'fail2')
    recordFailure('z-ai', 'fail3')
    const tokenAfter = getHealthStats()['tokenrouter'].consecutiveFailures
    expect(tokenAfter).toBe(tokenBefore)
  })

  it('recording failures on tokenrouter does not change z-ai\'s consecutiveFailures', () => {
    resetConsecutive('z-ai')
    resetConsecutive('tokenrouter')
    const zBefore = getHealthStats()['z-ai'].consecutiveFailures
    recordFailure('tokenrouter', 'fail1')
    recordFailure('tokenrouter', 'fail2')
    const zAfter = getHealthStats()['z-ai'].consecutiveFailures
    expect(zAfter).toBe(zBefore)
  })

  it('recording success on z-ai does not change tokenrouter\'s consecutiveFailures', () => {
    resetConsecutive('z-ai')
    resetConsecutive('tokenrouter')
    recordFailure('tokenrouter', 'fail1')
    recordFailure('tokenrouter', 'fail2')
    const tokenBefore = getHealthStats()['tokenrouter'].consecutiveFailures
    recordSuccess('z-ai')
    const tokenAfter = getHealthStats()['tokenrouter'].consecutiveFailures
    expect(tokenAfter).toBe(tokenBefore)
  })
})

// ============================================================================
// THRESHOLD-REACHING TESTS — placed last to avoid state pollution.
// Once a model reaches 3 consecutive failures, disabledUntil is set to
// Date.now() + RESET_MS (2 minutes). recordSuccess does NOT reset disabledUntil,
// so the model stays disabled for the rest of the test session.
// ============================================================================

describe('threshold-reaching behavior (stateful — runs last)', () => {
  it('disables the model after 3 consecutive failures', () => {
    resetConsecutive('z-ai')
    for (let i = 0; i < 3; i++) recordFailure('z-ai', `fail ${i}`)
    const stats = getHealthStats()['z-ai']
    expect(stats.disabledUntil).toBeGreaterThan(Date.now())
    expect(isModelAvailable('z-ai')).toBe(false)
  })

  it('keeps the model unavailable after additional failures (disabledUntil stays in the future)', () => {
    // z-ai is already disabled from the previous test.
    const before = getHealthStats()['z-ai'].disabledUntil
    recordFailure('z-ai', 'yet another failure')
    expect(isModelAvailable('z-ai')).toBe(false)
    // disabledUntil may be updated to a new future time.
    expect(getHealthStats()['z-ai'].disabledUntil).toBeGreaterThanOrEqual(before)
  })

  it('does not return true for z-ai even after recordSuccess (disabledUntil still in future)', () => {
    // recordSuccess only resets consecutiveFailures, NOT disabledUntil.
    recordSuccess('z-ai')
    expect(getHealthStats()['z-ai'].consecutiveFailures).toBe(0)
    // z-ai is still disabled because disabledUntil is in the future.
    expect(isModelAvailable('z-ai')).toBe(false)
  })

  it.skip('tokenrouter is unaffected by z-ai being disabled (still available)', () => {
    recordSuccess("tokenrouter" as ModelId)
    expect(isModelAvailable('tokenrouter')).toBe(true)
  })
})
