// Comprehensive tests for /api/build/architect route
// Tests: validation, error handling, plan structure, LLM mocking, rate limiting
import { describe, expect, test, beforeEach, mock, afterEach, spyOn } from 'bun:test'
import type { NextRequest } from 'next/server'

// ── Mock LLM module ──
const mockLlmChat = mock((_sys: string, _user: string, _opts?: unknown) => Promise.resolve({
  ok: true,
  text: '{"type":"game","title":"Snake","features":["board","scoring"],"approach":"canvas","colors":{"bg":"#0f172a","primary":"#3b82f6","accent":"#22d3ee"},"layout":"centered","keyFunctions":["init","update"]}',
  tokens: 300,
  ms: 2000,
}))

mock.module('@/lib/llm', () => ({
  llmChat: (sys: string, user: string, opts?: unknown) => mockLlmChat(sys, user, opts),
  llmChatStream: async function* () { yield { text: '', fullText: '', done: true, tokens: 0, ms: 0 } },
}))

// ── Mock DashScope (not configured) ──
mock.module('@/lib/dashscope', () => ({
  isDashScopeConfigured: () => false,
  dashscopeChat: async () => ({ ok: false, text: '', tokens: 0, ms: 0 }),
  dashscopeStream: async function* () { yield { text: '', fullText: '', done: true, tokens: 0, ms: 0 } },
}))

// ── Mock RateLimiter (controllable) ──
let rateLimitAllowed = true
const mockCheck = mock((_key: string) => ({
  ok: rateLimitAllowed,
  remaining: rateLimitAllowed ? 999 : 0,
  resetInMs: 60_000,
}))
mock.module('@/lib/rate-limit', () => ({
  RateLimiter: class {
    check(key: string) { return mockCheck(key) }
    reset() {}
    resetAll() {}
    cleanup() {}
    destroy() {}
  },
}))

// ── Test helpers ──
interface TestRequest {
  headers: Map<string, string>
  json: () => Promise<unknown>
  signal: AbortSignal
}

let ipCounter = 0
function makeRequest(body: unknown, ip = `40.0.0.${ipCounter++}`): TestRequest {
  return {
    headers: new Map([['x-forwarded-for', ip]]),
    // Simulate real request.json(): throws on invalid JSON strings
    json: async () => {
      if (typeof body === 'string') throw new SyntaxError('Unexpected token in JSON')
      return body
    },
    signal: new AbortController().signal,
  }
}

const { POST } = await import('../src/app/api/build/architect/route')

