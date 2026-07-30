// Integration test for POST /api/refine
// Mocks llmChat so we test the route logic without making real LLM calls.

import { describe, it, expect, beforeEach, mock, afterEach, spyOn } from 'bun:test'
import type { NextRequest } from 'next/server'

const mockLlmChat = mock((_sys: string, _user: string, _opts?: unknown) => Promise.resolve({
  ok: true,
  text: '<!DOCTYPE html><html><head><title>Refined</title></head><body><p>updated</p></body></html>',
  tokens: 200,
  ms: 3000,
}))

mock.module('@/lib/llm', () => ({
  llmChat: (sys: string, user: string, opts?: unknown) => mockLlmChat(sys, user, opts),
  validateMission: (m: string) => {
    if (!m || !m.trim()) return { ok: false, error: 'Mission is empty' }
    return { ok: true }
  },
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
  injectCsp: (html: string) => {
    if (/<meta\s+http-equiv=["']?content-security-policy["']?/i.test(html)) return html
    const csp = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'none'"
    return html.replace(/<head[^>]*>/i, m => `${m}<meta http-equiv="Content-Security-Policy" content="${csp}">`)
  },
}))

interface TestRequest {
  headers: Map<string, string>
  json: () => Promise<unknown>
  signal: AbortSignal
}

function makeRequest(body: unknown, opts: { ip?: string } = {}): TestRequest {
  let ipCounter = 0
  const ip = opts.ip ?? `20.0.0.${ipCounter++}`
  return {
    headers: new Map([['x-forwarded-for', ip]]),
    json: async () => body,
    signal: new AbortController().signal,
  }
}

const { POST } = await import('../src/app/api/refine/route')

describe('POST /api/refine', () => {
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
    logSpy = spyOn(console, 'log').mockImplementation(() => {})
    warnSpy = spyOn(console, 'warn').mockImplementation(() => {})
    errorSpy = spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    logSpy.mockRestore()
    warnSpy.mockRestore()
    errorSpy.mockRestore()
  })

  it('returns 400 for missing mission', async () => {
    const res = await POST(makeRequest({ html: '<html></html>', message: 'change it' }) as unknown as NextRequest)
    expect(res.status).toBe(400)
  })

  it('returns 400 for missing html', async () => {
    const res = await POST(makeRequest({ mission: 'test', message: 'change it' }) as unknown as NextRequest)
    expect(res.status).toBe(400)
  })

  it('returns 400 for missing message', async () => {
    const res = await POST(makeRequest({ mission: 'test', html: '<html></html>' }) as unknown as NextRequest)
    expect(res.status).toBe(400)
  })

  it('returns 400 for message over 500 chars', async () => {
    const res = await POST(makeRequest({ mission: 'test', html: '<html></html>', message: 'a'.repeat(501) }) as unknown as NextRequest)
    expect(res.status).toBe(400)
  })

  it('returns 200 with refined HTML for valid request', async () => {
    const res = await POST(makeRequest({ mission: 'Build a snake game', html: '<!DOCTYPE html><html></html>', message: 'make it blue' }) as unknown as NextRequest)
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.ok).toBe(true)
    expect(data.html).toContain('<!DOCTYPE html>')
    expect(data.html).toContain('Content-Security-Policy')
    expect(typeof data.tokens).toBe('number')
    expect(typeof data.ms).toBe('number')
  })

  it('calls llmChat exactly once', async () => {
    await POST(makeRequest({ mission: 'test', html: '<!DOCTYPE html><html></html>', message: 'change' }) as unknown as NextRequest)
    expect(mockLlmChat).toHaveBeenCalledTimes(1)
  })

  it('returns 502 when llmChat fails', async () => {
    mockLlmChat.mockImplementation(async () => ({
      ok: false, text: '', tokens: 0, ms: 100, error: 'LLM error',
    }))
    const res = await POST(makeRequest({ mission: 'test', html: '<!DOCTYPE html><html></html>', message: 'change' }) as unknown as NextRequest)
    expect(res.status).toBe(502)
    const data = await res.json()
    expect(data.error).toBe('LLM error')
  })

  it('returns 502 when LLM returns non-HTML', async () => {
    mockLlmChat.mockImplementation(async () => ({
      ok: true, text: 'not html', tokens: 50, ms: 200,
    }))
    const res = await POST(makeRequest({ mission: 'test', html: '<!DOCTYPE html><html></html>', message: 'change' }) as unknown as NextRequest)
    expect(res.status).toBe(502)
  })

  it('injects CSP into refined HTML', async () => {
    const res = await POST(makeRequest({ mission: 'test', html: '<!DOCTYPE html><html></html>', message: 'change' }) as unknown as NextRequest)
    const data = await res.json()
    expect(data.html).toContain('Content-Security-Policy')
    expect(data.html).toContain("connect-src 'none'")
  })

  it('returns JSON content-type on success', async () => {
    const res = await POST(makeRequest({ mission: 'test', html: '<!DOCTYPE html><html></html>', message: 'change' }) as unknown as NextRequest)
    const contentType = res.headers.get('content-type') ?? ''
    expect(contentType).toContain('application/json')
  })

  it('logs refine.started and refine.completed on success', async () => {
    await POST(makeRequest({ mission: 'test app', html: '<!DOCTYPE html><html></html>', message: 'change it' }) as unknown as NextRequest)
    const startedCalls = logSpy.mock.calls.filter(
      (c: unknown[]) => typeof c[0] === 'string' && c[0].includes('"event":"refine.started"')
    )
    const completedCalls = logSpy.mock.calls.filter(
      (c: unknown[]) => typeof c[0] === 'string' && c[0].includes('"event":"refine.completed"')
    )
    expect(startedCalls.length).toBe(1)
    expect(completedCalls.length).toBe(1)
  })
})
