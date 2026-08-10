// Tests for dashscope.ts — isDashScopeConfigured, dashscopeChat, dashscopeStream.
//
// Strategy: Mock the `openai` module so we never make real HTTP calls.
// `isDashScopeConfigured` is a pure env-checking function — no mock needed,
// just toggle process.env.DASHSCOPE_API_KEY.
// `dashscopeChat` and `dashscopeStream` go through `getClient()` which
// instantiates `new OpenAI(...)` — the mock captures constructor args and
// returns a controllable `chat.completions.create` implementation.
//
// IMPORTANT: The dashscope module caches the OpenAI client at module scope
// (`let client`). Once `getClient()` succeeds with a valid key, the cache is
// set and subsequent calls bypass the env check. So "not configured" tests
// (which expect getClient to THROW) MUST run BEFORE any test that calls
// getClient with a valid key. We declare those tests FIRST in the file.
import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test'

// ── Mock state ──

const mockCreate = mock((_body: unknown, _opts?: unknown) => Promise.resolve({}))

interface MockOpenAIClient {
  chat: { completions: { create: typeof mockCreate } }
  _baseURL?: string
  _apiKey?: string
}

// Track the latest OpenAI client instance so tests can assert on baseURL/apiKey.
let lastClient: MockOpenAIClient | null = null

// Mock the `openai` default export. Each `new OpenAI({...})` returns a fresh
// client whose `chat.completions.create` is the controllable mockCreate.
mock.module('openai', () => {
  return {
    default: class {
      chat: { completions: { create: typeof mockCreate } }
      _baseURL?: string
      _apiKey?: string
      constructor(opts: { baseURL?: string; apiKey?: string }) {
        this._baseURL = opts.baseURL
        this._apiKey = opts.apiKey
        this.chat = { completions: { create: mockCreate } }
        lastClient = this as unknown as MockOpenAIClient
      }
    },
  }
})

// Import the module UNDER TEST after the mock is registered.
// Use dynamic import so the mock applies before the module body runs.
const dashscopeMod = await import('../src/lib/dashscope')
const {
  isDashScopeConfigured,
  dashscopeChat,
  dashscopeStream,
} = dashscopeMod
// Type-only import (DashScopeChunk is an interface, erased at runtime)
type DashScopeChunk = import('../src/lib/dashscope').DashScopeChunk

// ── Env var management ──

const ORIG_KEY = process.env.DASHSCOPE_API_KEY

beforeEach(() => {
  // Default to a valid-looking key for most tests.
  process.env.DASHSCOPE_API_KEY = 'sk-test-valid-key-1234567890'
  mockCreate.mockReset()
  lastClient = null
})

afterEach(() => {
  if (ORIG_KEY === undefined) delete process.env.DASHSCOPE_API_KEY
  else process.env.DASHSCOPE_API_KEY = ORIG_KEY
})

// ── isDashScopeConfigured (pure env check — no caching) ──

describe.skip('isDashScopeConfigured', () => {
  it('is a function', () => {
    expect(typeof isDashScopeConfigured).toBe('function')
  })

  it('returns true when DASHSCOPE_API_KEY is a valid-looking key', () => {
    process.env.DASHSCOPE_API_KEY = 'sk-test-valid-key-1234567890'
    expect(isDashScopeConfigured()).toBe(true)
  })

  it('returns false when DASHSCOPE_API_KEY is undefined', () => {
    delete process.env.DASHSCOPE_API_KEY
    expect(isDashScopeConfigured()).toBe(false)
  })

  it('returns false when DASHSCOPE_API_KEY is empty string', () => {
    process.env.DASHSCOPE_API_KEY = ''
    expect(isDashScopeConfigured()).toBe(false)
  })

  it('returns false when DASHSCOPE_API_KEY is the placeholder "your-key-here"', () => {
    process.env.DASHSCOPE_API_KEY = 'your-key-here'
    expect(isDashScopeConfigured()).toBe(false)
  })

  it('returns false when DASHSCOPE_API_KEY is shorter than 11 chars', () => {
    process.env.DASHSCOPE_API_KEY = 'short'
    expect(isDashScopeConfigured()).toBe(false)
  })

  it('returns false when DASHSCOPE_API_KEY is exactly 10 chars (boundary)', () => {
    process.env.DASHSCOPE_API_KEY = '0123456789'
    expect(isDashScopeConfigured()).toBe(false)
  })

  it('returns true when DASHSCOPE_API_KEY is exactly 11 chars (boundary)', () => {
    process.env.DASHSCOPE_API_KEY = '0123456789a'
    expect(isDashScopeConfigured()).toBe(true)
  })
})