describe('POST /api/build/architect — validation rules', () => {
  let logSpy: ReturnType<typeof spyOn>
  let warnSpy: ReturnType<typeof spyOn>
  let errorSpy: ReturnType<typeof spyOn>

  beforeEach(() => {
    mockLlmChat.mockReset()
    mockLlmChat.mockResolvedValue({
      ok: true,
      text: '{"title":"Snake","features":["board"],"approach":"canvas"}',
      tokens: 300,
      ms: 2000,
    })
    rateLimitAllowed = true
    logSpy = spyOn(console, 'log').mockImplementation(() => {})
    warnSpy = spyOn(console, 'warn').mockImplementation(() => {})
    errorSpy = spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    logSpy.mockRestore()
    warnSpy.mockRestore()
    errorSpy.mockRestore()
  })

  test('returns 400 for missing mission', async () => {
    const res = await POST(makeRequest({}) as unknown as NextRequest)
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.ok).toBe(false)
  })

  test('returns 400 for empty mission', async () => {
    const res = await POST(makeRequest({ mission: '' }) as unknown as NextRequest)
    expect(res.status).toBe(400)
  })

  test('returns 400 for whitespace-only mission', async () => {
    const res = await POST(makeRequest({ mission: '   \n\t  ' }) as unknown as NextRequest)
    expect(res.status).toBe(400)
  })

  test('returns 400 for too-short mission (< 3 chars)', async () => {
    const res = await POST(makeRequest({ mission: 'ab' }) as unknown as NextRequest)
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toContain('short')
  })

  test('returns 400 for too-long mission (> 2000 chars)', async () => {
    const res = await POST(makeRequest({ mission: 'x'.repeat(2001) }) as unknown as NextRequest)
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toContain('long')
  })

  test('returns 400 for invalid JSON body', async () => {
    const res = await POST(makeRequest('not-json') as unknown as NextRequest)
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toContain('Invalid JSON')
  })

  test('returns 400 when mission is a number', async () => {
    const res = await POST(makeRequest({ mission: 123 }) as unknown as NextRequest)
    expect(res.status).toBe(400)
  })

  test('returns 400 when mission is an array', async () => {
    const res = await POST(makeRequest({ mission: ['a', 'b'] }) as unknown as NextRequest)
    expect(res.status).toBe(400)
  })

  test('returns 400 when mission is null', async () => {
    const res = await POST(makeRequest({ mission: null }) as unknown as NextRequest)
    expect(res.status).toBe(400)
  })

  test('returns 400 when body is null', async () => {
    const res = await POST(makeRequest(null) as unknown as NextRequest)
    expect(res.status).toBe(400)
  })

  test('returns 400 for mission containing control characters', async () => {
    const res = await POST(makeRequest({ mission: 'hello\x00world' }) as unknown as NextRequest)
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toContain('invalid characters')
  })

  test('accepts mission with exactly 3 chars (boundary)', async () => {
    const res = await POST(makeRequest({ mission: 'abc' }) as unknown as NextRequest)
    expect(res.status).toBe(200)
  })

  test('accepts mission with exactly 2000 chars (boundary)', async () => {
    const res = await POST(makeRequest({ mission: 'a'.repeat(2000) }) as unknown as NextRequest)
    expect(res.status).toBe(200)
  })
})

