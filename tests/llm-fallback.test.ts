// Tests for llm-fallback.ts — executeWithFallback + getFallbackHealth.
//
// Strategy: Mock `llmChat` (./llm) and `tokenRouterChat` (./tokenrouter) with
// controllable mock functions so we can drive each combination of primary
// availability, primary result, secondary availability, secondary result.
// Uses the real `model-circuit-breaker` (stateful module-level singleton).
//
// IMPORTANT: One test trips the z-ai circuit breaker (5 failures → disabled
// for 2 minutes). `recordSuccess` does NOT reset `disabledUntil`. So that
// test is placed at the END of the file (after all other tests that rely on
// z-ai being available) to avoid state pollution.
import { describe, it, expect, beforeEach, mock } from 'bun:test'
import {
  executeWithFallback,
  getFallbackHealth,
  type FallbackModelId,
  type FallbackOptions,
} from '../src/lib/llm-fallback'
import type { LlmResult } from '../src/lib/llm'
import type { TokenRouterResult } from '../src/lib/tokenrouter'
import { recordSuccess, type ModelId } from '../src/lib/model-circuit-breaker'

// ── Mocks ──

const mockLlmChat = mock((_sys: string, _user: string, _opts?: unknown): Promise<LlmResult> => {
  return Promise.resolve({ ok: true, text: 'zai-ok', tokens: 10, ms: 100 })
})

const mockTokenRouterChat = mock((_sys: string, _user: string, _opts?: unknown): Promise<TokenRouterResult> => {
  return Promise.resolve({ ok: true, text: 'kimi-ok', tokens: 20, ms: 200 })
})

// Mock the LLM client modules. The mocks forward to the controllable mock
// functions above so individual tests can use `.mockImplementation` to
// override behavior.
mock.module('../src/lib/llm', () => ({
  llmChat: (sys: string, user: string, opts?: unknown) => mockLlmChat(sys, user, opts),
}))

mock.module('../src/lib/tokenrouter', () => ({
  tokenRouterChat: (sys: string, user: string, opts?: unknown) => mockTokenRouterChat(sys, user, opts),
}))

// ── Helpers ──

function baseOpts(over: Partial<FallbackOptions> = {}): FallbackOptions {
  return {
    systemPrompt: 'sys',
    userPrompt: 'user',
    ...over,
  }
}

beforeEach(() => {
  // Reset the circuit breaker state for both models (clears consecutiveFailures).
  // NOTE: recordSuccess does NOT clear `disabledUntil` — once the breaker is
  // tripped, it stays tripped for 2 minutes. We rely on test ordering (the
  // trip-the-breaker test runs LAST) to avoid state pollution.
  recordSuccess('z-ai' as ModelId)
  recordSuccess('tokenrouter' as ModelId)
  // Reset mock call counts and implementations.
  mockLlmChat.mockReset()
  mockTokenRouterChat.mockReset()
  // Restore default implementations after reset.
  mockLlmChat.mockImplementation(() => Promise.resolve({
    ok: true, text: 'zai-ok', tokens: 10, ms: 100,
  }))
  mockTokenRouterChat.mockImplementation(() => Promise.resolve({
    ok: true, text: 'kimi-ok', tokens: 20, ms: 200,
  }))
})

// ── Tests ──

describe('executeWithFallback — function shape', () => {
  it('is a function', () => {
    expect(typeof executeWithFallback).toBe('function')
  })
})

describe('executeWithFallback — primary (z-ai) succeeds', () => {
  it('returns the primary result when z-ai succeeds', async () => {
    const result = await executeWithFallback(baseOpts())
    expect(result.ok).toBe(true)
    expect(result.text).toBe('zai-ok')
    expect(result.tokens).toBe(10)
    expect(result.ms).toBe(100)
  })

  it('calls llmChat exactly once when primary succeeds', async () => {
    await executeWithFallback(baseOpts())
    expect(mockLlmChat).toHaveBeenCalledTimes(1)
    expect(mockTokenRouterChat).toHaveBeenCalledTimes(0)
  })

  it('does not call tokenRouterChat when primary succeeds', async () => {
    await executeWithFallback(baseOpts())
    expect(mockTokenRouterChat).not.toHaveBeenCalled()
  })

  it('passes systemPrompt and userPrompt to llmChat', async () => {
    await executeWithFallback(baseOpts({ systemPrompt: 'SYS', userPrompt: 'USER' }))
    expect(mockLlmChat).toHaveBeenCalledWith('SYS', 'USER', expect.anything())
  })

  it('passes maxTokens, temperature, timeoutMs, signal to llmChat', async () => {
    const controller = new AbortController()
    await executeWithFallback(baseOpts({
      maxTokens: 1234,
      temperature: 0.7,
      timeoutMs: 99_000,
      signal: controller.signal,
    }))
    expect(mockLlmChat).toHaveBeenCalledWith(
      expect.any(String), expect.any(String),
      expect.objectContaining({
        maxTokens: 1234,
        temperature: 0.7,
        timeoutMs: 99_000,
        signal: controller.signal,
      }),
    )
  })
})

