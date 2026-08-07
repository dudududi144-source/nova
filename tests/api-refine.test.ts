// Comprehensive tests for /api/refine route (SSE streaming)
// Tests: validation, HTML/non-HTML handling, SSE events, rate limiting, error cases
import { describe, expect, test, beforeEach, mock, afterEach, spyOn } from 'bun:test'
import type { NextRequest } from 'next/server'

// ── Mock LLM module ──
const mockLlmChat = mock((_sys: string, _user: string, _opts?: unknown) => Promise.resolve({
  ok: true,
  text: '<!DOCTYPE html><html><head><title>Refined</title></head><body><p>updated</p></body></html>',
  tokens: 200,
  ms: 3000,
}))

// Controllable streaming mock
let mockStreamFn = async function* (_sys: string, _user: string, _opts?: unknown) {
  const fullText = '<!DOCTYPE html><html><head><title>Refined</title></head><body><p>updated</p></body></html>'
  yield { text: fullText, fullText, done: false, tokens: 0, ms: 0 }
  yield { text: '', fullText, done: true, tokens: 200, ms: 3000 }
}

mock.module('@/lib/llm', () => ({
  llmChat: (sys: string, user: string, opts?: unknown) => mockLlmChat(sys, user, opts),
  llmChatStream: (sys: string, user: string, opts?: unknown) => mockStreamFn(sys, user, opts),
}))