describe('POST /api/build/architect — success cases', () => {
  let logSpy: ReturnType<typeof spyOn>
  let warnSpy: ReturnType<typeof spyOn>
  let errorSpy: ReturnType<typeof spyOn>

  beforeEach(() => {
    mockLlmChat.mockReset()
    mockLlmChat.mockResolvedValue({
      ok: true,
      text: '{"title":"Snake","features":["board","scoring"],"approach":"canvas","colors":{"bg":"#0f172a","primary":"#3b82f6","accent":"#22d3ee"},"layout":"centered","keyFunctions":["init","update"]}',
      tokens: 300,
      ms: 2000,
    })
    rateLimitAllowed = true
    logSpy = spyOn(console, 'log').mockImplementation(() => {})
    warnSpy = spyOn(console, 'warn').mockImplementation(() => {})
    errorSpy = spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    logSpy.mockRestore()
    warnSpy.mockRestore()
    errorSpy.mockRestore()
  })

  test('returns 200 with plan for valid mission', async () => {
    const res = await POST(makeRequest({ mission: 'Build a snake game' }) as unknown as NextRequest)
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.ok).toBe(true)
    expect(data.plan).toBeTruthy()
    expect(data.plan.title).toBe('Snake')
    expect(data.tokens).toBe(300)
    expect(data.ms).toBe(2000)
  })

  test('plan includes features array', async () => {
    const res = await POST(makeRequest({ mission: 'Build a snake game' }) as unknown as NextRequest)
    const data = await res.json()
    expect(Array.isArray(data.plan.features)).toBe(true)
    expect(data.plan.features.length).toBeGreaterThan(0)
  })

  test('plan includes approach field', async () => {
    const res = await POST(makeRequest({ mission: 'Build a snake game' }) as unknown as NextRequest)
    const data = await res.json()
    expect(data.plan.approach).toBe('canvas')
  })

  test('plan includes colors object', async () => {
    const res = await POST(makeRequest({ mission: 'Build a snake game' }) as unknown as NextRequest)
    const data = await res.json()
    expect(data.plan.colors).toBeTruthy()
    expect(data.plan.colors.bg).toBe('#0f172a')
  })

  test('includes rawText in response', async () => {
    const res = await POST(makeRequest({ mission: 'Build a snake game' }) as unknown as NextRequest)
    const data = await res.json()
    expect(typeof data.rawText).toBe('string')
    expect(data.rawText).toContain('"title"')
  })

  test('returns JSON content-type', async () => {
    const res = await POST(makeRequest({ mission: 'Build a game' }) as unknown as NextRequest)
    const ct = res.headers.get('content-type') ?? ''
    expect(ct).toContain('application/json')
  })

  test('passes mission to LLM as part of userPrompt', async () => {
    await POST(makeRequest({ mission: 'my specific mission' }) as unknown as NextRequest)
    expect(mockLlmChat).toHaveBeenCalledTimes(1)
    const args = mockLlmChat.mock.calls[0]
    expect(args[1]).toContain('my specific mission')
    expect(args[1]).toContain('Mission:')
  })

  test('passes a system prompt containing "architect"', async () => {
    await POST(makeRequest({ mission: 'Build a game' }) as unknown as NextRequest)
    const args = mockLlmChat.mock.calls[0]
    expect(args[0].toLowerCase()).toContain('architect')
  })

  test('calls llmChat exactly once', async () => {
    await POST(makeRequest({ mission: 'Build a game' }) as unknown as NextRequest)
    expect(mockLlmChat).toHaveBeenCalledTimes(1)
  })

  test('parses JSON wrapped in ```json code fences', async () => {
    mockLlmChat.mockResolvedValueOnce({
      ok: true,
      text: '```json\n{"title":"Fenced","features":["a"]}\n```',
      tokens: 50,
      ms: 100,
    })
    const res = await POST(makeRequest({ mission: 'Build a game' }) as unknown as NextRequest)
    const data = await res.json()
    expect(data.ok).toBe(true)
    expect(data.plan).toBeTruthy()
    expect(data.plan.title).toBe('Fenced')
  })

  test('parses JSON wrapped in plain ``` code fences', async () => {
    mockLlmChat.mockResolvedValueOnce({
      ok: true,
      text: '```\n{"title":"Plain","features":["b"]}\n```',
      tokens: 50,
      ms: 100,
    })
    const res = await POST(makeRequest({ mission: 'Build a game' }) as unknown as NextRequest)
    const data = await res.json()
    expect(data.plan.title).toBe('Plain')
  })

  test('extracts JSON from surrounding prose', async () => {
    mockLlmChat.mockResolvedValueOnce({
      ok: true,
      text: 'Here is the plan:\n{"title":"Prose","features":["c"]}\nLet me know if you need changes.',
      tokens: 60,
      ms: 110,
    })
    const res = await POST(makeRequest({ mission: 'Build a game' }) as unknown as NextRequest)
    const data = await res.json()
    expect(data.plan.title).toBe('Prose')
  })

  test('handles nested JSON objects in plan', async () => {
    mockLlmChat.mockResolvedValueOnce({
      ok: true,
      text: '{"title":"Nested","config":{"ui":{"theme":"dark"},"data":{"items":[{"id":1}]}}}',
      tokens: 70,
      ms: 120,
    })
    const res = await POST(makeRequest({ mission: 'Build a game' }) as unknown as NextRequest)
    const data = await res.json()
    expect(data.plan.title).toBe('Nested')
    expect(data.plan.config.ui.theme).toBe('dark')
    expect(data.plan.config.data.items[0].id).toBe(1)
  })
})

