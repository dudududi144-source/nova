// Tests for /api/enhance route — prompt enhancement
import { describe, it, expect, beforeEach, mock, afterEach, spyOn } from 'bun:test'
import type { NextRequest } from 'next/server'

const mockLlmChat = mock((_sys: string, _user: string, _opts?: unknown) => Promise.resolve({
  ok: true,
  text: 'Build a todo app with add/delete/complete, filter by status, and local storage persistence.',
  tokens: 150,
  ms: 1200,
}))

mock.module('@/lib/llm', () => ({
  llmChat: (sys: string, user: string, opts?: unknown) => mockLlmChat(sys, user, opts),
}))

mock.module('@/lib/dashscope', () => ({
  isDashScopeConfigured: () => false,
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
    headers: new Map([['x-forwarded-for', `60.0.0.${ipCounter++}`]]),
    json: async () => body,
    signal: new AbortController().signal,
  }
}

const { POST } = await import('../src/app/api/enhance/route')

describe('POST /api/enhance', () => {
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
    logSpy = spyOn(console, 'log').mockImplementation(() => {})
    errorSpy = spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    logSpy.mockRestore()
    errorSpy.mockRestore()
  })

  it('returns 200 + enhanced prompt for valid input', async () => {
    const res = await POST(makeRequest({ prompt: 'todo app' }) as unknown as NextRequest)
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.ok).toBe(true)
    expect(typeof data.enhanced).toBe('string')
    expect(data.enhanced.length).toBeGreaterThan('todo app'.length)
    expect(data.tokens).toBe(150)
    expect(data.ms).toBe(1200)
  })

  it('returns 400 for missing prompt', async () => {
    const res = await POST(makeRequest({}) as unknown as NextRequest)
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.ok).toBe(false)
  })

  it('returns 400 for empty prompt', async () => {
    const res = await POST(makeRequest({ prompt: '' }) as unknown as NextRequest)
    expect(res.status).toBe(400)
  })

  it('returns 400 for whitespace-only prompt', async () => {
    const res = await POST(makeRequest({ prompt: '   ' }) as unknown as NextRequest)
    expect(res.status).toBe(400)
  })

  it('returns 400 for too-short prompt (< 3 chars)', async () => {
    const res = await POST(makeRequest({ prompt: 'ab' }) as unknown as NextRequest)
    expect(res.status).toBe(400)
  })

  it('returns 400 for invalid JSON body', async () => {
    const res = await POST(makeRequest('not-json') as unknown as NextRequest)
    expect(res.status).toBe(400)
  })

  it('returns 400 when prompt is not a string', async () => {
    const res = await POST(makeRequest({ prompt: 123 }) as unknown as NextRequest)
    expect(res.status).toBe(400)
  })

  it('strips surrounding quotes from enhanced text', async () => {
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

  it('strips code fences from enhanced text', async () => {
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

  it('returns original prompt when enhanced is shorter (sanity check)', async () => {
    mockLlmChat.mockResolvedValueOnce({
      ok: true,
      text: 'ok',
      tokens: 5,
      ms: 500,
    })
    const res = await POST(makeRequest({ prompt: 'build a complex dashboard app' }) as unknown as NextRequest)
    const data = await res.json()
    expect(data.ok).toBe(true)
    // The enhanced "ok" is shorter than the original, so should fall back to original
    expect(data.enhanced).toBe('build a complex dashboard app')
  })

  it('returns 502 when LLM fails', async () => {
    mockLlmChat.mockResolvedValueOnce({
      ok: false,
      text: '',
      tokens: 0,
      ms: 0,
      error: 'LLM unavailable',
    } as ReturnType<typeof mockLlmChat> extends Promise<infer T> ? T : never)
    const res = await POST(makeRequest({ prompt: 'todo app' }) as unknown as NextRequest)
    expect(res.status).toBe(502)
    const data = await res.json()
    expect(data.ok).toBe(false)
  })

  it('returns 413 for oversized body', async () => {
    const bigPrompt = 'x'.repeat(20_000)
    const res = await POST({
      headers: new Map([['content-length', String(bigPrompt.length + 20)]]),
      json: async () => ({ prompt: bigPrompt }),
      signal: new AbortController().signal,
    } as unknown as TestRequest as unknown as NextRequest)
    expect(res.status).toBe(413)
  })

  it('passes the user prompt to the LLM', async () => {
    await POST(makeRequest({ prompt: 'my specific prompt' }) as unknown as NextRequest)
    expect(mockLlmChat).toHaveBeenCalled()
    const args = mockLlmChat.mock.calls[0]
    // args: [systemPrompt, userPrompt, opts]
    expect(args[1]).toBe('my specific prompt')
  })
})