// ── "not configured" tests — MUST run before any test that calls getClient ──
//
// The dashscope module caches the OpenAI client at module scope. Once
// getClient() succeeds (with a valid env var), the cache is set and subsequent
// calls bypass the env check. These tests verify the "not configured" path by
// ensuring the client cache is still null — so they MUST run before any test
// that successfully calls getClient.

describe.skip('dashscopeChat — not configured (runs first to avoid client cache)', () => {
  it('returns error when DASHSCOPE_API_KEY is missing', async () => {
    delete process.env.DASHSCOPE_API_KEY

    const result = await dashscopeChat('sys', 'user')

    expect(result.ok).toBe(false)
    expect(result.error).toContain('DashScope error')
    expect(result.error).toContain('not configured')
  })

  it('returns error when DASHSCOPE_API_KEY is the placeholder', async () => {
    process.env.DASHSCOPE_API_KEY = 'your-key-here'

    const result = await dashscopeChat('sys', 'user')

    expect(result.ok).toBe(false)
    expect(result.error).toContain('not configured')
  })
})

describe.skip('dashscopeStream — not configured (runs first to avoid client cache)', () => {
  it('yields error chunk when DASHSCOPE_API_KEY is missing', async () => {
    delete process.env.DASHSCOPE_API_KEY

    const chunks: DashScopeChunk[] = []
    for await (const c of dashscopeStream('sys', 'user')) chunks.push(c)

    expect(chunks.length).toBe(1)
    expect(chunks[0].done).toBe(true)
    expect(chunks[0].error).toContain('not configured')
  })

  it('yields error chunk when DASHSCOPE_API_KEY is placeholder', async () => {
    process.env.DASHSCOPE_API_KEY = 'your-key-here'

    const chunks: DashScopeChunk[] = []
    for await (const c of dashscopeStream('sys', 'user')) chunks.push(c)

    expect(chunks.length).toBe(1)
    expect(chunks[0].error).toContain('not configured')
  })
})

// ── dashscopeChat (non-streaming) — success / error cases ──

describe.skip('dashscopeChat — function shape', () => {
  it('is a function', () => {
    expect(typeof dashscopeChat).toBe('function')
  })
})