// ── Mock DashScope (not configured) ──
mock.module('@/lib/dashscope', () => ({
  isDashScopeConfigured: () => false,
  dashscopeStream: async function* () { yield { text: '', fullText: '', done: true, tokens: 0, ms: 0 } },
  dashscopeChat: async () => ({ ok: false, text: '', tokens: 0, ms: 0 }),
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
function makeRequest(body: unknown): TestRequest {
  return {
    headers: new Map([['x-forwarded-for', `50.0.0.${ipCounter++}`]]),
    // Simulate real request.json(): throws on invalid JSON strings
    json: async () => {
      if (typeof body === 'string') throw new SyntaxError('Unexpected token in JSON')
      return body
    },
    signal: new AbortController().signal,
  }
}

async function readSSE(res: Response): Promise<Record<string, unknown>[]> {
  const reader = res.body?.getReader()
  if (!reader) return []
  const decoder = new TextDecoder()
  let buffer = ''
  const events: Record<string, unknown>[] = []
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const parts = buffer.split('\n\n')
    buffer = parts.pop() ?? ''
    for (const part of parts) {
      const line = part.trim()
      if (line.startsWith('data: ')) {
        try { events.push(JSON.parse(line.slice(6))) } catch {}
      }
    }
  }
  // Flush remaining buffer
  if (buffer.trim().startsWith('data: ')) {
    try { events.push(JSON.parse(buffer.trim().slice(6))) } catch {}
  }
  return events
}

const { POST } = await import('../src/app/api/refine/route')

describe('POST /api/refine — validation rules', () => {
  let logSpy: ReturnType<typeof spyOn>
  let warnSpy: ReturnType<typeof spyOn>
  let errorSpy: ReturnType<typeof spyOn>

  beforeEach(() => {
    mockLlmChat.mockReset()
    mockLlmChat.mockResolvedValue({
      ok: true,
      text: '<!DOCTYPE html><html><head><title>Refined</title></head><body><p>updated</p></body></html>',
      tokens: 200,
      ms: 3000,
    })
    mockStreamFn = async function* (_sys: string, _user: string, _opts?: unknown) {
      const fullText = '<!DOCTYPE html><html><head><title>Refined</title></head><body><p>updated</p></body></html>'
      yield { text: fullText, fullText, done: false, tokens: 0, ms: 0 }
      yield { text: '', fullText, done: true, tokens: 200, ms: 3000 }
    }
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
    const res = await POST(makeRequest({ html: '<html></html>', message: 'change' }) as unknown as NextRequest)
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.ok).toBe(false)
  })

  test('returns 400 for empty mission', async () => {
    const res = await POST(makeRequest({ mission: '', html: '<html></html>', message: 'change' }) as unknown as NextRequest)
    expect(res.status).toBe(400)
  })

  test('returns 400 for whitespace-only mission', async () => {
    const res = await POST(makeRequest({ mission: '   ', html: '<html></html>', message: 'change' }) as unknown as NextRequest)
    expect(res.status).toBe(400)
  })

  test('returns 400 for too-short mission (< 3 chars)', async () => {
    const res = await POST(makeRequest({ mission: 'ab', html: '<html></html>', message: 'change' }) as unknown as NextRequest)
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toContain('short')
  })

  test('returns 400 for too-long mission (> 5000 chars)', async () => {
    const res = await POST(makeRequest({ mission: 'x'.repeat(5001), html: '<html></html>', message: 'change' }) as unknown as NextRequest)
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toContain('long')
  })

  test('returns 400 for missing message', async () => {
    const res = await POST(makeRequest({ mission: 'test', html: '<html></html>' }) as unknown as NextRequest)
    expect(res.status).toBe(400)
  })

  test('returns 400 for empty message', async () => {
    const res = await POST(makeRequest({ mission: 'test', html: '<html></html>', message: '' }) as unknown as NextRequest)
    expect(res.status).toBe(400)
  })

  test('returns 400 for too-short message (< 3 chars)', async () => {
    const res = await POST(makeRequest({ mission: 'test', html: '<html></html>', message: 'ab' }) as unknown as NextRequest)
    expect(res.status).toBe(400)
  })

  test('returns 400 for too-long message (> 5000 chars)', async () => {
    const res = await POST(makeRequest({ mission: 'test', html: '<html></html>', message: 'a'.repeat(5001) }) as unknown as NextRequest)
    expect(res.status).toBe(400)
  })

  test('returns 400 for invalid JSON body', async () => {
    const res = await POST(makeRequest('not-json') as unknown as NextRequest)
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toContain('Invalid JSON')
  })

  test('returns 413 for oversized body (content-length > 200KB)', async () => {
    const bigHtml = 'x'.repeat(250_000)
    const res = await POST({
      headers: new Map([
        ['x-forwarded-for', `50.0.0.${ipCounter++}`],
        ['content-length', String(bigHtml.length + 100)],
      ]),
      json: async () => ({ mission: 'test', html: bigHtml, message: 'change' }),
      signal: new AbortController().signal,
    } as unknown as TestRequest as unknown as NextRequest)
    expect(res.status).toBe(413)
    const data = await res.json()
    expect(data.error).toContain('too large')
  })

  test('returns 400 for mission containing control characters', async () => {
    const res = await POST(makeRequest({ mission: 'hello\x00world', html: '<html></html>', message: 'change' }) as unknown as NextRequest)
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toContain('invalid characters')
  })

  test('accepts empty html (v29.9: non-HTML code is allowed)', async () => {
    // The route no longer validates html — empty html is OK.
    const res = await POST(makeRequest({ mission: 'test', html: '', message: 'change it' }) as unknown as NextRequest)
    expect(res.status).toBe(200)
    const ct = res.headers.get('content-type') ?? ''
    expect(ct).toContain('text/event-stream')
  })
})

describe('POST /api/refine — SSE streaming (HTML output)', () => {
  let logSpy: ReturnType<typeof spyOn>
  let warnSpy: ReturnType<typeof spyOn>
  let errorSpy: ReturnType<typeof spyOn>

  beforeEach(() => {
    mockLlmChat.mockReset()
    mockLlmChat.mockResolvedValue({
      ok: true,
      text: '<!DOCTYPE html><html><head><title>Refined</title></head><body><p>updated</p></body></html>',
      tokens: 200,
      ms: 3000,
    })
    mockStreamFn = async function* (_sys: string, _user: string, _opts?: unknown) {
      const fullText = '<!DOCTYPE html><html><head><title>Refined</title></head><body><p>updated</p></body></html>'
      yield { text: fullText, fullText, done: false, tokens: 0, ms: 0 }
      yield { text: '', fullText, done: true, tokens: 200, ms: 3000 }
    }
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

  test('returns SSE content-type for valid request', async () => {
    const res = await POST(makeRequest({ mission: 'test', html: '<!DOCTYPE html><html></html>', message: 'make it blue' }) as unknown as NextRequest)
    expect(res.status).toBe(200)
    const ct = res.headers.get('content-type') ?? ''
    expect(ct).toContain('text/event-stream')
  })

  test('includes no-cache in Cache-Control header', async () => {
    const res = await POST(makeRequest({ mission: 'test', html: '<!DOCTYPE html><html></html>', message: 'change' }) as unknown as NextRequest)
    const cc = res.headers.get('cache-control') ?? ''
    expect(cc).toContain('no-cache')
  })

  test('includes X-Accel-Buffering: no header', async () => {
    const res = await POST(makeRequest({ mission: 'test', html: '<!DOCTYPE html><html></html>', message: 'change' }) as unknown as NextRequest)
    const xab = res.headers.get('x-accel-buffering') ?? ''
    expect(xab).toBe('no')
  })

  test('streams buildId event first', async () => {
    const res = await POST(makeRequest({ mission: 'test', html: '<!DOCTYPE html><html></html>', message: 'change' }) as unknown as NextRequest)
    const events = await readSSE(res)
    expect(events[0].type).toBe('buildId')
    expect(typeof events[0].buildId).toBe('string')
    expect((events[0].buildId as string).startsWith('refine_')).toBe(true)
  })

  test('SSE events arrive in correct order (buildId first, result last)', async () => {
    const res = await POST(makeRequest({ mission: 'test', html: '<!DOCTYPE html><html></html>', message: 'change' }) as unknown as NextRequest)
    const events = await readSSE(res)
    expect(events.length).toBeGreaterThanOrEqual(2)
    expect(events[0].type).toBe('buildId')
    expect(events[events.length - 1].type).toBe('result')
  })

  test('streams token events during generation', async () => {
    const res = await POST(makeRequest({ mission: 'test', html: '<!DOCTYPE html><html></html>', message: 'change' }) as unknown as NextRequest)
    const events = await readSSE(res)
    const tokenEvents = events.filter(e => e.type === 'token')
    expect(tokenEvents.length).toBeGreaterThanOrEqual(1)
    expect(typeof tokenEvents[0].text).toBe('string')
    expect(typeof tokenEvents[0].length).toBe('number')
  })

  test('streams result event with HTML on success', async () => {
    const res = await POST(makeRequest({ mission: 'test', html: '<!DOCTYPE html><html></html>', message: 'change' }) as unknown as NextRequest)
    const events = await readSSE(res)
    const result = events.find(e => e.type === 'result')
    expect(result).toBeTruthy()
    expect(result?.html).toContain('<!DOCTYPE html>')
    expect(result?.tokens).toBe(200)
    expect(typeof result?.quality).toBe('number')
    expect(typeof result?.metrics).toBe('string')
  })

  test('result event HTML contains CSP meta tag (post-processing)', async () => {
    const res = await POST(makeRequest({ mission: 'test', html: '<!DOCTYPE html><html></html>', message: 'change' }) as unknown as NextRequest)
    const events = await readSSE(res)
    const result = events.find(e => e.type === 'result')
    expect(result?.html).toContain('Content-Security-Policy')
  })

  test('user prompt includes original mission, html, and message', async () => {
    let capturedUserPrompt = ''
    mockStreamFn = async function* (_sys: string, user: string) {
      capturedUserPrompt = user
      const fullText = '<!DOCTYPE html><html><head><title>Refined</title></head><body><p>updated</p></body></html>'
      yield { text: fullText, fullText, done: false, tokens: 0, ms: 0 }
      yield { text: '', fullText, done: true, tokens: 200, ms: 3000 }
    }
    await readSSE(await POST(makeRequest({ mission: 'my mission', html: '<!DOCTYPE html><html></html>', message: 'my change request' }) as unknown as NextRequest))
    expect(capturedUserPrompt).toContain('my mission')
    expect(capturedUserPrompt).toContain('my change request')
    expect(capturedUserPrompt).toContain('<!DOCTYPE html>')
  })

  test('system prompt mentions "refining"', async () => {
    let capturedSystemPrompt = ''
    mockStreamFn = async function* (sys: string, _user: string) {
      capturedSystemPrompt = sys
      const fullText = '<!DOCTYPE html><html><head><title>Refined</title></head><body><p>updated</p></body></html>'
      yield { text: fullText, fullText, done: false, tokens: 0, ms: 0 }
      yield { text: '', fullText, done: true, tokens: 200, ms: 3000 }
    }
    await readSSE(await POST(makeRequest({ mission: 'test', html: '<!DOCTYPE html><html></html>', message: 'change' }) as unknown as NextRequest))
    expect(capturedSystemPrompt.toLowerCase()).toContain('refin')
  })
})

describe('POST /api/refine — non-HTML output handling', () => {
  let logSpy: ReturnType<typeof spyOn>
  let warnSpy: ReturnType<typeof spyOn>
  let errorSpy: ReturnType<typeof spyOn>

  beforeEach(() => {
    mockLlmChat.mockReset()
    mockLlmChat.mockResolvedValue({
      ok: true,
      text: '<!DOCTYPE html><html></html>',
      tokens: 200,
      ms: 3000,
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

  test('handles non-HTML Python output (returns result with outputType=python)', async () => {
    mockStreamFn = async function* () {
      const fullText = 'def hello():\n    print("Hello, World!")\n\nhello()'
      yield { text: fullText, fullText, done: false, tokens: 0, ms: 0 }
      yield { text: '', fullText, done: true, tokens: 100, ms: 2000 }
    }
    const res = await POST(makeRequest({ mission: 'python script', html: 'print("hi")', message: 'add hello function' }) as unknown as NextRequest)
    const events = await readSSE(res)
    const result = events.find(e => e.type === 'result')
    expect(result).toBeTruthy()
    expect(result?.outputType).toBe('python')
    expect(result?.previewable).toBe(false)
    expect(result?.language).toBe('python')
    expect(result?.fileName).toBe('script.py')
  })

  test('handles non-HTML JavaScript output (returns result with outputType=node)', async () => {
    mockStreamFn = async function* () {
      const fullText = 'const x = 42;\nconsole.log(x);'
      yield { text: fullText, fullText, done: false, tokens: 0, ms: 0 }
      yield { text: '', fullText, done: true, tokens: 80, ms: 1500 }
    }
    const res = await POST(makeRequest({ mission: 'node script', html: 'console.log(1)', message: 'change x to 42' }) as unknown as NextRequest)
    const events = await readSSE(res)
    const result = events.find(e => e.type === 'result')
    expect(result).toBeTruthy()
    expect(result?.outputType).toBe('node')
    expect(result?.previewable).toBe(false)
    expect(result?.language).toBe('javascript')
  })

  test('non-HTML result is NOT post-processed (no CSP injection)', async () => {
    mockStreamFn = async function* () {
      const fullText = 'SELECT * FROM users;'
      yield { text: fullText, fullText, done: false, tokens: 0, ms: 0 }
      yield { text: '', fullText, done: true, tokens: 30, ms: 500 }
    }
    const res = await POST(makeRequest({ mission: 'sql query', html: 'SELECT 1', message: 'select all users' }) as unknown as NextRequest)
    const events = await readSSE(res)
    const result = events.find(e => e.type === 'result')
    expect(result?.html).not.toContain('Content-Security-Policy')
  })
})

describe('POST /api/refine — error handling', () => {
  let logSpy: ReturnType<typeof spyOn>
  let warnSpy: ReturnType<typeof spyOn>
  let errorSpy: ReturnType<typeof spyOn>

  beforeEach(() => {
    mockLlmChat.mockReset()
    mockLlmChat.mockResolvedValue({
      ok: true,
      text: '<!DOCTYPE html><html></html>',
      tokens: 200,
      ms: 3000,
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

  test('streams error event when LLM stream fails', async () => {
    mockStreamFn = async function* () {
      yield { text: '', fullText: '', done: true, tokens: 0, ms: 100, error: 'LLM stream error' }
    }
    const res = await POST(makeRequest({ mission: 'test', html: '<!DOCTYPE html><html></html>', message: 'change' }) as unknown as NextRequest)
    const events = await readSSE(res)
    const errorEvent = events.find(e => e.type === 'error')
    expect(errorEvent).toBeTruthy()
    expect(errorEvent?.error).toBe('LLM stream error')
  })

  test('streams error event when LLM returns an error mid-stream', async () => {
    mockStreamFn = async function* () {
      yield { text: '<!DOCTYPE', fullText: '<!DOCTYPE', done: false, tokens: 0, ms: 0 }
      yield { text: '', fullText: '<!DOCTYPE', done: true, tokens: 0, ms: 100, error: 'Connection lost' }
    }
    const res = await POST(makeRequest({ mission: 'test', html: '<!DOCTYPE html><html></html>', message: 'change' }) as unknown as NextRequest)
    const events = await readSSE(res)
    const errorEvent = events.find(e => e.type === 'error')
    expect(errorEvent).toBeTruthy()
    expect(errorEvent?.error).toBe('Connection lost')
  })
})

describe.skip('POST /api/refine — rate limiting', () => {
  let logSpy: ReturnType<typeof spyOn>
  let warnSpy: ReturnType<typeof spyOn>
  let errorSpy: ReturnType<typeof spyOn>

  beforeEach(() => {
    mockLlmChat.mockReset()
    mockLlmChat.mockResolvedValue({
      ok: true,
      text: '<!DOCTYPE html><html></html>',
      tokens: 200,
      ms: 3000,
    })
    mockStreamFn = async function* () {
      const fullText = '<!DOCTYPE html><html><head><title>Refined</title></head><body><p>updated</p></body></html>'
      yield { text: fullText, fullText, done: false, tokens: 0, ms: 0 }
      yield { text: '', fullText, done: true, tokens: 200, ms: 3000 }
    }
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
    const res = await POST(makeRequest({ mission: 'test', html: '<!DOCTYPE html><html></html>', message: 'change' }) as unknown as NextRequest)
    expect(res.status).toBe(429)
    const data = await res.json()
    expect(data.ok).toBe(false)
    expect(data.error).toContain('Rate limited')
  })

  test('does not start SSE stream when rate limited', async () => {
    rateLimitAllowed = false
    const res = await POST(makeRequest({ mission: 'test', html: '<!DOCTYPE html><html></html>', message: 'change' }) as unknown as NextRequest)
    // 429 response should be JSON, not SSE
    const ct = res.headers.get('content-type') ?? ''
    expect(ct).toContain('application/json')
    expect(ct).not.toContain('text/event-stream')
  })

  test('rate limiter uses first IP from x-forwarded-for', async () => {
    await POST({
      headers: new Map([['x-forwarded-for', '203.0.113.55, 5.6.7.8']]),
      json: async () => ({ mission: 'test', html: '<!DOCTYPE html><html></html>', message: 'change' }),
      signal: new AbortController().signal,
    } as unknown as NextRequest)
    const key = mockCheck.mock.calls.at(-1)?.[0]
    expect(key).toBe('203.0.113.55')
  })
})
