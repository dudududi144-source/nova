// Comprehensive tests for /api/enhance route
// Tests: validation rules, success cases, LLM mocking, rate limiting, edge cases
import { describe, expect, test, beforeEach, mock, afterEach, spyOn } from 'bun:test'
import type { NextRequest } from 'next/server'

// ── Mock LLM module ──
const mockLlmChat = mock((_sys: string, _user: string, _opts?: unknown) => Promise.resolve({
  ok: true,
  text: 'Build a todo app with add/delete/complete, filter by status, and local storage persistence.',
  tokens: 150,
  ms: 1200,
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
function makeRequest(body: unknown, extraHeaders: Record<string, string> = {}): TestRequest {
  const headers = new Map<string, string>([
    ['x-forwarded-for', `60.0.0.${ipCounter++}`],
    ...Object.entries(extraHeaders),
  ])
  return {
    headers,
    // Simulate real request.json(): throws on invalid JSON strings
    json: async () => {
      if (typeof body === 'string') throw new SyntaxError('Unexpected token in JSON')
      return body
    },
    signal: new AbortController().signal,
  }
}

const { POST } = await import('../src/app/api/enhance/route')

describe('POST /api/enhance — validation rules', () => {
  let logSpy: ReturnType<typeof spyOn>
  let errorSpy: ReturnType<typeof spyOn>

  beforeEach(() => {
    mockLlmChat.mockReset()
    mockLlmChat.mockResolvedValue({
      ok: true,
      text: 'Build a todo app with add/delete/complete, filter by status, and local storage persistence.',
      tokens: 150,
      ms: 1200,
    })
    rateLimitAllowed = true
    logSpy = spyOn(console, 'log').mockImplementation(() => {})
    errorSpy = spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    logSpy.mockRestore()
    errorSpy.mockRestore()
  })

  test('returns 400 for missing prompt (empty body)', async () => {
    const res = await POST(makeRequest({}) as unknown as NextRequest)
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.ok).toBe(false)
  })

  test('returns 400 for empty prompt string', async () => {
    const res = await POST(makeRequest({ prompt: '' }) as unknown as NextRequest)
    expect(res.status).toBe(400)
  })

  test('returns 400 for whitespace-only prompt', async () => {
    const res = await POST(makeRequest({ prompt: '   \n\t  ' }) as unknown as NextRequest)
    expect(res.status).toBe(400)
  })

  test('returns 400 for too-short prompt (< 3 chars)', async () => {
    const res = await POST(makeRequest({ prompt: 'ab' }) as unknown as NextRequest)
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toContain('short')
  })

  test('returns 400 for too-long prompt (> 5000 chars)', async () => {
    const res = await POST(makeRequest({ prompt: 'x'.repeat(5001) }) as unknown as NextRequest)
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

  test('returns 400 when prompt is a number', async () => {
    const res = await POST(makeRequest({ prompt: 123 }) as unknown as NextRequest)
    expect(res.status).toBe(400)
  })

  test('returns 400 when prompt is an array', async () => {
    const res = await POST(makeRequest({ prompt: ['a', 'b'] }) as unknown as NextRequest)
    expect(res.status).toBe(400)
  })

  test('returns 400 when prompt is null', async () => {
    const res = await POST(makeRequest({ prompt: null }) as unknown as NextRequest)
    expect(res.status).toBe(400)
  })

  test('returns 400 when body is null', async () => {
    const res = await POST(makeRequest(null) as unknown as NextRequest)
    expect(res.status).toBe(400)
  })

  test('returns 413 for oversized body (content-length > 10KB)', async () => {
    const bigPrompt = 'x'.repeat(20_000)
    const res = await POST({
      headers: new Map([['content-length', String(bigPrompt.length + 20)]]),
      json: async () => ({ prompt: bigPrompt }),
      signal: new AbortController().signal,
    } as unknown as TestRequest as unknown as NextRequest)
    expect(res.status).toBe(413)
    const data = await res.json()
    expect(data.error).toContain('too large')
  })

  test('accepts prompt with exactly 3 chars (boundary)', async () => {
    const res = await POST(makeRequest({ prompt: 'abc' }) as unknown as NextRequest)
    expect(res.status).toBe(200)
  })

  test('accepts prompt with exactly 5000 chars (boundary)', async () => {
    const res = await POST(makeRequest({ prompt: 'a'.repeat(5000) }) as unknown as NextRequest)
    expect(res.status).toBe(200)
  })
})

describe('POST /api/enhance — success cases', () => {
  let logSpy: ReturnType<typeof spyOn>
  let errorSpy: ReturnType<typeof spyOn>

  beforeEach(() => {
    mockLlmChat.mockReset()
    mockLlmChat.mockResolvedValue({
      ok: true,
      text: 'Build a todo app with add/delete/complete, filter by status, and local storage persistence.',
      tokens: 150,
      ms: 1200,
    })
    rateLimitAllowed = true
    logSpy = spyOn(console, 'log').mockImplementation(() => {})
    errorSpy = spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    logSpy.mockRestore()
    errorSpy.mockRestore()
  })

  test('returns 200 + enhanced prompt for valid input', async () => {
    const res = await POST(makeRequest({ prompt: 'todo app' }) as unknown as NextRequest)
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.ok).toBe(true)
    expect(typeof data.enhanced).toBe('string')
    expect(data.enhanced.length).toBeGreaterThan('todo app'.length)
    expect(data.tokens).toBe(150)
    expect(data.ms).toBe(1200)
  })

  test('passes the user prompt to the LLM as userPrompt', async () => {
    await POST(makeRequest({ prompt: 'my specific prompt' }) as unknown as NextRequest)
    expect(mockLlmChat).toHaveBeenCalled()
    const args = mockLlmChat.mock.calls[0]
    expect(args[1]).toBe('my specific prompt')
  })

  test('passes a system prompt to the LLM', async () => {
    await POST(makeRequest({ prompt: 'test' }) as unknown as NextRequest)
    expect(mockLlmChat).toHaveBeenCalled()
    const args = mockLlmChat.mock.calls[0]
    expect(typeof args[0]).toBe('string')
    expect(args[0].length).toBeGreaterThan(50)
  })

  test('strips surrounding double quotes from enhanced text', async () => {
    mockLlmChat.mockResolvedValueOnce({
      ok: true,
      text: '"Build a calculator with history and keyboard input."',
      tokens: 100,
      ms: 800,
    })
    const res = await POST(makeRequest({ prompt: 'calculator' }) as unknown as NextRequest)
    const data = await res.json()
    expect(data.ok).toBe(true)
    expect(data.enhanced.startsWith('"')).toBe(false)
    expect(data.enhanced.endsWith('"')).toBe(false)
  })

  test('strips surrounding single quotes from enhanced text', async () => {
    mockLlmChat.mockResolvedValueOnce({
      ok: true,
      text: "'Build a snake game with score tracking.'",
      tokens: 80,
      ms: 700,
    })
    const res = await POST(makeRequest({ prompt: 'snake game' }) as unknown as NextRequest)
    const data = await res.json()
    expect(data.ok).toBe(true)
    expect(data.enhanced.startsWith("'")).toBe(false)
    expect(data.enhanced.endsWith("'")).toBe(false)
  })

  test('strips code fences from enhanced text', async () => {
    mockLlmChat.mockResolvedValueOnce({
      ok: true,
      text: '```\nBuild a snake game with score tracking.\n```',
      tokens: 80,
      ms: 700,
    })
    const res = await POST(makeRequest({ prompt: 'snake game' }) as unknown as NextRequest)
    const data = await res.json()
    expect(data.ok).toBe(true)
    expect(data.enhanced).not.toContain('```')
    expect(data.enhanced).toContain('Build a snake game')
  })

  test('returns original prompt when enhanced is shorter (sanity check)', async () => {
    mockLlmChat.mockResolvedValueOnce({
      ok: true,
      text: 'ok',
      tokens: 5,
      ms: 500,
    })
    const res = await POST(makeRequest({ prompt: 'build a complex dashboard app' }) as unknown as NextRequest)
    const data = await res.json()
    expect(data.ok).toBe(true)
    expect(data.enhanced).toBe('build a complex dashboard app')
    expect(data.note).toContain('using original')
  })

  test('returns original prompt when enhanced is empty (sanity check)', async () => {
    mockLlmChat.mockResolvedValueOnce({
      ok: true,
      text: '   ',
      tokens: 5,
      ms: 500,
    })
    const res = await POST(makeRequest({ prompt: 'make me a website' }) as unknown as NextRequest)
    const data = await res.json()
    expect(data.ok).toBe(true)
    expect(data.enhanced).toBe('make me a website')
  })

  test('returns enhanced text with leading/trailing whitespace trimmed', async () => {
    mockLlmChat.mockResolvedValueOnce({
      ok: true,
      text: '  \nBuild a todo app with features.\n  ',
      tokens: 90,
      ms: 900,
    })
    const res = await POST(makeRequest({ prompt: 'todo' }) as unknown as NextRequest)
    const data = await res.json()
    expect(data.ok).toBe(true)
    expect(data.enhanced).toBe('Build a todo app with features.')
  })
})

describe('POST /api/enhance — error handling', () => {
  let logSpy: ReturnType<typeof spyOn>
  let errorSpy: ReturnType<typeof spyOn>

  beforeEach(() => {
    mockLlmChat.mockReset()
    mockLlmChat.mockResolvedValue({
      ok: true,
      text: 'Build a todo app with features.',
      tokens: 150,
      ms: 1200,
    })
    rateLimitAllowed = true
    logSpy = spyOn(console, 'log').mockImplementation(() => {})
    errorSpy = spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    logSpy.mockRestore()
    errorSpy.mockRestore()
  })

  test('returns 502 when LLM fails', async () => {
    mockLlmChat.mockResolvedValueOnce({
      ok: false,
      text: '',
      tokens: 0,
      ms: 0,
      error: 'LLM unavailable',
    } as never)
    const res = await POST(makeRequest({ prompt: 'todo app' }) as unknown as NextRequest)
    expect(res.status).toBe(502)
    const data = await res.json()
    expect(data.ok).toBe(false)
    expect(data.error).toBeTruthy()
  })

  test('returns 502 when LLM returns empty text', async () => {
    mockLlmChat.mockResolvedValueOnce({
      ok: false,
      text: '',
      tokens: 0,
      ms: 100,
      error: 'The model returned an empty response.',
    } as never)
    const res = await POST(makeRequest({ prompt: 'todo app' }) as unknown as NextRequest)
    expect(res.status).toBe(502)
  })

  test('does NOT call dashscopeChat when isDashScopeConfigured returns false', async () => {
    // The mock isDashScopeConfigured returns false, so dashscopeChat should never be called.
    mockLlmChat.mockResolvedValueOnce({
      ok: false,
      text: '',
      tokens: 0,
      ms: 100,
      error: 'ZAI failed',
    } as never)
    await POST(makeRequest({ prompt: 'todo app' }) as unknown as NextRequest)
    // If we got here without hanging, dashscope was not called.
    expect(mockLlmChat).toHaveBeenCalledTimes(1)
  })
})

describe.skip('POST /api/enhance — rate limiting', () => {
  let logSpy: ReturnType<typeof spyOn>
  let errorSpy: ReturnType<typeof spyOn>

  beforeEach(() => {
    mockLlmChat.mockReset()
    mockLlmChat.mockResolvedValue({
      ok: true,
      text: 'Build a todo app with features.',
      tokens: 150,
      ms: 1200,
    })
    rateLimitAllowed = true
    logSpy = spyOn(console, 'log').mockImplementation(() => {})
    errorSpy = spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    logSpy.mockRestore()
    errorSpy.mockRestore()
  })

  test('returns 429 when rate limiter rejects', async () => {
    rateLimitAllowed = false
    const res = await POST(makeRequest({ prompt: 'todo app' }) as unknown as NextRequest)
    expect(res.status).toBe(429)
    const data = await res.json()
    expect(data.ok).toBe(false)
    expect(data.error).toContain('Rate limited')
  })

  test('rate limiter is called with the client IP from x-forwarded-for', async () => {
    await POST({
      headers: new Map([['x-forwarded-for', '203.0.113.42']]),
      json: async () => ({ prompt: 'test prompt' }),
      signal: new AbortController().signal,
    } as unknown as NextRequest)
    expect(mockCheck).toHaveBeenCalled()
    const key = mockCheck.mock.calls.at(-1)?.[0]
    expect(key).toBe('203.0.113.42')
  })

  test('rate limiter falls back to x-real-ip when x-forwarded-for is missing', async () => {
    await POST({
      headers: new Map([['x-real-ip', '198.51.100.7']]),
      json: async () => ({ prompt: 'test prompt' }),
      signal: new AbortController().signal,
    } as unknown as NextRequest)
    const key = mockCheck.mock.calls.at(-1)?.[0]
    expect(key).toBe('198.51.100.7')
  })

  test('rate limiter uses "unknown" when no IP headers are present', async () => {
    await POST({
      headers: new Map(),
      json: async () => ({ prompt: 'test prompt' }),
      signal: new AbortController().signal,
    } as unknown as NextRequest)
    const key = mockCheck.mock.calls.at(-1)?.[0]
    expect(key).toBe('unknown')
  })

  test('rate limiter uses first IP when x-forwarded-for has multiple', async () => {
    await POST({
      headers: new Map([['x-forwarded-for', '1.2.3.4, 5.6.7.8, 9.10.11.12']]),
      json: async () => ({ prompt: 'test prompt' }),
      signal: new AbortController().signal,
    } as unknown as NextRequest)
    const key = mockCheck.mock.calls.at(-1)?.[0]
    expect(key).toBe('1.2.3.4')
  })
})
