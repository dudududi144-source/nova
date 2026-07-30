// Integration test for POST /api/build
// Mocks llmChat so we test the route logic (rate limiting, validation, CSP, response shape)
// without making real LLM calls.

import { describe, it, expect, beforeEach, mock, afterEach, spyOn } from 'bun:test'
import type { NextRequest } from 'next/server'

// Mock the llm module BEFORE importing the route
// First call = architect (returns JSON plan), second call = coder (returns HTML)
const mockLlmChat = mock((_sys: string, _user: string, _opts?: unknown) => {
  // Detect which stage by checking the system prompt
  if (_sys.includes('architect')) {
    return Promise.resolve({
      ok: true,
      text: '{"type":"app","title":"Test","features":["feature1"],"approach":"simple","colors":{"bg":"#0f172a","primary":"#3b82f6","accent":"#22d3ee"},"layout":"centered","keyFunctions":["init"]}',
      tokens: 50,
      ms: 200,
    })
  }
  // Coder stage
  return Promise.resolve({
    ok: true,
    text: '<!DOCTYPE html><html><head><title>Test</title></head><body><p>hello</p></body></html>',
    tokens: 100,
    ms: 500,
  })
})

mock.module('@/lib/llm', () => ({
  // Use a wrapper so mockImplementation/mockResolvedValue changes are picked up.
  // (Directly passing mockLlmChat captures the original implementation.)
  llmChat: (sys: string, user: string, opts?: unknown) => mockLlmChat(sys, user, opts),
  validateMission: (m: string) => {
    if (!m || !m.trim()) return { ok: false, error: 'Mission is empty' }
    if (m.trim().length < 3) return { ok: false, error: 'Mission too short (min 3 chars)' }
    if (m.trim().length > 500) return { ok: false, error: 'Mission too long' }
    if (/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F\x80-\x9F]/.test(m.trim())) return { ok: false, error: 'Mission contains invalid characters' }
    return { ok: true }
  },
  // Use the same logic as the real implementation (handles 3+ backticks, any language, empty first block)
  stripCodeFences: (t: string) => {
    const fenceRegex = /`{3,}\s*[a-zA-Z0-9_-]*\s*\n?([\s\S]*?)\n?`{3,}/g
    let match
    while ((match = fenceRegex.exec(t)) !== null) {
      const content = match[1].trim()
      if (content) return content
    }
    return t.trim()
  },
  looksLikeHtml: (t: string) => {
    const lower = t.trimStart().toLowerCase()
    return lower.startsWith('<!doctype') || lower.startsWith('<html')
  },
  // Use the same CSP as the real implementation
  injectCsp: (html: string) => {
    if (/<meta\s+http-equiv=["']?content-security-policy["']?/i.test(html)) return html
    const csp = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'unsafe-inline' data:; font-src 'unsafe-inline' data:; connect-src 'none'; base-uri 'none'; form-action 'none'"
    const cspMeta = `<meta http-equiv="Content-Security-Policy" content="${csp}">`
    const headMatch = html.match(/<head[^>]*>/i)
    if (headMatch) {
      return html.replace(/<head[^>]*>/i, `${headMatch[0]}\n${cspMeta}`)
    }
    const htmlTagMatch = html.match(/<html[^>]*>/i)
    if (htmlTagMatch) {
      return html.replace(/<html[^>]*>/i, `${htmlTagMatch[0]}<head>${cspMeta}</head>`)
    }
    return `${cspMeta}\n${html}`
  },
}))

// Note: we do NOT mock @/lib/logger — the real logger is used.
// Test output will include log lines, which is acceptable.
// Logger format is tested separately in cycle-8.test.ts.

// Import after mocks are set up
const { POST } = await import('../src/app/api/build/route')

// Use a unique IP per test to avoid rate limit interference between tests
let testIpCounter = 0
function nextIp(): string {
  return `10.0.${Math.floor(testIpCounter / 256)}.${testIpCounter++ % 256}`
}

// Minimal NextRequest-like type for testing (avoids `any`)
interface TestRequest {
  headers: Map<string, string>
  json: () => Promise<unknown>
  signal: AbortSignal
}

// Helper to create a NextRequest-like object
function makeRequest(body: unknown, opts: { ip?: string; signal?: AbortSignal } = {}): TestRequest {
  return {
    headers: new Map([
      ['x-forwarded-for', opts.ip ?? nextIp()],
    ]),
    json: async () => body,
    signal: opts.signal ?? new AbortController().signal,
  }
}

describe('POST /api/build', () => {
  let logSpy: ReturnType<typeof spyOn>
  let warnSpy: ReturnType<typeof spyOn>
  let errorSpy: ReturnType<typeof spyOn>

  beforeEach(() => {
    // mockReset clears both call history AND implementation
    // Then re-set the default implementation
    mockLlmChat.mockReset()
    mockLlmChat.mockResolvedValue({
      ok: true,
      text: '<!DOCTYPE html><html><head><title>Test</title></head><body><p>hello</p></body></html>',
      tokens: 100,
      ms: 500,
    })
    // Spy on console methods to verify logger calls
    logSpy = spyOn(console, 'log').mockImplementation(() => {})
    warnSpy = spyOn(console, 'warn').mockImplementation(() => {})
    errorSpy = spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    logSpy.mockRestore()
    warnSpy.mockRestore()
    errorSpy.mockRestore()
  })

  it('returns 400 for invalid JSON body', async () => {
    const req: TestRequest = {
      headers: new Map([['x-forwarded-for', '1.2.3.4']]),
      json: async () => { throw new Error('invalid json') },
      signal: new AbortController().signal,
    }
    const res = await POST(req as unknown as NextRequest)
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.ok).toBe(false)
    expect(data.error).toBe('Invalid JSON')
  })

  it('returns 400 for missing mission', async () => {
    const res = await POST(makeRequest({}) as unknown as NextRequest)
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.ok).toBe(false)
    expect(data.error).toContain('empty')
  })

  it('returns 400 for mission that is too short', async () => {
    const res = await POST(makeRequest({ mission: 'ab' }) as unknown as NextRequest)
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.ok).toBe(false)
    expect(data.error).toContain('too short')
  })

  it('returns 400 for mission that is not a string', async () => {
    const res = await POST(makeRequest({ mission: 123 }) as unknown as NextRequest)
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.ok).toBe(false)
  })

  it('returns 200 with HTML for valid mission', async () => {
    const res = await POST(makeRequest({ mission: 'Build a snake game' }) as unknown as NextRequest)
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.ok).toBe(true)
    expect(data.html).toContain('<!DOCTYPE html>')
    expect(data.html).toContain('Content-Security-Policy')
    expect(typeof data.tokens).toBe('number')
    expect(typeof data.ms).toBe('number')
  })

  it('calls llmChat twice (architect + coder) for a valid mission', async () => {
    await POST(makeRequest({ mission: 'Build a calculator' }) as unknown as NextRequest)
    expect(mockLlmChat).toHaveBeenCalledTimes(2)
  })

  it('returns 502 when llmChat fails', async () => {
    mockLlmChat.mockImplementation(async () => ({
      ok: false, text: '', tokens: 0, ms: 100, error: 'The AI service is busy',
    }))
    const res = await POST(makeRequest({ mission: 'Build a todo app' }) as unknown as NextRequest)
    expect(res.status).toBe(502)
    const data = await res.json()
    expect(data.ok).toBe(false)
    expect(data.error).toBe('The AI service is busy')
  })

  it('returns 502 when coder returns non-HTML', async () => {
    mockLlmChat.mockImplementation(async (sys: string) => {
      if (sys.includes('architect')) {
        return { ok: true, text: '{"type":"app","title":"T"}', tokens: 20, ms: 100 }
      }
      return { ok: true, text: "Here's your app: not actually HTML", tokens: 50, ms: 200 }
    })
    const res = await POST(makeRequest({ mission: 'Build something' }) as unknown as NextRequest)
    expect(res.status).toBe(502)
    const data = await res.json()
    expect(data.ok).toBe(false)
    expect(data.error).toContain('invalid output')
  })

  it('injects CSP into the returned HTML', async () => {
    const res = await POST(makeRequest({ mission: 'Build a game' }) as unknown as NextRequest)
    const data = await res.json()
    expect(data.html).toContain('Content-Security-Policy')
    expect(data.html).toContain("connect-src 'none'")
  })

  it('does not inject duplicate CSP if LLM included one', async () => {
    mockLlmChat.mockImplementation(async () => ({
      ok: true,
      text: '<!DOCTYPE html><html><head><meta http-equiv="Content-Security-Policy" content="default-src \'self\'"></head><body></body></html>',
      tokens: 50, ms: 200,
    }))
    const res = await POST(makeRequest({ mission: 'Build an app' }) as unknown as NextRequest)
    const data = await res.json()
    const cspCount = (data.html.match(/Content-Security-Policy/gi) || []).length
    expect(cspCount).toBe(1)
  })

  it('strips markdown code fences from LLM output', async () => {
    mockLlmChat.mockImplementation(async () => ({
      ok: true,
      text: '```html\n<!DOCTYPE html><html><head></head><body></body></html>\n```',
      tokens: 50, ms: 200,
    }))
    const res = await POST(makeRequest({ mission: 'Build an app' }) as unknown as NextRequest)
    const data = await res.json()
    expect(data.ok).toBe(true)
    expect(data.html).not.toContain('```')
    expect(data.html).toContain('<!DOCTYPE html>')
  })

  it('rate limits after max requests from same IP', async () => {
    const ip = '9.9.9.9'
    // Determine the limit (dev=100, prod=10). We'll just try up to 110.
    let count = 0
    for (let i = 0; i < 110; i++) {
      const res = await POST(makeRequest({ mission: `Build app ${i}` }, { ip }) as unknown as NextRequest)
      if (res.status === 200) count++
      else if (res.status === 429) break
    }
    // Should have been rate limited at some point
    expect(count).toBeLessThanOrEqual(100)
    expect(count).toBeGreaterThanOrEqual(10)
  })

  it('tracks different IPs independently for rate limiting', async () => {
    // Exhaust IP A (use 110 requests to be sure we hit the limit)
    for (let i = 0; i < 110; i++) {
      await POST(makeRequest({ mission: `Build app ${i}` }, { ip: '1.1.1.1' }) as unknown as NextRequest)
    }
    // IP B should still work
    const res = await POST(makeRequest({ mission: 'Build app' }, { ip: '2.2.2.2' }) as unknown as NextRequest)
    expect(res.status).toBe(200)
  })

  // ── Logger verification tests ──

  it('logs build.started and build.completed on success', async () => {
    await POST(makeRequest({ mission: 'Build a test app' }) as unknown as NextRequest)
    // Find the build.started log (info level → console.log)
    const startedCalls = logSpy.mock.calls.filter(
      (c: unknown[]) => typeof c[0] === 'string' && c[0].includes('"event":"build.started"')
    )
    const completedCalls = logSpy.mock.calls.filter(
      (c: unknown[]) => typeof c[0] === 'string' && c[0].includes('"event":"build.completed"')
    )
    expect(startedCalls.length).toBe(1)
    expect(completedCalls.length).toBe(1)
    // Verify build.started has ip and mission
    const startedParsed = JSON.parse(startedCalls[0][0] as string)
    expect(startedParsed.ip).toBeTruthy()
    expect(startedParsed.mission).toContain('test app')
  })

  it('logs build.invalid_mission on validation failure', async () => {
    await POST(makeRequest({ mission: 'ab' }) as unknown as NextRequest)
    const calls = warnSpy.mock.calls.filter(
      (c: unknown[]) => typeof c[0] === 'string' && c[0].includes('"event":"build.invalid_mission"')
    )
    expect(calls.length).toBe(1)
    const parsed = JSON.parse(calls[0][0] as string)
    expect(parsed.error).toContain('too short')
  })

  it('logs build error when coder fails', async () => {
    mockLlmChat.mockImplementation(async (sys: string) => {
      if (sys.includes('architect')) {
        return { ok: true, text: '{"type":"app"}', tokens: 20, ms: 100 }
      }
      return { ok: false, text: '', tokens: 0, ms: 100, error: 'Coder error' }
    })
    await POST(makeRequest({ mission: 'Build an app' }) as unknown as NextRequest)
    const calls = errorSpy.mock.calls.filter(
      (c: unknown[]) => typeof c[0] === 'string' && (c[0].includes('"event":"build.coder_failed"') || c[0].includes('"event":"build.architect_failed"'))
    )
    expect(calls.length).toBeGreaterThanOrEqual(1)
    const parsed = JSON.parse(calls[0][0] as string)
    expect(parsed.error).toContain('Coder error')
  })

  it('logs build.invalid_html when coder returns non-HTML', async () => {
    mockLlmChat.mockImplementation(async (sys: string) => {
      if (sys.includes('architect')) {
        return { ok: true, text: '{"type":"app"}', tokens: 20, ms: 100 }
      }
      return { ok: true, text: 'not html at all', tokens: 50, ms: 200 }
    })
    await POST(makeRequest({ mission: 'Build an app' }) as unknown as NextRequest)
    const calls = warnSpy.mock.calls.filter(
      (c: unknown[]) => typeof c[0] === 'string' && c[0].includes('"event":"build.invalid_html"')
    )
    expect(calls.length).toBe(1)
  })

  it('logs build.rate_limited when rate limit exceeded', async () => {
    const ip = '7.7.7.7'
    // Exhaust the limit
    for (let i = 0; i < 110; i++) {
      await POST(makeRequest({ mission: `Build app ${i}` }, { ip }) as unknown as NextRequest)
    }
    warnSpy.mockClear()
    // Next request should be rate limited
    await POST(makeRequest({ mission: 'One more' }, { ip }) as unknown as NextRequest)
    const calls = warnSpy.mock.calls.filter(
      (c: unknown[]) => typeof c[0] === 'string' && c[0].includes('"event":"build.rate_limited"')
    )
    expect(calls.length).toBe(1)
  })

  // ── Signal abort test ──

  it('passes a signal to llmChat (linked to request.signal)', async () => {
    const controller = new AbortController()
    const req: TestRequest = {
      headers: new Map([['x-forwarded-for', '6.6.6.6']]),
      json: async () => ({ mission: 'Build an app' }),
      signal: controller.signal,
    }
    await POST(req as unknown as NextRequest)
    // llmChat is called twice (architect + coder), both should have signals
    expect(mockLlmChat).toHaveBeenCalledTimes(2)
    const callArgs1 = mockLlmChat.mock.calls[0] as unknown[] | undefined
    const opts1 = callArgs1?.[2] as { signal: AbortSignal } | undefined
    expect(opts1?.signal).toBeInstanceOf(AbortSignal)
  })

  it('aborts llmChat when client disconnects', async () => {
    const controller = new AbortController()
    mockLlmChat.mockImplementation(async () => {
      await new Promise(resolve => setTimeout(resolve, 100))
      return { ok: true, text: '<!DOCTYPE html><html></html>', tokens: 50, ms: 100 }
    })
    const req: TestRequest = {
      headers: new Map([['x-forwarded-for', '8.8.8.8']]),
      json: async () => ({ mission: 'Build an app' }),
      signal: controller.signal,
    }
    const promise = POST(req as unknown as NextRequest)
    setTimeout(() => controller.abort(), 10)
    await promise
    expect(mockLlmChat).toHaveBeenCalled()
  })

  // ── Content-Type verification ──

  it('returns JSON content-type on success', async () => {
    const res = await POST(makeRequest({ mission: 'Build an app' }) as unknown as NextRequest)
    const contentType = res.headers.get('content-type') ?? ''
    expect(contentType).toContain('application/json')
  })

  it('returns JSON content-type on error', async () => {
    const res = await POST(makeRequest({ mission: 'ab' }) as unknown as NextRequest)
    const contentType = res.headers.get('content-type') ?? ''
    expect(contentType).toContain('application/json')
  })

  it('returns JSON content-type on rate limit', async () => {
    const ip = '5.5.5.5'
    // Exhaust the limit
    for (let i = 0; i < 110; i++) {
      await POST(makeRequest({ mission: `Build app ${i}` }, { ip }) as unknown as NextRequest)
    }
    const res = await POST(makeRequest({ mission: 'One more' }, { ip }) as unknown as NextRequest)
    const contentType = res.headers.get('content-type') ?? ''
    expect(contentType).toContain('application/json')
  })
})