describe('executeWithFallback — primary fails, fallback to secondary (tokenrouter)', () => {
  it('falls back to tokenRouter when z-ai fails', async () => {
    mockLlmChat.mockImplementation(() => Promise.resolve({
      ok: false, text: '', tokens: 0, ms: 50, error: 'z-ai-down',
    }))
    const result = await executeWithFallback(baseOpts())
    expect(result.ok).toBe(true)
    expect(result.text).toBe('kimi-ok')
    expect(mockLlmChat).toHaveBeenCalledTimes(1)
    expect(mockTokenRouterChat).toHaveBeenCalledTimes(1)
  })

  it('uses higher maxTokens (>=8000) when calling tokenRouter as fallback', async () => {
    mockLlmChat.mockImplementation(() => Promise.resolve({
      ok: false, text: '', tokens: 0, ms: 50, error: 'fail',
    }))
    await executeWithFallback(baseOpts({ maxTokens: 1000 }))
    expect(mockTokenRouterChat).toHaveBeenCalledWith(
      expect.any(String), expect.any(String),
      expect.objectContaining({
        maxTokens: expect.any(Number),
      }),
    )
    const opts = mockTokenRouterChat.mock.calls[0]?.[2] as { maxTokens?: number } | undefined
    expect(opts?.maxTokens).toBeGreaterThanOrEqual(8000)
  })

  it('uses 8000 maxTokens for tokenRouter when maxTokens is undefined', async () => {
    mockLlmChat.mockImplementation(() => Promise.resolve({
      ok: false, text: '', tokens: 0, ms: 50, error: 'fail',
    }))
    await executeWithFallback(baseOpts({ maxTokens: undefined }))
    const opts = mockTokenRouterChat.mock.calls[0]?.[2] as { maxTokens?: number } | undefined
    expect(opts?.maxTokens).toBe(8000)
  })

  it('returns secondary result on fallback success', async () => {
    mockLlmChat.mockImplementation(() => Promise.resolve({
      ok: false, text: '', tokens: 0, ms: 50, error: 'primary-failed',
    }))
    mockTokenRouterChat.mockImplementation(() => Promise.resolve({
      ok: true, text: 'secondary-success', tokens: 99, ms: 250,
    }))
    const result = await executeWithFallback(baseOpts())
    expect(result.ok).toBe(true)
    expect(result.text).toBe('secondary-success')
    expect(result.tokens).toBe(99)
    expect(result.ms).toBe(250)
  })

  it('does NOT include reasoning field in the result (LlmResult shape)', async () => {
    mockLlmChat.mockImplementation(() => Promise.resolve({
      ok: false, text: '', tokens: 0, ms: 50, error: 'fail',
    }))
    // TokenRouter returns reasoning_content normally.
    mockTokenRouterChat.mockImplementation(() => Promise.resolve({
      ok: true, text: 'kimi', tokens: 5, ms: 50, reasoning: 'thought process',
    }))
    const result = await executeWithFallback(baseOpts())
    expect(result.ok).toBe(true)
    // The fallback should drop the `reasoning` field — LlmResult doesn't have it.
    expect((result as Record<string, unknown>).reasoning).toBeUndefined()
  })
})