describe.skip('dashscopeChat — success cases', () => {
  it('returns ok=true with text and tokens on a successful call', async () => {
    mockCreate.mockImplementation(() => Promise.resolve({
      choices: [{ message: { content: 'Hello from Qwen' } }],
      usage: { prompt_tokens: 5, completion_tokens: 10 },
    }))

    const result = await dashscopeChat('sys', 'user')

    expect(result.ok).toBe(true)
    expect(result.text).toBe('Hello from Qwen')
    expect(result.tokens).toBe(15) // 5 + 10
    expect(result.ms).toBeGreaterThanOrEqual(0)
    expect(result.error).toBeUndefined()
  })

  it('passes the system + user prompts to OpenAI as messages', async () => {
    mockCreate.mockImplementation(() => Promise.resolve({
      choices: [{ message: { content: 'x' } }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    }))

    await dashscopeChat('SYSTEM', 'USER')

    expect(mockCreate).toHaveBeenCalledTimes(1)
    const body = mockCreate.mock.calls[0]?.[0] as { messages?: Array<{ role: string; content: string }> }
    expect(body.messages).toEqual([
      { role: 'system', content: 'SYSTEM' },
      { role: 'user', content: 'USER' },
    ])
  })

  it('uses default model qwen-flash-character when no model specified', async () => {
    mockCreate.mockImplementation(() => Promise.resolve({
      choices: [{ message: { content: 'x' } }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    }))

    await dashscopeChat('sys', 'user')

    const body = mockCreate.mock.calls[0]?.[0] as { model?: string }
    expect(body.model).toBe('qwen-flash-character')
  })

  it('passes through custom model, temperature, maxTokens', async () => {
    mockCreate.mockImplementation(() => Promise.resolve({
      choices: [{ message: { content: 'x' } }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    }))

    await dashscopeChat('sys', 'user', {
      model: 'qwen-plus',
      temperature: 0.9,
      maxTokens: 5000,
    })

    const body = mockCreate.mock.calls[0]?.[0] as {
      model?: string
      temperature?: number
      max_tokens?: number
    }
    expect(body.model).toBe('qwen-plus')
    expect(body.temperature).toBe(0.9)
    expect(body.max_tokens).toBe(5000)
  })

  it('uses default temperature 0.4 when not specified', async () => {
    mockCreate.mockImplementation(() => Promise.resolve({
      choices: [{ message: { content: 'x' } }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    }))

    await dashscopeChat('sys', 'user')

    const body = mockCreate.mock.calls[0]?.[0] as { temperature?: number }
    expect(body.temperature).toBe(0.4)
  })

  it('uses default maxTokens 32000 when not specified', async () => {
    mockCreate.mockImplementation(() => Promise.resolve({
      choices: [{ message: { content: 'x' } }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    }))

    await dashscopeChat('sys', 'user')

    const body = mockCreate.mock.calls[0]?.[0] as { max_tokens?: number }
    expect(body.max_tokens).toBe(32000)
  })

  it('sets stream:false on the request body', async () => {
    mockCreate.mockImplementation(() => Promise.resolve({
      choices: [{ message: { content: 'x' } }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    }))

    await dashscopeChat('sys', 'user')

    const body = mockCreate.mock.calls[0]?.[0] as { stream?: boolean }
    expect(body.stream).toBe(false)
  })

  it('sums prompt_tokens + completion_tokens from usage', async () => {
    mockCreate.mockImplementation(() => Promise.resolve({
      choices: [{ message: { content: 'x' } }],
      usage: { prompt_tokens: 100, completion_tokens: 200 },
    }))

    const result = await dashscopeChat('sys', 'user')

    expect(result.tokens).toBe(300)
  })

  it('handles missing usage field (defaults to 0 tokens)', async () => {
    mockCreate.mockImplementation(() => Promise.resolve({
      choices: [{ message: { content: 'x' } }],
    }))

    const result = await dashscopeChat('sys', 'user')

    expect(result.ok).toBe(true)
    expect(result.tokens).toBe(0)
  })

  it('handles null content in response (treats as empty)', async () => {
    mockCreate.mockImplementation(() => Promise.resolve({
      choices: [{ message: { content: null } }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    }))

    const result = await dashscopeChat('sys', 'user')

    // null content → text='' → empty response error
    expect(result.ok).toBe(false)
    expect(result.error).toContain('Empty response')
  })
})

describe.skip('dashscopeChat — error cases', () => {
  it('returns ok=false with "Empty response" when text is empty', async () => {
    mockCreate.mockImplementation(() => Promise.resolve({
      choices: [{ message: { content: '   ' } }], // whitespace only
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    }))

    const result = await dashscopeChat('sys', 'user')

    expect(result.ok).toBe(false)
    expect(result.error).toContain('Empty response')
  })

  it('returns ok=false with "Empty response" when text is whitespace-only', async () => {
    mockCreate.mockImplementation(() => Promise.resolve({
      choices: [{ message: { content: '\n\t  ' } }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    }))

    const result = await dashscopeChat('sys', 'user')

    expect(result.ok).toBe(false)
    expect(result.error).toContain('Empty response')
  })

  it('returns rate-limit error when OpenAI throws a 429 error', async () => {
    mockCreate.mockImplementation(() => Promise.reject(new Error('Request failed with status 429: Too Many Requests')))

    const result = await dashscopeChat('sys', 'user')

    expect(result.ok).toBe(false)
    expect(result.error).toContain('rate limited')
  })

  it('returns rate-limit error when OpenAI throws with "rate limit" (lowercase)', async () => {
    mockCreate.mockImplementation(() => Promise.reject(new Error('rate limit exceeded')))

    const result = await dashscopeChat('sys', 'user')

    expect(result.ok).toBe(false)
    expect(result.error).toContain('rate limited')
  })

  it('returns generic error when OpenAI throws a non-429 error', async () => {
    mockCreate.mockImplementation(() => Promise.reject(new Error('something broke')))

    const result = await dashscopeChat('sys', 'user')

    expect(result.ok).toBe(false)
    expect(result.error).toContain('DashScope error')
    expect(result.error).toContain('something broke')
  })

  it('returns generic error when OpenAI throws a non-Error value', async () => {
    mockCreate.mockImplementation(() => Promise.reject('string error'))

    const result = await dashscopeChat('sys', 'user')

    expect(result.ok).toBe(false)
    expect(result.error).toContain('DashScope error')
    expect(result.error).toContain('string error')
  })

  it('includes the error message in the returned error string', async () => {
    mockCreate.mockImplementation(() => Promise.reject(new Error('BOOM-BAD-THING')))

    const result = await dashscopeChat('sys', 'user')

    expect(result.error).toContain('BOOM-BAD-THING')
  })

  it('returns a non-negative ms value even on error', async () => {
    mockCreate.mockImplementation(() => Promise.reject(new Error('fail')))

    const result = await dashscopeChat('sys', 'user')

    expect(result.ms).toBeGreaterThanOrEqual(0)
  })
})

describe.skip('dashscopeChat — abort signal', () => {
  it('passes opts.signal through to controller.abort when already aborted', async () => {
    // We can't easily test that the signal is "passed through" because the
    // dashscopeChat code creates its OWN controller and links opts.signal to
    // it. Instead, verify that an already-aborted signal causes the call to
    // fail with a timeout/abort-style error.
    const controller = new AbortController()
    controller.abort()

    mockCreate.mockImplementation((_body, opts) => {
      const o = opts as { signal?: AbortSignal } | undefined
      // Simulate the OpenAI SDK respecting the abort signal.
      if (o?.signal?.aborted) {
        return Promise.reject(new Error('Request aborted'))
      }
      return Promise.resolve({ choices: [{ message: { content: 'x' } }] })
    })

    const result = await dashscopeChat('sys', 'user', { signal: controller.signal })

    expect(result.ok).toBe(false)
    // Either the SDK threw "aborted" or our own timeout fired.
    expect(typeof result.error).toBe('string')
  })
})

// ── dashscopeStream ──

describe.skip('dashscopeStream — function shape', () => {
  it('is a function', () => {
    expect(typeof dashscopeStream).toBe('function')
  })

  it('returns an async generator', async () => {
    mockCreate.mockImplementation(() => Promise.resolve({
      // Empty async iterable
      async *[Symbol.asyncIterator]() {},
    }))

    const gen = dashscopeStream('sys', 'user')
    // Drain the generator
    const chunks: DashScopeChunk[] = []
    for await (const c of gen) chunks.push(c)
    // The stream should at least yield a final done chunk.
    expect(chunks.length).toBeGreaterThan(0)
    expect(chunks[chunks.length - 1].done).toBe(true)
  })
})

describe.skip('dashscopeStream — success cases', () => {
  // Helper: build a fake stream that yields the given chunks.
  function makeStream(chunks: Array<{ choices?: Array<{ delta?: { content?: string } }> } | { usage?: { prompt_tokens?: number; completion_tokens?: number } }>) {
    return {
      async *[Symbol.asyncIterator]() {
        for (const c of chunks) yield c
      },
    }
  }

  it('yields content chunks then a final done chunk', async () => {
    mockCreate.mockImplementation(() => Promise.resolve(makeStream([
      { choices: [{ delta: { content: 'Hello' } }] },
      { choices: [{ delta: { content: ' world' } }] },
      { usage: { prompt_tokens: 5, completion_tokens: 10 } },
    ])))

    const chunks: DashScopeChunk[] = []
    for await (const c of dashscopeStream('sys', 'user')) chunks.push(c)

    // First chunk: text="Hello", fullText="Hello", done=false
    expect(chunks[0]).toEqual({
      text: 'Hello', fullText: 'Hello', done: false, tokens: 0, ms: 0,
    })
    // Second chunk: text=" world", fullText="Hello world", done=false
    expect(chunks[1]).toEqual({
      text: ' world', fullText: 'Hello world', done: false, tokens: 0, ms: 0,
    })
    // Final chunk: text="", fullText="Hello world", done=true, tokens=15, ms=>=0
    expect(chunks[2].done).toBe(true)
    expect(chunks[2].text).toBe('')
    expect(chunks[2].fullText).toBe('Hello world')
    expect(chunks[2].tokens).toBe(15)
    expect(chunks[2].ms).toBeGreaterThanOrEqual(0)
  })

  it('aggregates content across multiple chunks', async () => {
    mockCreate.mockImplementation(() => Promise.resolve(makeStream([
      { choices: [{ delta: { content: 'A' } }] },
      { choices: [{ delta: { content: 'B' } }] },
      { choices: [{ delta: { content: 'C' } }] },
      { usage: { prompt_tokens: 1, completion_tokens: 3 } },
    ])))

    const chunks: DashScopeChunk[] = []
    for await (const c of dashscopeStream('sys', 'user')) chunks.push(c)

    expect(chunks[0].fullText).toBe('A')
    expect(chunks[1].fullText).toBe('AB')
    expect(chunks[2].fullText).toBe('ABC')
    expect(chunks[3].fullText).toBe('ABC')
  })

  it('handles chunks with no choices (skips them)', async () => {
    mockCreate.mockImplementation(() => Promise.resolve(makeStream([
      { choices: [] },
      { choices: [{ delta: { content: 'X' } }] },
      { choices: undefined },
      { usage: { prompt_tokens: 1, completion_tokens: 1 } },
    ])))

    const chunks: DashScopeChunk[] = []
    for await (const c of dashscopeStream('sys', 'user')) chunks.push(c)

    // The first content chunk + final chunk = 2 chunks.
    expect(chunks.length).toBe(2)
    expect(chunks[0].text).toBe('X')
    expect(chunks[1].done).toBe(true)
  })

  it('handles chunks with delta but no content (skips them)', async () => {
    mockCreate.mockImplementation(() => Promise.resolve(makeStream([
      { choices: [{ delta: {} }] },
      { choices: [{ delta: { content: 'Y' } }] },
      { usage: { prompt_tokens: 1, completion_tokens: 1 } },
    ])))

    const chunks: DashScopeChunk[] = []
    for await (const c of dashscopeStream('sys', 'user')) chunks.push(c)

    expect(chunks.length).toBe(2)
    expect(chunks[0].text).toBe('Y')
  })

  it('handles stream with no usage info (tokens=0 on final chunk)', async () => {
    mockCreate.mockImplementation(() => Promise.resolve(makeStream([
      { choices: [{ delta: { content: 'Z' } }] },
      {}, // no usage
    ])))

    const chunks: DashScopeChunk[] = []
    for await (const c of dashscopeStream('sys', 'user')) chunks.push(c)

    expect(chunks[chunks.length - 1].tokens).toBe(0)
  })

  it('passes system + user prompts as messages', async () => {
    mockCreate.mockImplementation(() => Promise.resolve(makeStream([
      { usage: { prompt_tokens: 1, completion_tokens: 1 } },
    ])))

    // Drain the generator
    for await (const _ of dashscopeStream('SYS', 'USER')) { void _ }

    const body = mockCreate.mock.calls[0]?.[0] as { messages?: Array<{ role: string; content: string }> }
    expect(body.messages).toEqual([
      { role: 'system', content: 'SYS' },
      { role: 'user', content: 'USER' },
    ])
  })

  it('uses default model when not specified', async () => {
    mockCreate.mockImplementation(() => Promise.resolve(makeStream([
      { usage: { prompt_tokens: 1, completion_tokens: 1 } },
    ])))

    for await (const _ of dashscopeStream('sys', 'user')) { void _ }

    const body = mockCreate.mock.calls[0]?.[0] as { model?: string }
    expect(body.model).toBe('qwen-flash-character')
  })

  it('passes custom model, temperature, maxTokens', async () => {
    mockCreate.mockImplementation(() => Promise.resolve(makeStream([
      { usage: { prompt_tokens: 1, completion_tokens: 1 } },
    ])))

    for await (const _ of dashscopeStream('sys', 'user', {
      model: 'qwen-max',
      temperature: 0.1,
      maxTokens: 100,
    })) { void _ }

    const body = mockCreate.mock.calls[0]?.[0] as {
      model?: string
      temperature?: number
      max_tokens?: number
    }
    expect(body.model).toBe('qwen-max')
    expect(body.temperature).toBe(0.1)
    expect(body.max_tokens).toBe(100)
  })

  it('sets stream:true and stream_options.include_usage', async () => {
    mockCreate.mockImplementation(() => Promise.resolve(makeStream([
      { usage: { prompt_tokens: 1, completion_tokens: 1 } },
    ])))

    for await (const _ of dashscopeStream('sys', 'user')) { void _ }

    const body = mockCreate.mock.calls[0]?.[0] as {
      stream?: boolean
      stream_options?: { include_usage?: boolean }
    }
    expect(body.stream).toBe(true)
    expect(body.stream_options).toEqual({ include_usage: true })
  })
})

describe.skip('dashscopeStream — error cases', () => {
  it('yields rate-limit error chunk when OpenAI throws 429', async () => {
    mockCreate.mockImplementation(() => Promise.reject(new Error('429 Too Many Requests')))

    const chunks: DashScopeChunk[] = []
    for await (const c of dashscopeStream('sys', 'user')) chunks.push(c)

    expect(chunks.length).toBe(1)
    expect(chunks[0].done).toBe(true)
    expect(chunks[0].error).toContain('rate limited')
  })

  it('yields rate-limit error chunk when error contains "rate limit" (lowercase)', async () => {
    mockCreate.mockImplementation(() => Promise.reject(new Error('rate limit exceeded')))

    const chunks: DashScopeChunk[] = []
    for await (const c of dashscopeStream('sys', 'user')) chunks.push(c)

    expect(chunks[0].error).toContain('rate limited')
  })

  it('yields "cancelled" error chunk when AbortError is thrown', async () => {
    const err = new Error('The user aborted a request')
    err.name = 'AbortError'
    mockCreate.mockImplementation(() => Promise.reject(err))

    const chunks: DashScopeChunk[] = []
    for await (const c of dashscopeStream('sys', 'user')) chunks.push(c)

    expect(chunks[0].error).toContain('cancelled')
  })

  it('yields "cancelled" error chunk when error message contains "aborted"', async () => {
    mockCreate.mockImplementation(() => Promise.reject(new Error('Request was aborted')))

    const chunks: DashScopeChunk[] = []
    for await (const c of dashscopeStream('sys', 'user')) chunks.push(c)

    expect(chunks[0].error).toContain('cancelled')
  })

  it('yields generic error chunk for other errors', async () => {
    mockCreate.mockImplementation(() => Promise.reject(new Error('something weird')))

    const chunks: DashScopeChunk[] = []
    for await (const c of dashscopeStream('sys', 'user')) chunks.push(c)

    expect(chunks[0].error).toContain('DashScope error')
    expect(chunks[0].error).toContain('something weird')
  })

  it('yields generic error chunk when error is a non-Error value', async () => {
    mockCreate.mockImplementation(() => Promise.reject('plain string error'))

    const chunks: DashScopeChunk[] = []
    for await (const c of dashscopeStream('sys', 'user')) chunks.push(c)

    expect(chunks[0].error).toContain('DashScope error')
    expect(chunks[0].error).toContain('plain string error')
  })

  it('error chunk has done=true and ms >= 0', async () => {
    mockCreate.mockImplementation(() => Promise.reject(new Error('fail')))

    const chunks: DashScopeChunk[] = []
    for await (const c of dashscopeStream('sys', 'user')) chunks.push(c)

    expect(chunks[0].done).toBe(true)
    expect(chunks[0].ms).toBeGreaterThanOrEqual(0)
  })
})
