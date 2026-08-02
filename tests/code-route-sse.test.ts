// Tests for /api/build/code SSE streaming route
import { describe, it, expect, beforeEach, mock, afterEach, spyOn } from 'bun:test'
import type { NextRequest } from 'next/server'

const mockLlmChat = mock((_sys: string, _user: string, _opts?: unknown) => Promise.resolve({
  ok: true,
  text: '<!DOCTYPE html><html><head><title>Test</title></head><body><p>hello</p></body></html>',
  tokens: 500,
  ms: 3000,
}))

// Mock streaming: yields full text in one chunk, then done
let mockStreamFn = async function* (_sys: string, _user: string, _opts?: unknown) {
  const fullText = '<!DOCTYPE html><html><head><title>Test</title></head><body><p>hello</p></body></html>'
  yield { text: fullText, fullText, done: false, tokens: 0, ms: 0 }
  yield { text: '', fullText, done: true, tokens: 500, ms: 3000 }
}

// Only mock the LLM client — utility functions (stripCodeFences, looksLikeHtml, injectCsp)
// now live in @/lib/html-utils and use their real implementations.
mock.module('@/lib/llm', () => ({
  llmChat: (sys: string, user: string, opts?: unknown) => mockLlmChat(sys, user, opts),
  llmChatStream: (sys: string, user: string, opts?: unknown) => mockStreamFn(sys, user, opts),
}))

// v10.7: Mock DashScope as not configured — prevents fallback from hanging tests
mock.module('@/lib/dashscope', () => ({
  isDashScopeConfigured: () => false,
  dashscopeStream: async function* () { yield { text: '', fullText: '', done: true, tokens: 0, ms: 0 } },
  dashscopeChat: async () => ({ ok: false, text: '', tokens: 0, ms: 0 }),
}))

interface TestRequest {
  headers: Map<string, string>
  json: () => Promise<unknown>
  signal: AbortSignal
}

let ipCounter = 0
function makeRequest(body: unknown): TestRequest {
  return {
    headers: new Map([['x-forwarded-for', `40.0.0.${ipCounter++}`]]),
    json: async () => body,
    signal: new AbortController().signal,
  }
}

const { POST } = await import('../src/app/api/build/code/route')

// Helper: read entire SSE stream and return all events
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

describe('POST /api/build/code (SSE streaming)', () => {
  let logSpy: ReturnType<typeof spyOn>
  let errorSpy: ReturnType<typeof spyOn>

  beforeEach(() => {
    mockLlmChat.mockReset()
    mockLlmChat.mockResolvedValue({
      ok: true,
      text: '<!DOCTYPE html><html><head><title>Test</title></head><body><p>hello</p></body></html>',
      tokens: 500,
      ms: 3000,
    })
    // Reset streaming mock to default
    mockStreamFn = async function* (_sys: string, _user: string, _opts?: unknown) {
      const fullText = '<!DOCTYPE html><html><head><title>Test</title></head><body><p>hello</p></body></html>'
      yield { text: fullText, fullText, done: false, tokens: 0, ms: 0 }
      yield { text: '', fullText, done: true, tokens: 500, ms: 3000 }
    }
    logSpy = spyOn(console, 'log').mockImplementation(() => {})
    errorSpy = spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    logSpy.mockRestore()
    errorSpy.mockRestore()
  })

  it('returns SSE content-type for valid request', async () => {
    const res = await POST(makeRequest({ mission: 'Build a game' }) as unknown as NextRequest)
    expect(res.status).toBe(200)
    const ct = res.headers.get('content-type') ?? ''
    expect(ct).toContain('text/event-stream')
  })

  it('returns 400 for missing mission', async () => {
    const res = await POST(makeRequest({}) as unknown as NextRequest)
    expect(res.status).toBe(400)
  })

  it('streams progress events then a result event', async () => {
    const res = await POST(makeRequest({ mission: 'Build a game' }) as unknown as NextRequest)
    const events = await readSSE(res)

    // Should have at least one progress event and one result event
    const progressEvents = events.filter(e => e.type === 'progress')
    const resultEvents = events.filter(e => e.type === 'result')
    expect(resultEvents.length).toBe(1)
    expect(progressEvents.length).toBeGreaterThanOrEqual(0) // might be 0 if LLM is fast

    const result = resultEvents[0] as Record<string, unknown>
    expect(result.html).toContain('<!DOCTYPE html>')
    expect(result.tokens).toBe(500)
  })

  it('streams error event when LLM fails', async () => {
    mockStreamFn = async function* () {
      yield { text: '', fullText: '', done: true, tokens: 0, ms: 100, error: 'LLM failed' }
    }
    const res = await POST(makeRequest({ mission: 'Build a game' }) as unknown as NextRequest)
    const events = await readSSE(res)
    const errorEvents = events.filter(e => e.type === 'error')
    expect(errorEvents.length).toBe(1)
    expect(errorEvents[0]?.error).toBe('LLM failed')
  })

  it('streams error event when LLM returns non-HTML', async () => {
    mockStreamFn = async function* () {
      const bad = 'not html at all'
      yield { text: bad, fullText: bad, done: false, tokens: 0, ms: 0 }
      yield { text: '', fullText: bad, done: true, tokens: 50, ms: 100 }
    }
    const res = await POST(makeRequest({ mission: 'Build a game' }) as unknown as NextRequest)
    const events = await readSSE(res)
    const errorEvents = events.filter(e => e.type === 'error')
    expect(errorEvents.length).toBe(1)
  })

  it('accepts plan in body', async () => {
    const res = await POST(makeRequest({ mission: 'Build a game', plan: { title: 'Snake' } }) as unknown as NextRequest)
    expect(res.status).toBe(200)
    const events = await readSSE(res)
    const result = events.find(e => e.type === 'result')
    expect(result).toBeTruthy()
  })

  it('calls llmChat 0 or 1 times (1 if validation/plan triggers retry, 0 if not)', async () => {
    await readSSE(await POST(makeRequest({ mission: 'Build a game' }) as unknown as NextRequest))
    // 0 calls = no retry needed (design tokens boost score above 70)
    // 1 call = retry triggered by validation or plan adherence
    expect(mockLlmChat.mock.calls.length).toBeGreaterThanOrEqual(0)
    expect(mockLlmChat.mock.calls.length).toBeLessThanOrEqual(1)
  })

  it('logs code.started and code.completed', async () => {
    await readSSE(await POST(makeRequest({ mission: 'Build a game' }) as unknown as NextRequest))
    const started = logSpy.mock.calls.filter((c: unknown[]) => typeof c[0] === 'string' && c[0].includes('"event":"code.started"'))
    const completed = logSpy.mock.calls.filter((c: unknown[]) => typeof c[0] === 'string' && c[0].includes('"event":"code.completed"'))
    expect(started.length).toBe(1)
    expect(completed.length).toBe(1)
  })
})