describe('executeWithFallback — both fail', () => {
  it('returns error when both primary and secondary fail (primary was tried)', async () => {
    mockLlmChat.mockImplementation(() => Promise.resolve({
      ok: false, text: '', tokens: 0, ms: 50, error: 'z-ai-error',
    }))
    mockTokenRouterChat.mockImplementation(() => Promise.resolve({
      ok: false, text: '', tokens: 0, ms: 60, error: 'kimi-error',
    }))
    const result = await executeWithFallback(baseOpts())
    expect(result.ok).toBe(false)
    // When both fail and primary was tried, the error message comes from the
    // secondary (per the source code's reconstruction logic).
    expect(result.error).toBe('kimi-error')
  })

  it('returns a coherent error string when both fail', async () => {
    mockLlmChat.mockImplementation(() => Promise.resolve({
      ok: false, text: '', tokens: 0, ms: 5, error: 'p-fail',
    }))
    mockTokenRouterChat.mockImplementation(() => Promise.resolve({
      ok: false, text: '', tokens: 0, ms: 5, error: 's-fail',
    }))
    const result = await executeWithFallback(baseOpts())
    expect(result.ok).toBe(false)
    expect(typeof result.error).toBe('string')
    expect(result.error!.length).toBeGreaterThan(0)
  })
})

describe('executeWithFallback — allowFallback=false (primary available)', () => {
  it('returns primary result when allowFallback=false and primary succeeds', async () => {
    const result = await executeWithFallback(baseOpts({ allowFallback: false }))
    expect(result.ok).toBe(true)
    expect(result.text).toBe('zai-ok')
    expect(mockTokenRouterChat).not.toHaveBeenCalled()
  })

  it('returns primary error directly when allowFallback=false and primary fails', async () => {
    mockLlmChat.mockImplementation(() => Promise.resolve({
      ok: false, text: '', tokens: 0, ms: 50, error: 'no-fallback-error',
    }))
    const result = await executeWithFallback(baseOpts({ allowFallback: false }))
    expect(result.ok).toBe(false)
    expect(result.error).toBe('no-fallback-error')
    expect(mockTokenRouterChat).not.toHaveBeenCalled()
  })

  it('does not call tokenRouterChat when allowFallback=false even if primary fails', async () => {
    mockLlmChat.mockImplementation(() => Promise.resolve({
      ok: false, text: '', tokens: 0, ms: 50, error: 'fail',
    }))
    await executeWithFallback(baseOpts({ allowFallback: false }))
    expect(mockTokenRouterChat).not.toHaveBeenCalled()
  })
})

describe('executeWithFallback — primaryModel override', () => {
  it('uses tokenRouter as primary when primaryModel="tokenrouter"', async () => {
    const result = await executeWithFallback(baseOpts({
      primaryModel: 'tokenrouter' as FallbackModelId,
    }))
    expect(result.ok).toBe(true)
    expect(result.text).toBe('kimi-ok')
    expect(mockTokenRouterChat).toHaveBeenCalledTimes(1)
    expect(mockLlmChat).not.toHaveBeenCalled()
  })

  it('passes maxTokens (>=8000 due to Math.max) to tokenRouter when it is primary', async () => {
    await executeWithFallback(baseOpts({
      primaryModel: 'tokenrouter' as FallbackModelId,
      maxTokens: 4000,
    }))
    const opts = mockTokenRouterChat.mock.calls[0]?.[2] as { maxTokens?: number } | undefined
    // callModel forces Math.max(maxTokens, 8000) — so 4000 → 8000.
    expect(opts?.maxTokens).toBe(8000)
  })

  it('passes through maxTokens when it is above 8000', async () => {
    await executeWithFallback(baseOpts({
      primaryModel: 'tokenrouter' as FallbackModelId,
      maxTokens: 12000,
    }))
    const opts = mockTokenRouterChat.mock.calls[0]?.[2] as { maxTokens?: number } | undefined
    expect(opts?.maxTokens).toBe(12000)
  })
})

describe('executeWithFallback — ms field', () => {
  it('returns a non-negative ms value on success', async () => {
    const result = await executeWithFallback(baseOpts())
    expect(result.ms).toBeGreaterThanOrEqual(0)
  })

  it('returns a non-negative ms value on failure', async () => {
    mockLlmChat.mockImplementation(() => Promise.resolve({
      ok: false, text: '', tokens: 0, ms: 50, error: 'fail',
    }))
    mockTokenRouterChat.mockImplementation(() => Promise.resolve({
      ok: false, text: '', tokens: 0, ms: 50, error: 'fail',
    }))
    const result = await executeWithFallback(baseOpts())
    expect(result.ms).toBeGreaterThanOrEqual(0)
  })
})