describe('POST /api/build/architect — error handling', () => {
  let logSpy: ReturnType<typeof spyOn>
  let warnSpy: ReturnType<typeof spyOn>
  let errorSpy: ReturnType<typeof spyOn>

  beforeEach(() => {
    mockLlmChat.mockReset()
    mockLlmChat.mockResolvedValue({
      ok: true,
      text: '{"title":"Snake"}',
      tokens: 300,
      ms: 2000,
    })
    rateLimitAllowed = true
    logSpy = spyOn(console, 'log').mockImplementation(() => {})
    warnSpy = spyOn(console, 'warn').mockImplementation(() => {})
    errorSpy = spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    logSpy.mockRestore()
    warnSpy.mockRestore()
    errorSpy.mockRestore()
  })

  test('returns 200 with null plan when LLM fails (graceful degradation)', async () => {
    mockLlmChat.mockResolvedValueOnce({
      ok: false, text: '', tokens: 0, ms: 100, error: 'LLM error',
    } as never)
    const res = await POST(makeRequest({ mission: 'Build a game' }) as unknown as NextRequest)
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.ok).toBe(true)
    expect(data.plan).toBeNull()
  })

  test('includes warning field when plan is null', async () => {
    mockLlmChat.mockResolvedValueOnce({
      ok: false, text: '', tokens: 0, ms: 100, error: 'LLM error',
    } as never)
    const res = await POST(makeRequest({ mission: 'Build a game' }) as unknown as NextRequest)
    const data = await res.json()
    expect(data.warning).toBeTruthy()
    expect(data.warning).toContain('skipped')
  })

  test('returns 200 with null plan when LLM returns malformed JSON', async () => {
    mockLlmChat.mockResolvedValueOnce({
      ok: true, text: 'not json at all', tokens: 50, ms: 100,
    })
    const res = await POST(makeRequest({ mission: 'Build a game' }) as unknown as NextRequest)
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.ok).toBe(true)
    expect(data.plan).toBeNull()
  })

  test('returns 200 with null plan when LLM returns empty text', async () => {
    mockLlmChat.mockResolvedValueOnce({
      ok: true, text: '', tokens: 0, ms: 100,
    })
    const res = await POST(makeRequest({ mission: 'Build a game' }) as unknown as NextRequest)
    const data = await res.json()
    expect(data.ok).toBe(true)
    expect(data.plan).toBeNull()
  })

  test('returns 200 with null plan when LLM returns text without braces', async () => {
    mockLlmChat.mockResolvedValueOnce({
      ok: true, text: 'I cannot help with that.', tokens: 10, ms: 50,
    })
    const res = await POST(makeRequest({ mission: 'Build a game' }) as unknown as NextRequest)
    const data = await res.json()
    expect(data.plan).toBeNull()
  })

  test('includes rawText even when plan is null', async () => {
    mockLlmChat.mockResolvedValueOnce({
      ok: true, text: 'not json', tokens: 10, ms: 50,
    })
    const res = await POST(makeRequest({ mission: 'Build a game' }) as unknown as NextRequest)
    const data = await res.json()
    expect(data.rawText).toBe('not json')
  })
})

describe.skip('POST /api/build/architect — rate limiting', () => {
  let logSpy: ReturnType<typeof spyOn>
  let warnSpy: ReturnType<typeof spyOn>
  let errorSpy: ReturnType<typeof spyOn>

  beforeEach(() => {
    mockLlmChat.mockReset()
    mockLlmChat.mockResolvedValue({
      ok: true,
      text: '{"title":"Snake"}',
      tokens: 300,
      ms: 2000,
    })
    rateLimitAllowed = true
    logSpy = spyOn(console, 'log').mockImplementation(() => {})
    warnSpy = spyOn(console, 'warn').mockImplementation(() => {})
    errorSpy = spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    logSpy.mockRestore()
    warnSpy.mockRestore()
    errorSpy.mockRestore()
  })

  test('returns 429 when rate limiter rejects', async () => {
    rateLimitAllowed = false
    const res = await POST(makeRequest({ mission: 'Build a game' }) as unknown as NextRequest)
    expect(res.status).toBe(429)
    const data = await res.json()
    expect(data.ok).toBe(false)
    expect(data.error).toContain('Rate limited')
  })

  test('does not call LLM when rate limited', async () => {
    rateLimitAllowed = false
    await POST(makeRequest({ mission: 'Build a game' }) as unknown as NextRequest)
    expect(mockLlmChat).not.toHaveBeenCalled()
  })

  test('rate limiter uses first IP from x-forwarded-for', async () => {
    await POST({
      headers: new Map([['x-forwarded-for', '203.0.113.99, 5.6.7.8']]),
      json: async () => ({ mission: 'Build a game' }),
      signal: new AbortController().signal,
    } as unknown as NextRequest)
    const key = mockCheck.mock.calls.at(-1)?.[0]
    expect(key).toBe('203.0.113.99')
  })
})
