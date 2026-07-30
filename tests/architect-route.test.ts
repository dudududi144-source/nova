// Tests for /api/build/architect route
import { describe, it, expect, beforeEach, mock, afterEach, spyOn } from 'bun:test'
import type { NextRequest } from 'next/server'

const mockLlmChat = mock((_sys: string, _user: string, _opts?: unknown) => Promise.resolve({
  ok: true,
  text: '{"type":"game","title":"Snake","features":["board","scoring"],"approach":"canvas","colors":{"bg":"#0f172a","primary":"#3b82f6","accent":"#22d3ee"},"layout":"centered","keyFunctions":["init","update"]}',
  tokens: 300,
  ms: 2000,
}))

mock.module('@/lib/llm', () => ({
  llmChat: (sys: string, user: string, opts?: unknown) => mockLlmChat(sys, user, opts),
  validateMission: (m: string) => {
    if (!m || !m.trim()) return { ok: false, error: 'Mission is empty' }
    if (m.trim().length < 3) return { ok: false, error: 'Too short' }
    return { ok: true }
  },
  stripCodeFences: (t: string) => t,
  looksLikeHtml: (t: string) => t.trimStart().toLowerCase().startsWith('<!doctype'),
  injectCsp: (h: string) => h,
}))

interface TestRequest {
  headers: Map<string, string>
  json: () => Promise<unknown>
  signal: AbortSignal
}

function makeRequest(body: unknown, ip = '30.0.0.1'): TestRequest {
  return {
    headers: new Map([['x-forwarded-for', ip]]),
    json: async () => body,
    signal: new AbortController().signal,
  }
}

const { POST } = await import('../src/app/api/build/architect/route')

describe('POST /api/build/architect', () => {
  let logSpy: ReturnType<typeof spyOn>
  let warnSpy: ReturnType<typeof spyOn>
  let errorSpy: ReturnType<typeof spyOn>

  beforeEach(() => {
    mockLlmChat.mockReset()
    mockLlmChat.mockResolvedValue({
      ok: true,
      text: '{"type":"game","title":"Snake","features":["board"],"approach":"canvas","colors":{"bg":"#0f172a","primary":"#3b82f6","accent":"#22d3ee"},"layout":"centered","keyFunctions":["init"]}',
      tokens: 300,
      ms: 2000,
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
    const res = await POST(makeRequest({}) as unknown as NextRequest)
    expect(res.status).toBe(400)
  })

  it('returns 200 with plan for valid mission', async () => {
    const res = await POST(makeRequest({ mission: 'Build a snake game' }) as unknown as NextRequest)
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.ok).toBe(true)
    expect(data.plan).toBeTruthy()
    expect(data.plan.title).toBe('Snake')
    expect(data.tokens).toBe(300)
    expect(data.ms).toBe(2000)
  })

  it('returns 502 when LLM fails', async () => {
    mockLlmChat.mockImplementation(async () => ({
      ok: false, text: '', tokens: 0, ms: 100, error: 'LLM error',
    }))
    const res = await POST(makeRequest({ mission: 'Build a game' }) as unknown as NextRequest)
    expect(res.status).toBe(502)
    const data = await res.json()
    expect(data.error).toBe('LLM error')
  })

  it('handles malformed JSON from LLM gracefully', async () => {
    mockLlmChat.mockImplementation(async () => ({
      ok: true, text: 'not json at all', tokens: 50, ms: 100,
    }))
    const res = await POST(makeRequest({ mission: 'Build a game' }) as unknown as NextRequest)
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.ok).toBe(true)
    expect(data.plan).toBeNull() // plan is null when JSON parsing fails
  })

  it('returns JSON content-type', async () => {
    const res = await POST(makeRequest({ mission: 'Build a game' }) as unknown as NextRequest)
    const ct = res.headers.get('content-type') ?? ''
    expect(ct).toContain('application/json')
  })

  it('logs architect.started and architect.completed', async () => {
    await POST(makeRequest({ mission: 'Build a game' }) as unknown as NextRequest)
    const started = logSpy.mock.calls.filter((c: unknown[]) => typeof c[0] === 'string' && c[0].includes('"event":"architect.started"'))
    const completed = logSpy.mock.calls.filter((c: unknown[]) => typeof c[0] === 'string' && c[0].includes('"event":"architect.completed"'))
    expect(started.length).toBe(1)
    expect(completed.length).toBe(1)
  })

  it('calls llmChat exactly once', async () => {
    await POST(makeRequest({ mission: 'Build a game' }) as unknown as NextRequest)
    expect(mockLlmChat).toHaveBeenCalledTimes(1)
  })
})