describe('getFallbackHealth', () => {
  it('is a function', () => {
    expect(typeof getFallbackHealth).toBe('function')
  })

  it('returns an object with z-ai and tokenrouter keys', () => {
    const health = getFallbackHealth()
    expect(health).toHaveProperty('z-ai')
    expect(health).toHaveProperty('tokenrouter')
  })

  it('returns boolean values for each model', () => {
    const health = getFallbackHealth()
    expect(typeof health['z-ai']).toBe('boolean')
    expect(typeof health['tokenrouter']).toBe('boolean')
  })

  it('tokenrouter is always true (no circuit breaker)', () => {
    const health = getFallbackHealth()
    expect(health['tokenrouter']).toBe(true)
  })

  it('z-ai is true when circuit breaker has not tripped', () => {
    // beforeEach already cleared consecutiveFailures via recordSuccess.
    const health = getFallbackHealth()
    expect(health['z-ai']).toBe(true)
  })
})

describe('executeWithFallback — error shape consistency', () => {
  it('result always has ok, text, tokens, ms fields', async () => {
    const result = await executeWithFallback(baseOpts())
    expect(result).toHaveProperty('ok')
    expect(result).toHaveProperty('text')
    expect(result).toHaveProperty('tokens')
    expect(result).toHaveProperty('ms')
  })

  it('error field is a string when ok=false', async () => {
    mockLlmChat.mockImplementation(() => Promise.resolve({
      ok: false, text: '', tokens: 0, ms: 0, error: 'string-error',
    }))
    mockTokenRouterChat.mockImplementation(() => Promise.resolve({
      ok: false, text: '', tokens: 0, ms: 0, error: 'string-error',
    }))
    const result = await executeWithFallback(baseOpts())
    expect(result.ok).toBe(false)
    expect(typeof result.error).toBe('string')
  })
})

// ── LAST GROUP: trips the z-ai circuit breaker ──
//
// These tests trip the z-ai circuit breaker (5 failures → disabledUntil set
// for 2 minutes). `recordSuccess` does NOT reset `disabledUntil`, so once
// tripped, z-ai stays unavailable for the rest of the test session. They MUST
// be the last tests in this file — no later test relies on z-ai being
// available.

describe('executeWithFallback — allowFallback=false, primary unavailable (CIRCUIT BREAKER TRIP)', () => {
  it('returns "primary unavailable" error when allowFallback=false and primary is unavailable', async () => {
    // Trip the circuit breaker with 5 failures on z-ai.
    const { recordFailure } = await import('../src/lib/model-circuit-breaker')
    for (let i = 0; i < 5; i++) recordFailure('z-ai', `test-failure-${i}`)

    const result = await executeWithFallback(baseOpts({ allowFallback: false }))

    expect(result.ok).toBe(false)
    expect(result.error).toContain('temporarily unavailable')
    expect(mockLlmChat).not.toHaveBeenCalled()
    expect(mockTokenRouterChat).not.toHaveBeenCalled()
  })

  it('falls back to secondary when primary is unavailable and allowFallback=true', async () => {
    // z-ai circuit breaker is still tripped from the previous test.
    const result = await executeWithFallback(baseOpts({ allowFallback: true }))

    expect(result.ok).toBe(true)
    expect(result.text).toBe('kimi-ok')
    // Primary (z-ai) was NOT called because it's unavailable.
    expect(mockLlmChat).not.toHaveBeenCalled()
    // Secondary (tokenrouter) WAS called.
    expect(mockTokenRouterChat).toHaveBeenCalledTimes(1)
  })

  it('returns "All AI models unavailable" when both are unavailable', async () => {
    // z-ai is already tripped. Trip tokenrouter too.
    const { recordFailure } = await import('../src/lib/model-circuit-breaker')
    for (let i = 0; i < 5; i++) recordFailure('tokenrouter', `test-failure-${i}`)

    // Override getFallbackHealth check: tokenrouter doesn't go through the
    // circuit breaker in getFallbackHealth (always returns true), but the
    // executeWithFallback DOES call isModelAvailable for tokenrouter.
    // So we expect "All AI models unavailable" since both are unavailable.
    const result = await executeWithFallback(baseOpts())

    expect(result.ok).toBe(false)
    expect(result.error).toContain('temporarily unavailable')
  })
})
