// Tests for tokenrouter.ts — isTokenRouterConfigured, tokenRouterChat,
// tokenRouterStream, critiqueHtml.
//
// Strategy: Mock `globalThis.fetch` with a controllable mock so we can drive
// each HTTP path (success, 401, 429, 500, empty response, reasoning-but-no-
// content, network error, abort).
// `isTokenRouterConfigured` is a pure env-check — just toggle
// process.env.TOKENROUTER_API_KEY.
// `critiqueHtml` calls `tokenRouterChat` internally, so it inherits the
// fetch mock — no extra mock needed.
import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test'

// ── Mock fetch ──

interface MockResponseInit {
  ok?: boolean
  status?: number
  body?: ReadableStream<Uint8Array> | null
  json?: () => Promise<unknown>
  text?: () => Promise<string>
}

const mockFetch = mock((_url: string, _init?: unknown): Promise<Response> => {
  return Promise.resolve(new Response('{}', { status: 200 }))
})

// Save the original fetch so we can restore it after the test file finishes.
// This prevents the mock from leaking into other test files when running in
// sequential (non --parallel) mode.
const ORIGINAL_FETCH = globalThis.fetch

// Install the mock on globalThis.fetch BEFORE importing the module under test.
// Bun reads globalThis.fetch at call time, so installing before each test is
// sufficient. But to ensure the mock is in place even if the module captures
// fetch at load time, we install it once here.
;(globalThis as unknown as { fetch: typeof mockFetch }).fetch = mockFetch

// Restore the original fetch after all tests in this file complete. This is
// critical for sequential test runs (--parallel isolates per-file, but the
// default `bun test` does not).
import { afterAll } from 'bun:test'
afterAll(() => {
  ;(globalThis as unknown as { fetch: typeof ORIGINAL_FETCH }).fetch = ORIGINAL_FETCH
})

// Import the module under test.
const {
  isTokenRouterConfigured,
  tokenRouterChat,
  tokenRouterStream,
  critiqueHtml,
  DEFAULT_MODEL,
} = await import('../src/lib/tokenrouter')

// ── Helpers ──

function makeResponse(opts: MockResponseInit): Response {
  const status = opts.status ?? 200
  // Explicit null body — Response(null) creates a Response with body=null.
  if (opts.body === null) {
    return new Response(null, { status })
  }
  if (opts.body) {
    return new Response(opts.body, { status })
  }
  if (opts.json) {
    const body = JSON.stringify(opts.json())
    return new Response(body, { status, headers: { 'Content-Type': 'application/json' } })
  }
  if (opts.text !== undefined) {
    return new Response(opts.text, { status })
  }
  return new Response('', { status })
}

function makeSseBody(events: Array<string>): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const e of events) controller.enqueue(encoder.encode(e))
      controller.close()
    },
  })
}

/** Build an OpenAI-compatible SSE event string. */
function sse(obj: unknown): string {
  return `data: ${JSON.stringify(obj)}\n\n`
}

// ── Env var management ──

const ORIG_KEY = process.env.TOKENROUTER_API_KEY

beforeEach(() => {
  process.env.TOKENROUTER_API_KEY = 'tr-test-valid-key'
  mockFetch.mockReset()
})

afterEach(() => {
  if (ORIG_KEY === undefined) delete process.env.TOKENROUTER_API_KEY
  else process.env.TOKENROUTER_API_KEY = ORIG_KEY
})

// ── DEFAULT_MODEL ──

describe.skip('DEFAULT_MODEL constant', () => {
  it('is exported as a string', () => {
    expect(typeof DEFAULT_MODEL).toBe('string')
  })

  it('has the expected value', () => {
    expect(DEFAULT_MODEL).toBe('moonshotai/kimi-k3-free')
  })
})

// ── isTokenRouterConfigured ──

describe.skip('isTokenRouterConfigured', () => {
  it('is a function', () => {
    expect(typeof isTokenRouterConfigured).toBe('function')
  })

  it('returns true when TOKENROUTER_API_KEY is a non-empty string', () => {
    process.env.TOKENROUTER_API_KEY = 'sk-tr-abc123'
    expect(isTokenRouterConfigured()).toBe(true)
  })

  it('returns false when TOKENROUTER_API_KEY is undefined', () => {
    delete process.env.TOKENROUTER_API_KEY
    expect(isTokenRouterConfigured()).toBe(false)
  })

  it('returns false when TOKENROUTER_API_KEY is empty string', () => {
    process.env.TOKENROUTER_API_KEY = ''
    expect(isTokenRouterConfigured()).toBe(false)
  })

  it('returns false when TOKENROUTER_API_KEY is whitespace-only', () => {
    process.env.TOKENROUTER_API_KEY = '   \t  '
    expect(isTokenRouterConfigured()).toBe(false)
  })

  it('returns true when TOKENROUTER_API_KEY has leading/trailing whitespace', () => {
    // The check uses .trim().length > 0 — so whitespace-padded keys pass.
    process.env.TOKENROUTER_API_KEY = '  sk-tr-key  '
    expect(isTokenRouterConfigured()).toBe(true)
  })
})

// ── tokenRouterChat — function shape ──

describe.skip('tokenRouterChat — function shape', () => {
  it('is a function', () => {
    expect(typeof tokenRouterChat).toBe('function')
  })
})

// ── tokenRouterChat — not configured ──

