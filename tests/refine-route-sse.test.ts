// Tests for /api/refine SSE streaming route
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
  validateMission: (m: string) => m && m.trim().length >= 3 ? { ok: true } : { ok: false, error: 'Too short' },
  stripCodeFences: (t: string) => t,
  looksLikeHtml: (t: string) => t.trimStart().toLowerCase().startsWith('<!doctype'),
  injectCsp: (h: string) => h,
}))

interface TestRequest {
  headers: Map<string, string>
  json: () => Promise<unknown>
  signal: AbortSignal
}

let ipCounter = 0
function makeRequest(body: unknown): TestRequest {
  return {
    headers: new Map([['x-forwarded-for', `50.0.0.${ipCounter++}`]]),
    json: async () => body,
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
  return events
}

const { POST } = await import('../src/app/api/refine/route')

describe('POST /api/refine (SSE streaming)', () => {
  let logSpy: ReturnType<typeof spyOn>
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
    errorSpy = spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    logSpy.mockRestore()
    errorSpy.mockRestore()
  })

  it('returns SSE content-type for valid request', async () => {
    const res = await POST(makeRequest({ mission: 'test', html: '<!DOCTYPE html><html></html>', message: 'make it blue' }) as unknown as NextRequest)
    expect(res.status).toBe(200)
    const ct = res.headers.get('content-type') ?? ''
    expect(ct).toContain('text/event-stream')
  })

  it('returns 400 for missing mission', async () => {
    const res = await POST(makeRequest({ html: '<html></html>', message: 'change' }) as unknown as NextRequest)
    expect(res.status).toBe(400)
  })

  it('returns 400 for missing html', async () => {
    const res = await POST(makeRequest({ mission: 'test', message: 'change' }) as unknown as NextRequest)
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

  it('streams result event with HTML', async () => {
    const res = await POST(makeRequest({ mission: 'test', html: '<!DOCTYPE html><html></html>', message: 'make it blue' }) as unknown as NextRequest)
    const events = await readSSE(res)
    const result = events.find(e => e.type === 'result')
    expect(result).toBeTruthy()
    expect(result?.html).toContain('<!DOCTYPE html>')
    expect(result?.tokens).toBe(200)
  })

  it('streams error event when LLM fails', async () => {
    mockLlmChat.mockImplementation(async () => ({
      ok: false, text: '', tokens: 0, ms: 100, error: 'LLM error',
    }))
    const res = await POST(makeRequest({ mission: 'test', html: '<!DOCTYPE html><html></html>', message: 'change' }) as unknown as NextRequest)
    const events = await readSSE(res)
    const errorEvent = events.find(e => e.type === 'error')
    expect(errorEvent).toBeTruthy()
    expect(errorEvent?.error).toBe('LLM error')
  })

  it('calls llmChat exactly once', async () => {
    await readSSE(await POST(makeRequest({ mission: 'test', html: '<!DOCTYPE html><html></html>', message: 'change' }) as unknown as NextRequest))
    expect(mockLlmChat).toHaveBeenCalledTimes(1)
  })

  it('logs refine.started and refine.completed', async () => {
    await readSSE(await POST(makeRequest({ mission: 'test', html: '<!DOCTYPE html><html></html>', message: 'change' }) as unknown as NextRequest))
    const started = logSpy.mock.calls.filter((c: unknown[]) => typeof c[0] === 'string' && c[0].includes('"event":"refine.started"'))
    const completed = logSpy.mock.calls.filter((c: unknown[]) => typeof c[0] === 'string' && c[0].includes('"event":"refine.completed"'))
    expect(started.length).toBe(1)
    expect(completed.length).toBe(1)
  })
})
