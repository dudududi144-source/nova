// Integration test for POST /api/build
// Mocks llmChat so we test the route logic (rate limiting, validation, CSP, response shape)
// without making real LLM calls.

import { describe, it, expect, beforeEach, mock, afterEach } from 'bun:test'

// Mock the llm module BEFORE importing the route
// We mock the functions the route imports
const mockLlmChat = mock((_sys: string, _user: string) => Promise.resolve({
  ok: true,
  text: '<!DOCTYPE html><html><head><title>Test</title></head><body><p>hello</p></body></html>',
  tokens: 100,
  ms: 500,
}))

mock.module('@/lib/llm', () => ({
  // Use a wrapper so mockImplementation/mockResolvedValue changes are picked up.
  // (Directly passing mockLlmChat captures the original implementation.)
  llmChat: (...args: any[]) => mockLlmChat(...args),
  validateMission: (m: string) => {
    if (!m || !m.trim()) return { ok: false, error: 'Mission is empty' }
    if (m.trim().length < 3) return { ok: false, error: 'Mission too short (min 3 chars)' }
    if (m.trim().length > 500) return { ok: false, error: 'Mission too long' }
    return { ok: true }
  },
  // Use the same regex as the real implementation
  stripCodeFences: (t: string) => {
    const fenceMatch = t.match(/```(?:html|htm)?\s*\n?([\s\S]*?)\n?```/)
    if (fenceMatch) return fenceMatch[1].trim()
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

// Mock logger so we don't spam test output
mock.module('@/lib/logger', () => ({
  logger: {
    info: () => {},
    warn: () => {},
    error: () => {},
  },
}))

// Import after mocks are set up
const { POST } = await import('../src/app/api/build/route')

// Use a unique IP per test to avoid rate limit interference between tests
let testIpCounter = 0
function nextIp(): string {
  return `10.0.${Math.floor(testIpCounter / 256)}.${testIpCounter++ % 256}`
}

// Helper to create a NextRequest-like object
function makeRequest(body: unknown, opts: { ip?: string; signal?: AbortSignal } = {}): any {
  return {
    headers: new Map([
      ['x-forwarded-for', opts.ip ?? nextIp()],
    ]),
    json: async () => body,
    signal: opts.signal ?? new AbortController().signal,
  } as any
}

describe('POST /api/build', () => {
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
  })

  it('returns 400 for invalid JSON body', async () => {
    const req = {
      headers: new Map([['x-forwarded-for', '1.2.3.4']]),
      json: async () => { throw new Error('invalid json') },
      signal: new AbortController().signal,
    } as any
    const res = await POST(req)
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.ok).toBe(false)
    expect(data.error).toBe('Invalid JSON')
  })

  it('returns 400 for missing mission', async () => {
    const res = await POST(makeRequest({}))
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.ok).toBe(false)
    expect(data.error).toContain('empty')
  })

  it('returns 400 for mission that is too short', async () => {
    const res = await POST(makeRequest({ mission: 'ab' }))
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.ok).toBe(false)
    expect(data.error).toContain('too short')
  })

  it('returns 400 for mission that is not a string', async () => {
    const res = await POST(makeRequest({ mission: 123 }))
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.ok).toBe(false)
  })

  it('returns 200 with HTML for valid mission', async () => {
    const res = await POST(makeRequest({ mission: 'Build a snake game' }))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.ok).toBe(true)
    expect(data.html).toContain('<!DOCTYPE html>')
    expect(data.html).toContain('Content-Security-Policy')
    expect(typeof data.tokens).toBe('number')
    expect(typeof data.ms).toBe('number')
  })

  it('calls llmChat exactly once for a valid mission', async () => {
    await POST(makeRequest({ mission: 'Build a calculator' }))
    expect(mockLlmChat).toHaveBeenCalledTimes(1)
  })

  it('returns 502 when llmChat fails', async () => {
    mockLlmChat.mockImplementation(async () => ({
      ok: false, text: '', tokens: 0, ms: 100, error: 'The AI service is busy',
    }))
    const res = await POST(makeRequest({ mission: 'Build a todo app' }))
    expect(res.status).toBe(502)
    const data = await res.json()
    expect(data.ok).toBe(false)
    expect(data.error).toBe('The AI service is busy')
  })

  it('returns 502 when LLM returns non-HTML', async () => {
    mockLlmChat.mockImplementation(async () => ({
      ok: true, text: "Here's your app: not actually HTML", tokens: 50, ms: 200,
    }))
    const res = await POST(makeRequest({ mission: 'Build something' }))
    expect(res.status).toBe(502)
    const data = await res.json()
    expect(data.ok).toBe(false)
    expect(data.error).toContain('did not return valid HTML')
  })

  it('injects CSP into the returned HTML', async () => {
    const res = await POST(makeRequest({ mission: 'Build a game' }))
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
    const res = await POST(makeRequest({ mission: 'Build an app' }))
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
    const res = await POST(makeRequest({ mission: 'Build an app' }))
    const data = await res.json()
    expect(data.ok).toBe(true)
    expect(data.html).not.toContain('```')
    expect(data.html).toContain('<!DOCTYPE html>')
  })

  it('rate limits after 10 requests from same IP', async () => {
    const ip = '9.9.9.9'
    // Make 10 successful requests
    for (let i = 0; i < 10; i++) {
      const res = await POST(makeRequest({ mission: `Build app ${i}` }, { ip }))
      expect(res.status).toBe(200)
    }
    // 11th should be rate limited
    const res = await POST(makeRequest({ mission: 'Build one more' }, { ip }))
    expect(res.status).toBe(429)
    const data = await res.json()
    expect(data.ok).toBe(false)
    expect(data.error).toContain('Rate limit')
    expect(res.headers.get('Retry-After')).toBeTruthy()
  })

  it('tracks different IPs independently for rate limiting', async () => {
    // Exhaust IP A
    for (let i = 0; i < 10; i++) {
      await POST(makeRequest({ mission: `Build app ${i}` }, { ip: '1.1.1.1' }))
    }
    // IP B should still work
    const res = await POST(makeRequest({ mission: 'Build app' }, { ip: '2.2.2.2' }))
    expect(res.status).toBe(200)
  })
})