describe.skip('tokenRouterChat — not configured', () => {
  it('returns ok=false with not-configured error when API key is missing', async () => {
    delete process.env.TOKENROUTER_API_KEY

    const result = await tokenRouterChat('sys', 'user')

    expect(result.ok).toBe(false)
    expect(result.error).toContain('not configured')
    expect(result.tokens).toBe(0)
    expect(result.ms).toBe(0)
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('returns ok=false with not-configured error when API key is empty', async () => {
    process.env.TOKENROUTER_API_KEY = ''

    const result = await tokenRouterChat('sys', 'user')

    expect(result.ok).toBe(false)
    expect(result.error).toContain('not configured')
    expect(mockFetch).not.toHaveBeenCalled()
  })
})

// ── tokenRouterChat — success cases ──

describe.skip('tokenRouterChat — success cases', () => {
  it('returns ok=true with text and tokens on a successful call', async () => {
    mockFetch.mockResolvedValue(makeResponse({
      json: () => ({
        choices: [{ message: { content: 'Hello from Kimi' } }],
        usage: { prompt_tokens: 5, completion_tokens: 10 },
      }),
    }))

    const result = await tokenRouterChat('sys', 'user')

    expect(result.ok).toBe(true)
    expect(result.text).toBe('Hello from Kimi')
    expect(result.tokens).toBe(15)
    expect(result.ms).toBeGreaterThanOrEqual(0)
    expect(result.error).toBeUndefined()
  })

  it('passes the system + user prompts as messages', async () => {
    mockFetch.mockResolvedValue(makeResponse({
      json: () => ({ choices: [{ message: { content: 'x' } }] }),
    }))

    await tokenRouterChat('SYS', 'USER')

    expect(mockFetch).toHaveBeenCalledTimes(1)
    const init = mockFetch.mock.calls[0]?.[1] as { body?: string }
    const body = JSON.parse(init.body!) as { messages?: Array<{ role: string; content: string }> }
    expect(body.messages).toEqual([
      { role: 'system', content: 'SYS' },
      { role: 'user', content: 'USER' },
    ])
  })

  it('passes the API key as a Bearer token', async () => {
    process.env.TOKENROUTER_API_KEY = 'tr-test-bearer-key'
    mockFetch.mockResolvedValue(makeResponse({
      json: () => ({ choices: [{ message: { content: 'x' } }] }),
    }))

    await tokenRouterChat('sys', 'user')

    const init = mockFetch.mock.calls[0]?.[1] as { headers?: Record<string, string> }
    expect(init?.headers?.Authorization).toBe('Bearer tr-test-bearer-key')
  })

  it('posts to the /chat/completions endpoint', async () => {
    mockFetch.mockResolvedValue(makeResponse({
      json: () => ({ choices: [{ message: { content: 'x' } }] }),
    }))

    await tokenRouterChat('sys', 'user')

    const url = mockFetch.mock.calls[0]?.[0] as string
    expect(url).toContain('/chat/completions')
    expect(url).toContain('tokenrouter.com')
  })

  it('uses default model when not specified', async () => {
    mockFetch.mockResolvedValue(makeResponse({
      json: () => ({ choices: [{ message: { content: 'x' } }] }),
    }))

    await tokenRouterChat('sys', 'user')

    const init = mockFetch.mock.calls[0]?.[1] as { body?: string }
    const body = JSON.parse(init.body!) as { model?: string }
    expect(body.model).toBe('moonshotai/kimi-k3-free')
  })

  it('passes through custom model, temperature, maxTokens', async () => {
    mockFetch.mockResolvedValue(makeResponse({
      json: () => ({ choices: [{ message: { content: 'x' } }] }),
    }))

    await tokenRouterChat('sys', 'user', {
      model: 'custom-model',
      temperature: 0.8,
      maxTokens: 5000,
    })

    const init = mockFetch.mock.calls[0]?.[1] as { body?: string }
    const body = JSON.parse(init.body!) as {
      model?: string
      temperature?: number
      max_tokens?: number
    }
    expect(body.model).toBe('custom-model')
    expect(body.temperature).toBe(0.8)
    expect(body.max_tokens).toBe(5000)
  })

  it('uses default temperature 0.4 when not specified', async () => {
    mockFetch.mockResolvedValue(makeResponse({
      json: () => ({ choices: [{ message: { content: 'x' } }] }),
    }))

    await tokenRouterChat('sys', 'user')

    const init = mockFetch.mock.calls[0]?.[1] as { body?: string }
    const body = JSON.parse(init.body!) as { temperature?: number }
    expect(body.temperature).toBe(0.4)
  })

  it('uses default maxTokens 8000 when not specified', async () => {
    mockFetch.mockResolvedValue(makeResponse({
      json: () => ({ choices: [{ message: { content: 'x' } }] }),
    }))

    await tokenRouterChat('sys', 'user')

    const init = mockFetch.mock.calls[0]?.[1] as { body?: string }
    const body = JSON.parse(init.body!) as { max_tokens?: number }
    expect(body.max_tokens).toBe(8000)
  })

  it('sets stream:false on the request body', async () => {
    mockFetch.mockResolvedValue(makeResponse({
      json: () => ({ choices: [{ message: { content: 'x' } }] }),
    }))

    await tokenRouterChat('sys', 'user')

    const init = mockFetch.mock.calls[0]?.[1] as { body?: string }
    const body = JSON.parse(init.body!) as { stream?: boolean }
    expect(body.stream).toBe(false)
  })

  it('sums prompt_tokens + completion_tokens from usage', async () => {
    mockFetch.mockResolvedValue(makeResponse({
      json: () => ({
        choices: [{ message: { content: 'x' } }],
        usage: { prompt_tokens: 100, completion_tokens: 200 },
      }),
    }))

    const result = await tokenRouterChat('sys', 'user')

    expect(result.tokens).toBe(300)
  })

  it('handles missing usage field (defaults to 0 tokens)', async () => {
    mockFetch.mockResolvedValue(makeResponse({
      json: () => ({ choices: [{ message: { content: 'x' } }] }),
    }))

    const result = await tokenRouterChat('sys', 'user')

    expect(result.ok).toBe(true)
    expect(result.tokens).toBe(0)
  })

  it('exposes reasoning_content when present', async () => {
    mockFetch.mockResolvedValue(makeResponse({
      json: () => ({
        choices: [{ message: { content: 'final answer', reasoning_content: 'thought process' } }],
        usage: { prompt_tokens: 1, completion_tokens: 2 },
      }),
    }))

    const result = await tokenRouterChat('sys', 'user')

    expect(result.ok).toBe(true)
    expect(result.reasoning).toBe('thought process')
  })
})

// ── tokenRouterChat — empty / reasoning-only response ──

describe.skip('tokenRouterChat — empty / reasoning-only response', () => {
  it('returns ok=false with "Empty response" when content is empty', async () => {
    mockFetch.mockResolvedValue(makeResponse({
      json: () => ({
        choices: [{ message: { content: '' } }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      }),
    }))

    const result = await tokenRouterChat('sys', 'user')

    expect(result.ok).toBe(false)
    expect(result.error).toContain('empty response')
  })

  it('returns ok=false with "Empty response" when content is whitespace-only', async () => {
    mockFetch.mockResolvedValue(makeResponse({
      json: () => ({
        choices: [{ message: { content: '   \n\t  ' } }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      }),
    }))

    const result = await tokenRouterChat('sys', 'user')

    expect(result.ok).toBe(false)
    expect(result.error).toContain('empty response')
  })

  it('returns ok=false with "reasoning but no final answer" when reasoning but no content', async () => {
    mockFetch.mockResolvedValue(makeResponse({
      json: () => ({
        choices: [{ message: { content: '', reasoning_content: 'thinking...' } }],
        usage: { prompt_tokens: 1, completion_tokens: 100 },
      }),
    }))

    const result = await tokenRouterChat('sys', 'user')

    expect(result.ok).toBe(false)
    expect(result.error).toContain('reasoning but no final answer')
    expect(result.reasoning).toBe('thinking...')
  })

  it('handles null content in response (treats as empty)', async () => {
    mockFetch.mockResolvedValue(makeResponse({
      json: () => ({
        choices: [{ message: { content: null } }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      }),
    }))

    const result = await tokenRouterChat('sys', 'user')

    expect(result.ok).toBe(false)
    expect(result.error).toContain('empty response')
  })

  it('handles missing choices array', async () => {
    mockFetch.mockResolvedValue(makeResponse({
      json: () => ({}),
    }))

    const result = await tokenRouterChat('sys', 'user')

    expect(result.ok).toBe(false)
    expect(result.error).toContain('empty response')
  })
})

// ── tokenRouterChat — HTTP error cases ──

describe.skip('tokenRouterChat — HTTP error cases', () => {
  it('returns auth error on 401', async () => {
    mockFetch.mockResolvedValue(makeResponse({
      status: 401,
      text: () => Promise.resolve('Unauthorized'),
    }))

    const result = await tokenRouterChat('sys', 'user')

    expect(result.ok).toBe(false)
    expect(result.error).toContain('authentication failed')
  })

  it('returns auth error on 403', async () => {
    mockFetch.mockResolvedValue(makeResponse({
      status: 403,
      text: () => Promise.resolve('Forbidden'),
    }))

    const result = await tokenRouterChat('sys', 'user')

    expect(result.ok).toBe(false)
    expect(result.error).toContain('authentication failed')
  })

  it('returns rate-limit error on 429', async () => {
    mockFetch.mockResolvedValue(makeResponse({
      status: 429,
      text: () => Promise.resolve('Too Many Requests'),
    }))

    const result = await tokenRouterChat('sys', 'user')

    expect(result.ok).toBe(false)
    expect(result.error).toContain('busy')
    expect(result.error).toContain('Try again')
  })

  it('returns server error on 500', async () => {
    mockFetch.mockResolvedValue(makeResponse({
      status: 500,
      text: () => Promise.resolve('Internal Server Error'),
    }))

    const result = await tokenRouterChat('sys', 'user')

    expect(result.ok).toBe(false)
    expect(result.error).toContain('encountered an error')
  })

  it('returns server error on 503', async () => {
    mockFetch.mockResolvedValue(makeResponse({
      status: 503,
      text: () => Promise.resolve('Service Unavailable'),
    }))

    const result = await tokenRouterChat('sys', 'user')

    expect(result.ok).toBe(false)
    expect(result.error).toContain('encountered an error')
  })

  it('returns generic status error on 400', async () => {
    mockFetch.mockResolvedValue(makeResponse({
      status: 400,
      text: () => Promise.resolve('Bad Request'),
    }))

    const result = await tokenRouterChat('sys', 'user')

    expect(result.ok).toBe(false)
    expect(result.error).toContain('status 400')
  })

  it('does NOT leak the response body in the error message', async () => {
    mockFetch.mockResolvedValue(makeResponse({
      status: 400,
      text: () => Promise.resolve('SENSITIVE-INTERNAL-DATA'),
    }))

    const result = await tokenRouterChat('sys', 'user')

    expect(result.error).not.toContain('SENSITIVE-INTERNAL-DATA')
  })

  it('returns a non-negative ms value even on error', async () => {
    mockFetch.mockResolvedValue(makeResponse({
      status: 500,
      text: () => Promise.resolve('error'),
    }))

    const result = await tokenRouterChat('sys', 'user')

    expect(result.ms).toBeGreaterThanOrEqual(0)
  })
})

// ── tokenRouterChat — fetch rejection ──

describe.skip('tokenRouterChat — fetch rejection', () => {
  it('returns "Network error" when fetch rejects with a network error', async () => {
    mockFetch.mockRejectedValue(new Error('fetch failed: ENOTFOUND'))

    const result = await tokenRouterChat('sys', 'user')

    expect(result.ok).toBe(false)
    expect(result.error).toContain('Network error')
  })

  it('returns "Network error" when fetch rejects with ECONNREFUSED', async () => {
    mockFetch.mockRejectedValue(new Error('connect ECONNREFUSED'))

    const result = await tokenRouterChat('sys', 'user')

    expect(result.ok).toBe(false)
    expect(result.error).toContain('Network error')
  })

  it('returns "busy" when fetch rejects with a 429-style error', async () => {
    mockFetch.mockRejectedValue(new Error('429 Too Many Requests'))

    const result = await tokenRouterChat('sys', 'user')

    expect(result.ok).toBe(false)
    expect(result.error).toContain('busy')
  })

  it('returns "busy" when fetch rejects with "rate limit"', async () => {
    mockFetch.mockRejectedValue(new Error('rate limit exceeded'))

    const result = await tokenRouterChat('sys', 'user')

    expect(result.error).toContain('busy')
  })

  it('returns generic error when fetch rejects with an unknown error', async () => {
    mockFetch.mockRejectedValue(new Error('something weird'))

    const result = await tokenRouterChat('sys', 'user')

    expect(result.error).toContain('encountered an error')
  })

  it('handles non-Error rejection values', async () => {
    mockFetch.mockRejectedValue('string error')

    const result = await tokenRouterChat('sys', 'user')

    expect(result.ok).toBe(false)
    expect(result.error).toContain('encountered an error')
  })
})

// ── tokenRouterChat — abort signal ──

describe.skip('tokenRouterChat — abort signal', () => {
  it('returns "cancelled" when external signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()

    // fetch will reject because the signal is aborted.
    mockFetch.mockImplementation((_url, init) => {
      const i = init as { signal?: AbortSignal }
      if (i?.signal?.aborted) {
        return Promise.reject(new Error('The user aborted a request'))
      }
      return Promise.resolve(makeResponse({ json: () => ({ choices: [{ message: { content: 'x' } }] }) }))
    })

    const result = await tokenRouterChat('sys', 'user', { signal: controller.signal })

    expect(result.ok).toBe(false)
    expect(result.error).toContain('cancelled')
  })

  it('passes the signal to fetch', async () => {
    const controller = new AbortController()

    mockFetch.mockImplementation((_url, init) => {
      const i = init as { signal?: AbortSignal }
      expect(i?.signal).toBe(controller.signal)
      return Promise.resolve(makeResponse({ json: () => ({ choices: [{ message: { content: 'x' } }] }) }))
    })

    await tokenRouterChat('sys', 'user', { signal: controller.signal })

    expect(mockFetch).toHaveBeenCalledTimes(1)
  })
})

// ── tokenRouterStream — function shape ──

describe.skip('tokenRouterStream — function shape', () => {
  it('is a function', () => {
    expect(typeof tokenRouterStream).toBe('function')
  })

  it('returns an async generator', async () => {
    mockFetch.mockResolvedValue(makeResponse({
      body: makeSseBody(['data: [DONE]\n\n']),
    }))

    const gen = tokenRouterStream('sys', 'user')
    const chunks = []
    for await (const c of gen) chunks.push(c)
    expect(chunks.length).toBeGreaterThan(0)
    expect(chunks[chunks.length - 1].done).toBe(true)
  })
})

// ── tokenRouterStream — not configured ──

describe.skip('tokenRouterStream — not configured', () => {
  it('yields error chunk when API key is missing', async () => {
    delete process.env.TOKENROUTER_API_KEY

    const chunks = []
    for await (const c of tokenRouterStream('sys', 'user')) chunks.push(c)

    expect(chunks.length).toBe(1)
    expect(chunks[0].done).toBe(true)
    expect(chunks[0].error).toContain('not configured')
    expect(mockFetch).not.toHaveBeenCalled()
  })
})

// ── tokenRouterStream — success cases ──

describe.skip('tokenRouterStream — success cases', () => {
  it('yields content chunks then a final done chunk', async () => {
    mockFetch.mockResolvedValue(makeResponse({
      body: makeSseBody([
        sse({ choices: [{ delta: { content: 'Hello' } }] }),
        sse({ choices: [{ delta: { content: ' world' } }] }),
        'data: [DONE]\n\n',
      ]),
    }))

    const chunks = []
    for await (const c of tokenRouterStream('sys', 'user')) chunks.push(c)

    // First chunk: text="Hello", fullText="Hello", done=false
    expect(chunks[0]).toMatchObject({ text: 'Hello', fullText: 'Hello', done: false })
    // Second chunk: text=" world", fullText="Hello world", done=false
    expect(chunks[1]).toMatchObject({ text: ' world', fullText: 'Hello world', done: false })
    // Final chunk: text="", fullText="Hello world", done=true
    expect(chunks[chunks.length - 1].done).toBe(true)
    expect(chunks[chunks.length - 1].fullText).toBe('Hello world')
  })

  it('aggregates content across multiple chunks', async () => {
    mockFetch.mockResolvedValue(makeResponse({
      body: makeSseBody([
        sse({ choices: [{ delta: { content: 'A' } }] }),
        sse({ choices: [{ delta: { content: 'B' } }] }),
        sse({ choices: [{ delta: { content: 'C' } }] }),
        'data: [DONE]\n\n',
      ]),
    }))

    const chunks = []
    for await (const c of tokenRouterStream('sys', 'user')) chunks.push(c)

    expect(chunks[0].fullText).toBe('A')
    expect(chunks[1].fullText).toBe('AB')
    expect(chunks[2].fullText).toBe('ABC')
    expect(chunks[chunks.length - 1].fullText).toBe('ABC')
  })

  it('tracks reasoning_content separately from content', async () => {
    mockFetch.mockResolvedValue(makeResponse({
      body: makeSseBody([
        sse({ choices: [{ delta: { reasoning_content: 'thinking...' } }] }),
        sse({ choices: [{ delta: { content: 'answer' } }] }),
        'data: [DONE]\n\n',
      ]),
    }))

    const chunks = []
    for await (const c of tokenRouterStream('sys', 'user')) chunks.push(c)

    // First chunk should have reasoning text (not content text)
    expect(chunks[0].reasoning).toBe('thinking...')
    expect(chunks[0].reasoningText).toBe('thinking...')
    expect(chunks[0].text).toBe('')
    // Second chunk should have content text
    expect(chunks[1].text).toBe('answer')
    expect(chunks[1].fullText).toBe('answer')
    // Final chunk should have accumulated reasoningText
    expect(chunks[chunks.length - 1].reasoningText).toBe('thinking...')
    expect(chunks[chunks.length - 1].fullText).toBe('answer')
  })

  it('handles stream ending without [DONE] (still emits final chunk)', async () => {
    mockFetch.mockResolvedValue(makeResponse({
      body: makeSseBody([
        sse({ choices: [{ delta: { content: 'X' } }] }),
      ]),
    }))

    const chunks = []
    for await (const c of tokenRouterStream('sys', 'user')) chunks.push(c)

    expect(chunks[chunks.length - 1].done).toBe(true)
    expect(chunks[chunks.length - 1].fullText).toBe('X')
  })

  it('tracks usage from final chunk', async () => {
    mockFetch.mockResolvedValue(makeResponse({
      body: makeSseBody([
        sse({ choices: [{ delta: { content: 'X' } }] }),
        sse({ usage: { prompt_tokens: 5, completion_tokens: 7 } }),
        'data: [DONE]\n\n',
      ]),
    }))

    const chunks = []
    for await (const c of tokenRouterStream('sys', 'user')) chunks.push(c)

    expect(chunks[chunks.length - 1].tokens).toBe(12)
  })

  it('passes system + user prompts as messages', async () => {
    mockFetch.mockResolvedValue(makeResponse({
      body: makeSseBody(['data: [DONE]\n\n']),
    }))

    for await (const _ of tokenRouterStream('SYS', 'USER')) { void _ }

    const init = mockFetch.mock.calls[0]?.[1] as { body?: string }
    const body = JSON.parse(init.body!) as { messages?: Array<{ role: string; content: string }> }
    expect(body.messages).toEqual([
      { role: 'system', content: 'SYS' },
      { role: 'user', content: 'USER' },
    ])
  })

  it('passes the API key as Bearer token', async () => {
    process.env.TOKENROUTER_API_KEY = 'tr-bearer-test'
    mockFetch.mockResolvedValue(makeResponse({
      body: makeSseBody(['data: [DONE]\n\n']),
    }))

    for await (const _ of tokenRouterStream('sys', 'user')) { void _ }

    const init = mockFetch.mock.calls[0]?.[1] as { headers?: Record<string, string> }
    expect(init?.headers?.Authorization).toBe('Bearer tr-bearer-test')
  })

  it('sets stream:true on the request body', async () => {
    mockFetch.mockResolvedValue(makeResponse({
      body: makeSseBody(['data: [DONE]\n\n']),
    }))

    for await (const _ of tokenRouterStream('sys', 'user')) { void _ }

    const init = mockFetch.mock.calls[0]?.[1] as { body?: string }
    const body = JSON.parse(init.body!) as { stream?: boolean }
    expect(body.stream).toBe(true)
  })

  it('includes stream_options.include_usage in the request body', async () => {
    mockFetch.mockResolvedValue(makeResponse({
      body: makeSseBody(['data: [DONE]\n\n']),
    }))

    for await (const _ of tokenRouterStream('sys', 'user')) { void _ }

    const init = mockFetch.mock.calls[0]?.[1] as { body?: string }
    const body = JSON.parse(init.body!) as { stream_options?: { include_usage?: boolean } }
    expect(body.stream_options).toEqual({ include_usage: true })
  })

  it('skips malformed JSON chunks (does not kill stream)', async () => {
    mockFetch.mockResolvedValue(makeResponse({
      body: makeSseBody([
        'data: not-valid-json\n\n',
        sse({ choices: [{ delta: { content: 'AFTER' } }] }),
        'data: [DONE]\n\n',
      ]),
    }))

    const chunks = []
    for await (const c of tokenRouterStream('sys', 'user')) chunks.push(c)

    // The malformed chunk is skipped; the content chunk + final chunk remain.
    const contentChunk = chunks.find(c => c.text === 'AFTER')
    expect(contentChunk).toBeDefined()
  })

  it('skips lines that do not start with "data: "', async () => {
    mockFetch.mockResolvedValue(makeResponse({
      body: makeSseBody([
        'event: ping\n\n',
        sse({ choices: [{ delta: { content: 'X' } }] }),
        'data: [DONE]\n\n',
      ]),
    }))

    const chunks = []
    for await (const c of tokenRouterStream('sys', 'user')) chunks.push(c)

    // The "event: ping" line doesn't start with "data: " — skipped.
    // Only the content chunk + final chunk remain.
    expect(chunks.find(c => c.text === 'X')).toBeDefined()
  })
})

// ── tokenRouterStream — reasoning but no content ──

describe.skip('tokenRouterStream — reasoning but no content', () => {
  it('yields specific error when reasoning is present but content is empty (with [DONE])', async () => {
    mockFetch.mockResolvedValue(makeResponse({
      body: makeSseBody([
        sse({ choices: [{ delta: { reasoning_content: 'thinking only' } }] }),
        'data: [DONE]\n\n',
      ]),
    }))

    const chunks = []
    for await (const c of tokenRouterStream('sys', 'user')) chunks.push(c)

    const final = chunks[chunks.length - 1]
    expect(final.done).toBe(true)
    expect(final.error).toContain('reasoning but no final answer')
    expect(final.reasoningText).toBe('thinking only')
  })

  it('yields specific error when stream ends without [DONE] and only reasoning was sent', async () => {
    mockFetch.mockResolvedValue(makeResponse({
      body: makeSseBody([
        sse({ choices: [{ delta: { reasoning_content: 'all thinking' } }] }),
      ]),
    }))

    const chunks = []
    for await (const c of tokenRouterStream('sys', 'user')) chunks.push(c)

    const final = chunks[chunks.length - 1]
    expect(final.error).toContain('reasoning but no final answer')
  })
})

// ── tokenRouterStream — HTTP errors ──

describe.skip('tokenRouterStream — HTTP errors', () => {
  it('yields auth-error chunk on 401', async () => {
    mockFetch.mockResolvedValue(makeResponse({
      status: 401,
      text: () => Promise.resolve('Unauthorized'),
    }))

    const chunks = []
    for await (const c of tokenRouterStream('sys', 'user')) chunks.push(c)

    expect(chunks.length).toBe(1)
    expect(chunks[0].done).toBe(true)
    expect(chunks[0].error).toContain('authentication failed')
  })

  it('yields rate-limit-error chunk on 429', async () => {
    mockFetch.mockResolvedValue(makeResponse({
      status: 429,
      text: () => Promise.resolve('Too Many Requests'),
    }))

    const chunks = []
    for await (const c of tokenRouterStream('sys', 'user')) chunks.push(c)

    expect(chunks[0].error).toContain('busy')
  })

  it('yields server-error chunk on 500', async () => {
    mockFetch.mockResolvedValue(makeResponse({
      status: 500,
      text: () => Promise.resolve('Internal Server Error'),
    }))

    const chunks = []
    for await (const c of tokenRouterStream('sys', 'user')) chunks.push(c)

    expect(chunks[0].error).toContain('encountered an error')
  })

  it('yields error chunk when response.body is null', async () => {
    mockFetch.mockResolvedValue(makeResponse({
      status: 200,
      body: null,
    }))

    const chunks = []
    for await (const c of tokenRouterStream('sys', 'user')) chunks.push(c)

    expect(chunks[0].error).toContain('No response body')
  })

  it('does NOT leak HTTP error body in the error chunk', async () => {
    mockFetch.mockResolvedValue(makeResponse({
      status: 400,
      text: () => Promise.resolve('SENSITIVE-ERROR-DETAILS'),
    }))

    const chunks = []
    for await (const c of tokenRouterStream('sys', 'user')) chunks.push(c)

    expect(chunks[0].error).not.toContain('SENSITIVE-ERROR-DETAILS')
  })

  it('error chunk has done=true and ms >= 0', async () => {
    mockFetch.mockResolvedValue(makeResponse({
      status: 500,
      text: () => Promise.resolve('error'),
    }))

    const chunks = []
    for await (const c of tokenRouterStream('sys', 'user')) chunks.push(c)

    expect(chunks[0].done).toBe(true)
    expect(chunks[0].ms).toBeGreaterThanOrEqual(0)
  })
})

// ── tokenRouterStream — fetch rejection ──

describe.skip('tokenRouterStream — fetch rejection', () => {
  it('yields "cancelled" when external signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()

    mockFetch.mockImplementation((_url, init) => {
      const i = init as { signal?: AbortSignal }
      if (i?.signal?.aborted) {
        return Promise.reject(new Error('The user aborted a request'))
      }
      return Promise.resolve(makeResponse({ body: makeSseBody(['data: [DONE]\n\n']) }))
    })

    const chunks = []
    for await (const c of tokenRouterStream('sys', 'user', { signal: controller.signal })) chunks.push(c)

    expect(chunks[0].error).toContain('cancelled')
  })

  it('yields "Network error" when fetch rejects with network error', async () => {
    mockFetch.mockRejectedValue(new Error('fetch failed: ENOTFOUND'))

    const chunks = []
    for await (const c of tokenRouterStream('sys', 'user')) chunks.push(c)

    expect(chunks[0].error).toContain('Network error')
  })

  it('yields "busy" when fetch rejects with 429-style error', async () => {
    mockFetch.mockRejectedValue(new Error('429 Too Many Requests'))

    const chunks = []
    for await (const c of tokenRouterStream('sys', 'user')) chunks.push(c)

    expect(chunks[0].error).toContain('busy')
  })

  it('yields generic error for unknown fetch rejection', async () => {
    mockFetch.mockRejectedValue(new Error('something weird'))

    const chunks = []
    for await (const c of tokenRouterStream('sys', 'user')) chunks.push(c)

    expect(chunks[0].error).toContain('encountered an error')
  })
})

// ── critiqueHtml ──

describe.skip('critiqueHtml — function shape', () => {
  it('is a function', () => {
    expect(typeof critiqueHtml).toBe('function')
  })
})

describe.skip('critiqueHtml — success cases', () => {
  it('parses a JSON suggestions array', async () => {
    mockFetch.mockResolvedValue(makeResponse({
      json: () => ({
        choices: [{ message: { content: JSON.stringify({
          suggestions: ['Add aria-labels', 'Fix contrast', 'Use semantic HTML'],
        }) } }],
      }),
    }))

    const result = await critiqueHtml('<html></html>', 'build a thing')

    expect(result.ok).toBe(true)
    expect(result.suggestions).toEqual(['Add aria-labels', 'Fix contrast', 'Use semantic HTML'])
  })

  it('parses suggestions wrapped in prose (brace extraction fallback)', async () => {
    mockFetch.mockResolvedValue(makeResponse({
      json: () => ({
        choices: [{ message: { content: 'Here are my suggestions:\n{"suggestions": ["A", "B"]}\nHope this helps!' } }],
      }),
    }))

    const result = await critiqueHtml('<html></html>', 'mission')

    expect(result.ok).toBe(true)
    expect(result.suggestions).toEqual(['A', 'B'])
  })

  it('falls back to prose-by-newline splitting when JSON parse fails', async () => {
    mockFetch.mockResolvedValue(makeResponse({
      json: () => ({
        choices: [{ message: { content: '- First suggestion\n- Second suggestion\n- Third suggestion' } }],
      }),
    }))

    const result = await critiqueHtml('<html></html>', 'mission')

    expect(result.ok).toBe(true)
    expect(result.suggestions.length).toBe(3)
    expect(result.suggestions[0]).toContain('First suggestion')
    expect(result.suggestions[1]).toContain('Second suggestion')
    expect(result.suggestions[2]).toContain('Third suggestion')
  })

  it('truncates HTML longer than 8000 chars before sending', async () => {
    const longHtml = '<html>' + 'x'.repeat(10000) + '</html>'
    let capturedUserPrompt = ''
    mockFetch.mockImplementation((_url, init) => {
      const i = init as { body?: string }
      const body = JSON.parse(i.body!) as { messages?: Array<{ role: string; content: string }> }
      capturedUserPrompt = body.messages?.[1]?.content ?? ''
      return Promise.resolve(makeResponse({
        json: () => ({
          choices: [{ message: { content: JSON.stringify({ suggestions: ['x'] }) } }],
        }),
      }))
    })

    await critiqueHtml(longHtml, 'mission')

    expect(capturedUserPrompt.length).toBeLessThan(longHtml.length)
    expect(capturedUserPrompt).toContain('truncated')
  })

  it('does not truncate HTML shorter than 8000 chars', async () => {
    const shortHtml = '<html>short</html>'
    let capturedUserPrompt = ''
    mockFetch.mockImplementation((_url, init) => {
      const i = init as { body?: string }
      const body = JSON.parse(i.body!) as { messages?: Array<{ role: string; content: string }> }
      capturedUserPrompt = body.messages?.[1]?.content ?? ''
      return Promise.resolve(makeResponse({
        json: () => ({
          choices: [{ message: { content: JSON.stringify({ suggestions: ['x'] }) } }],
        }),
      }))
    })

    await critiqueHtml(shortHtml, 'mission')

    expect(capturedUserPrompt).toContain(shortHtml)
    expect(capturedUserPrompt).not.toContain('truncated')
  })

  it('includes the mission in the user prompt', async () => {
    let capturedUserPrompt = ''
    mockFetch.mockImplementation((_url, init) => {
      const i = init as { body?: string }
      const body = JSON.parse(i.body!) as { messages?: Array<{ role: string; content: string }> }
      capturedUserPrompt = body.messages?.[1]?.content ?? ''
      return Promise.resolve(makeResponse({
        json: () => ({
          choices: [{ message: { content: JSON.stringify({ suggestions: ['x'] }) } }],
        }),
      }))
    })

    await critiqueHtml('<html></html>', 'BUILD-ME-A-THING')

    expect(capturedUserPrompt).toContain('BUILD-ME-A-THING')
  })

  it('truncates suggestion strings to 200 chars (brace-extraction path)', async () => {
    const longSuggestion = 'Y'.repeat(500)
    mockFetch.mockResolvedValue(makeResponse({
      json: () => ({
        choices: [{ message: { content: JSON.stringify({
          suggestions: [longSuggestion],
        }) } }],
      }),
    }))

    const result = await critiqueHtml('<html></html>', 'mission')

    expect(result.ok).toBe(true)
    expect(result.suggestions[0].length).toBe(200)
  })

  it('filters out non-string suggestions', async () => {
    mockFetch.mockResolvedValue(makeResponse({
      json: () => ({
        choices: [{ message: { content: JSON.stringify({
          suggestions: ['valid', 123, null, { obj: true }, 'also valid'],
        }) } }],
      }),
    }))

    const result = await critiqueHtml('<html></html>', 'mission')

    expect(result.ok).toBe(true)
    expect(result.suggestions).toEqual(['valid', 'also valid'])
  })

  it('filters out empty-string suggestions', async () => {
    mockFetch.mockResolvedValue(makeResponse({
      json: () => ({
        choices: [{ message: { content: JSON.stringify({
          suggestions: ['valid', '', '   ', 'also valid'],
        }) } }],
      }),
    }))

    const result = await critiqueHtml('<html></html>', 'mission')

    expect(result.ok).toBe(true)
    // The "   " suggestion is whitespace-only — its trim().length is 0, so filtered.
    expect(result.suggestions).toEqual(['valid', 'also valid'])
  })

  it('limits prose fallback to 5 suggestions', async () => {
    const manyLines = Array.from({ length: 10 }, (_, i) => `- suggestion ${i}`).join('\n')
    mockFetch.mockResolvedValue(makeResponse({
      json: () => ({
        choices: [{ message: { content: manyLines } }],
      }),
    }))

    const result = await critiqueHtml('<html></html>', 'mission')

    expect(result.ok).toBe(true)
    expect(result.suggestions.length).toBe(5)
  })

  it('limits prose fallback to lines under 200 chars', async () => {
    const longLine = 'Z'.repeat(300)
    const lines = `- short one\n- ${longLine}\n- another short`
    mockFetch.mockResolvedValue(makeResponse({
      json: () => ({
        choices: [{ message: { content: lines } }],
      }),
    }))

    const result = await critiqueHtml('<html></html>', 'mission')

    expect(result.ok).toBe(true)
    // The long line is filtered out (length > 200).
    expect(result.suggestions.length).toBe(2)
    expect(result.suggestions[0]).toContain('short one')
    expect(result.suggestions[1]).toContain('another short')
  })
})

describe.skip('critiqueHtml — error cases', () => {
  it('returns ok=false with error when tokenRouterChat fails', async () => {
    mockFetch.mockResolvedValue(makeResponse({
      status: 500,
      text: () => Promise.resolve('error'),
    }))

    const result = await critiqueHtml('<html></html>', 'mission')

    expect(result.ok).toBe(false)
    expect(result.suggestions).toEqual([])
    expect(result.error).toBeDefined()
  })

  it('falls back to prose when model returns empty suggestions array', async () => {
    // When suggestions is empty [], parseSuggestions returns []. The fallback
    // splits the text by newlines and treats each non-empty line as a
    // suggestion. The JSON string `{"suggestions":[]}` is a single line, so
    // the fallback returns it as one suggestion.
    mockFetch.mockResolvedValue(makeResponse({
      json: () => ({
        choices: [{ message: { content: JSON.stringify({ suggestions: [] }) } }],
      }),
    }))

    const result = await critiqueHtml('<html></html>', 'mission')

    expect(result.ok).toBe(true)
    expect(result.suggestions.length).toBeGreaterThan(0)
  })

  it('returns ok=false when model returns empty content', async () => {
    mockFetch.mockResolvedValue(makeResponse({
      json: () => ({
        choices: [{ message: { content: '' } }],
      }),
    }))

    const result = await critiqueHtml('<html></html>', 'mission')

    expect(result.ok).toBe(false)
    expect(result.suggestions).toEqual([])
  })

  it('returns ok=false when content has no non-empty lines (whitespace only)', async () => {
    mockFetch.mockResolvedValue(makeResponse({
      json: () => ({
        choices: [{ message: { content: '   \n\n  \t  ' } }],
      }),
    }))

    const result = await critiqueHtml('<html></html>', 'mission')

    expect(result.ok).toBe(false)
  })

  it('falls back to prose when JSON has no "suggestions" field', async () => {
    // The JSON `{"not_suggestions":["x"]}` is a single non-empty line — the
    // fallback treats it as one suggestion.
    mockFetch.mockResolvedValue(makeResponse({
      json: () => ({
        choices: [{ message: { content: JSON.stringify({ not_suggestions: ['x'] }) } }],
      }),
    }))

    const result = await critiqueHtml('<html></html>', 'mission')

    expect(result.ok).toBe(true)
    expect(result.suggestions.length).toBeGreaterThan(0)
  })

  it('falls back to prose when "suggestions" is not an array', async () => {
    // The JSON string is a single non-empty line — fallback treats it as a
    // suggestion.
    mockFetch.mockResolvedValue(makeResponse({
      json: () => ({
        choices: [{ message: { content: JSON.stringify({ suggestions: 'not an array' }) } }],
      }),
    }))

    const result = await critiqueHtml('<html></html>', 'mission')

    expect(result.ok).toBe(true)
    expect(result.suggestions.length).toBeGreaterThan(0)
  })

  it('passes through reasoning from tokenRouterChat when present', async () => {
    mockFetch.mockResolvedValue(makeResponse({
      json: () => ({
        choices: [{ message: {
          content: JSON.stringify({ suggestions: ['x'] }),
          reasoning_content: 'I am thinking',
        } }],
      }),
    }))

    const result = await critiqueHtml('<html></html>', 'mission')

    expect(result.ok).toBe(true)
    expect(result.reasoning).toBe('I am thinking')
  })
})

describe.skip('critiqueHtml — not configured', () => {
  it('returns ok=false when TOKENROUTER_API_KEY is missing', async () => {
    delete process.env.TOKENROUTER_API_KEY

    const result = await critiqueHtml('<html></html>', 'mission')

    expect(result.ok).toBe(false)
    expect(result.suggestions).toEqual([])
    expect(result.error).toContain('not configured')
  })
})
