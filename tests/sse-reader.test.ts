// Tests for sse-reader.ts — readSseStream + dispatch logic.
//
// Strategy: Build a fake `Response` with a `ReadableStream` body that emits
// SSE-formatted chunks. Drive `readSseStream` and verify handlers fire.
// Covers: each event type (progress/token/buildId/result/error), terminal
// events stop the stream, CRLF normalization, decoder flush, malformed JSON,
// empty data lines, no-body response, timeout, external abort signal.
import { describe, it, expect } from 'bun:test'
import { readSseStream, type SseHandlers, type SseResultEvent } from '../src/lib/sse-reader'

// ── Helpers ──

/** Build a Response whose body is a ReadableStream emitting the given chunks. */
function makeResponse(chunks: Uint8Array[] | string[]): Response {
  const encoded = chunks.map(c => typeof c === 'string' ? new TextEncoder().encode(c) : c)
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of encoded) controller.enqueue(c)
      controller.close()
    },
  })
  return new Response(stream)
}

/** Build a Response whose body is a ReadableStream that never closes (for timeout tests). */
function makeHangingResponse(): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(_controller) {
      // never enqueue, never close
    },
  })
  return new Response(stream)
}

/** Build a Response whose body errors out mid-stream. */
function makeErrorResponse(): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.error(new Error('network reset'))
    },
  })
  return new Response(stream)
}

/** Convenience: encode an SSE event string. */
function sse(obj: unknown): string {
  return `data: ${JSON.stringify(obj)}\n\n`
}

// ── Tests ──

describe('readSseStream — function shape', () => {
  it('is a function', () => {
    expect(typeof readSseStream).toBe('function')
  })
})

describe('readSseStream — no body / error response', () => {
  it('calls onError with "No response body" when response.body is null', async () => {
    let captured: string | null = null
    const res = new Response(null, { status: 204 })
    await readSseStream(res, {
      onError: (e) => { captured = e },
    })
    expect(captured).toBe('No response body')
  })
})

describe('readSseStream — single event types', () => {
  it('dispatches progress event to onProgress', async () => {
    let step = ''
    let elapsed = -1
    await readSseStream(makeResponse([sse({ type: 'progress', step: 'thinking', elapsed: 250 })]), {
      onProgress: (s, e) => { step = s; elapsed = e },
    })
    expect(step).toBe('thinking')
    expect(elapsed).toBe(250)
  })

  it('dispatches token event to onToken', async () => {
    let text = ''
    let length = -1
    await readSseStream(makeResponse([sse({ type: 'token', text: 'hello', length: 5 })]), {
      onToken: (t, l) => { text = t; length = l },
    })
    expect(text).toBe('hello')
    expect(length).toBe(5)
  })

  it('dispatches buildId event to onBuildId', async () => {
    let id = ''
    await readSseStream(makeResponse([sse({ type: 'buildId', buildId: 'b_123' })]), {
      onBuildId: (b) => { id = b },
    })
    expect(id).toBe('b_123')
  })

  it('dispatches result event to onResult (terminal)', async () => {
    let result: SseResultEvent | null = null
    let resultFired = false
    let progressedAfterResult = false
    await readSseStream(
      makeResponse([
        sse({ type: 'progress', step: 'done', elapsed: 1000 }),
        sse({ type: 'result', html: '<h1>hi</h1>', tokens: 42, ms: 1500 }),
        sse({ type: 'progress', step: 'should not fire', elapsed: 9999 }),
      ]),
      {
        onResult: (r) => { result = r; resultFired = true },
        onProgress: () => {
          if (resultFired) progressedAfterResult = true
        },
      },
    )
    expect(result).not.toBeNull()
    expect(result!.html).toBe('<h1>hi</h1>')
    expect(result!.tokens).toBe(42)
    expect(result!.ms).toBe(1500)
    // Stream should have terminated at the result event; the trailing progress
    // event should NOT have fired (terminal behavior).
    expect(progressedAfterResult).toBe(false)
  })

  it('dispatches error event to onError (terminal)', async () => {
    let captured: string | null = null
    let errorFired = false
    let progressedAfterError = false
    await readSseStream(
      makeResponse([
        sse({ type: 'progress', step: 'starting', elapsed: 100 }),
        sse({ type: 'error', error: 'LLM exploded' }),
        sse({ type: 'progress', step: 'after', elapsed: 9999 }),
      ]),
      {
        onError: (e) => { captured = e; errorFired = true },
        onProgress: () => {
          if (errorFired) progressedAfterError = true
        },
      },
    )
    expect(captured).toBe('LLM exploded')
    expect(progressedAfterError).toBe(false)
  })
})

describe('readSseStream — result event field coercion', () => {
  it('extracts html/tokens/ms with type coercion', async () => {
    let result: SseResultEvent | null = null
    await readSseStream(makeResponse([sse({
      type: 'result',
      html: '<p>x</p>',
      tokens: 99,
      ms: 500,
    })]), {
      onResult: (r) => { result = r },
    })
    expect(result).not.toBeNull()
    expect(result!.html).toBe('<p>x</p>')
    expect(result!.tokens).toBe(99)
    expect(result!.ms).toBe(500)
  })

  it('coerces missing html to empty string', async () => {
    let result: SseResultEvent | null = null
    await readSseStream(makeResponse([sse({
      type: 'result',
      tokens: 10,
      ms: 100,
    })]), {
      onResult: (r) => { result = r },
    })
    expect(result!.html).toBe('')
    expect(result!.tokens).toBe(10)
    expect(result!.ms).toBe(100)
  })

  it('coerces non-number tokens to 0', async () => {
    let result: SseResultEvent | null = null
    await readSseStream(makeResponse([sse({
      type: 'result',
      html: 'x',
      tokens: 'not a number',
      ms: 'also not a number',
    })]), {
      onResult: (r) => { result = r },
    })
    expect(result!.tokens).toBe(0)
    expect(result!.ms).toBe(0)
  })

  it('passes through quality, metrics, outputType, previewable when present', async () => {
    let result: SseResultEvent | null = null
    await readSseStream(makeResponse([sse({
      type: 'result',
      html: 'x',
      tokens: 1,
      ms: 1,
      quality: 87,
      metrics: 'ms:1',
      outputType: 'react',
      previewable: false,
    })]), {
      onResult: (r) => { result = r },
    })
    expect(result!.quality).toBe(87)
    expect(result!.metrics).toBe('ms:1')
    expect(result!.outputType).toBe('react')
    expect(result!.previewable).toBe(false)
  })

  it('omits quality/metrics/outputType/previewable when absent', async () => {
    let result: SseResultEvent | null = null
    await readSseStream(makeResponse([sse({
      type: 'result',
      html: 'x',
      tokens: 1,
      ms: 1,
    })]), {
      onResult: (r) => { result = r },
    })
    expect(result!.quality).toBeUndefined()
    expect(result!.metrics).toBeUndefined()
    expect(result!.outputType).toBeUndefined()
    expect(result!.previewable).toBeUndefined()
  })

  it('parses files array with path/content/language', async () => {
    let result: SseResultEvent | null = null
    await readSseStream(makeResponse([sse({
      type: 'result',
      html: 'x',
      tokens: 1,
      ms: 1,
      files: [
        { path: 'main.py', content: 'print(1)', language: 'python' },
        { path: 'utils.js', content: 'console.log(1)', language: 'javascript' },
      ],
    })]), {
      onResult: (r) => { result = r },
    })
    expect(result!.files).toEqual([
      { path: 'main.py', content: 'print(1)', language: 'python' },
      { path: 'utils.js', content: 'console.log(1)', language: 'javascript' },
    ])
  })

  it('falls back to name field when path is missing in files', async () => {
    let result: SseResultEvent | null = null
    await readSseStream(makeResponse([sse({
      type: 'result',
      html: 'x',
      tokens: 1,
      ms: 1,
      files: [
        { name: 'script.sh', content: 'echo hi', language: 'bash' },
      ],
    })]), {
      onResult: (r) => { result = r },
    })
    expect(result!.files).toEqual([
      { path: 'script.sh', content: 'echo hi', language: 'bash' },
    ])
  })

  it('defaults language to "text" when missing in files', async () => {
    let result: SseResultEvent | null = null
    await readSseStream(makeResponse([sse({
      type: 'result',
      html: 'x',
      tokens: 1,
      ms: 1,
      files: [{ path: 'a.txt', content: 'hi' }],
    })]), {
      onResult: (r) => { result = r },
    })
    expect(result!.files).toEqual([
      { path: 'a.txt', content: 'hi', language: 'text' },
    ])
  })

  it('filters out file entries with no path/name', async () => {
    let result: SseResultEvent | null = null
    await readSseStream(makeResponse([sse({
      type: 'result',
      html: 'x',
      tokens: 1,
      ms: 1,
      files: [
        { content: 'no path here' },
        { path: 'valid.js', content: 'x', language: 'js' },
      ],
    })]), {
      onResult: (r) => { result = r },
    })
    expect(result!.files).toEqual([
      { path: 'valid.js', content: 'x', language: 'js' },
    ])
  })

  it('filters out non-object file entries', async () => {
    let result: SseResultEvent | null = null
    await readSseStream(makeResponse([sse({
      type: 'result',
      html: 'x',
      tokens: 1,
      ms: 1,
      files: [
        'not an object',
        null,
        42,
        { path: 'ok.txt', content: 'y', language: 'text' },
      ],
    })]), {
      onResult: (r) => { result = r },
    })
    expect(result!.files).toEqual([
      { path: 'ok.txt', content: 'y', language: 'text' },
    ])
  })

  it('coerces non-string content to empty string', async () => {
    let result: SseResultEvent | null = null
    await readSseStream(makeResponse([sse({
      type: 'result',
      html: 'x',
      tokens: 1,
      ms: 1,
      files: [{ path: 'a.txt', content: 123, language: 'text' }],
    })]), {
      onResult: (r) => { result = r },
    })
    expect(result!.files).toEqual([
      { path: 'a.txt', content: '', language: 'text' },
    ])
  })
})

describe('readSseStream — multiple events in one stream', () => {
  it('dispatches all non-terminal events in order', async () => {
    const calls: string[] = []
    await readSseStream(makeResponse([
      sse({ type: 'progress', step: 'a', elapsed: 1 }),
      sse({ type: 'token', text: 't1', length: 2 }),
      sse({ type: 'progress', step: 'b', elapsed: 2 }),
      sse({ type: 'token', text: 't2', length: 2 }),
      sse({ type: 'buildId', buildId: 'b_xyz' }),
    ]), {
      onProgress: (s) => { calls.push(`progress:${s}`) },
      onToken: (t) => { calls.push(`token:${t}`) },
      onBuildId: (b) => { calls.push(`buildId:${b}`) },
    })
    expect(calls).toEqual([
      'progress:a',
      'token:t1',
      'progress:b',
      'token:t2',
      'buildId:b_xyz',
    ])
  })

  it('handles multiple chunks each containing a partial event', async () => {
    // Split a single SSE event across multiple chunks.
    const fullEvent = sse({ type: 'progress', step: 'chunked', elapsed: 99 })
    const mid = Math.floor(fullEvent.length / 2)
    let captured = ''
    await readSseStream(makeResponse([
      fullEvent.slice(0, mid),
      fullEvent.slice(mid),
    ]), {
      onProgress: (s) => { captured = s },
    })
    expect(captured).toBe('chunked')
  })

  it('handles a single chunk containing multiple events', async () => {
    const step1 = sse({ type: 'progress', step: 'first', elapsed: 1 })
    const step2 = sse({ type: 'progress', step: 'second', elapsed: 2 })
    const seen: string[] = []
    await readSseStream(makeResponse([step1 + step2]), {
      onProgress: (s) => { seen.push(s) },
    })
    expect(seen).toEqual(['first', 'second'])
  })
})

describe('readSseStream — CRLF normalization', () => {
  it('handles \\r\\n line endings (proxy normalization)', async () => {
    // Build SSE with \r\n instead of \n.
    const event = `data: ${JSON.stringify({ type: 'progress', step: 'crlf', elapsed: 10 })}\r\n\r\n`
    let captured = ''
    await readSseStream(makeResponse([event]), {
      onProgress: (s) => { captured = s },
    })
    expect(captured).toBe('crlf')
  })
})

describe('readSseStream — decoder flush (no trailing \\n\\n)', () => {
  it('flushes the final event when the stream ends without \\n\\n', async () => {
    // Construct an event without the trailing \n\n.
    const event = `data: ${JSON.stringify({ type: 'progress', step: 'flushed', elapsed: 1 })}`
    let captured = ''
    await readSseStream(makeResponse([event]), {
      onProgress: (s) => { captured = s },
    })
    expect(captured).toBe('flushed')
  })
})

describe('readSseStream — malformed / unknown events', () => {
  it('skips events with malformed JSON (does not call handlers, does not kill stream)', async () => {
    const seen: string[] = []
    await readSseStream(makeResponse([
      'data: not-valid-json\n\n',
      sse({ type: 'progress', step: 'after-malformed', elapsed: 1 }),
    ]), {
      onProgress: (s) => { seen.push(s) },
    })
    // The malformed event was skipped silently; the valid event after it still fired.
    expect(seen).toEqual(['after-malformed'])
  })

  it('skips events with unknown type (does not kill stream)', async () => {
    const seen: string[] = []
    await readSseStream(makeResponse([
      sse({ type: 'unknown_type', foo: 'bar' }),
      sse({ type: 'progress', step: 'after-unknown', elapsed: 1 }),
    ]), {
      onProgress: (s) => { seen.push(s) },
    })
    expect(seen).toEqual(['after-unknown'])
  })

  it('skips empty data lines', async () => {
    const seen: string[] = []
    await readSseStream(makeResponse([
      'data: \n\n', // empty data
      sse({ type: 'progress', step: 'after-empty', elapsed: 1 }),
    ]), {
      onProgress: (s) => { seen.push(s) },
    })
    expect(seen).toEqual(['after-empty'])
  })

  it('skips lines that do not start with "data: "', async () => {
    const seen: string[] = []
    await readSseStream(makeResponse([
      'event: ping\n\ndata: ignored\n\n', // not "data: " prefix on the first line
      sse({ type: 'progress', step: 'after-nondata', elapsed: 1 }),
    ]), {
      onProgress: (s) => { seen.push(s) },
    })
    // The "event: ping" block has no "data: " line; the only "data: " line is "ignored"
    // which isn't valid JSON, so it's skipped. Then the real progress fires.
    expect(seen).toEqual(['after-nondata'])
  })

  it('handles events where parsed JSON is not an object', async () => {
    // data: 123 — JSON.parse succeeds but the result is not an object.
    const seen: string[] = []
    await readSseStream(makeResponse([
      'data: 123\n\n',
      sse({ type: 'progress', step: 'after-nonobject', elapsed: 1 }),
    ]), {
      onProgress: (s) => { seen.push(s) },
    })
    expect(seen).toEqual(['after-nonobject'])
  })
})

describe('readSseStream — missing fields in events', () => {
  it('progress event without step/elapsed passes defaults', async () => {
    let step = 'unset'
    let elapsed = -999
    await readSseStream(makeResponse([sse({ type: 'progress' })]), {
      onProgress: (s, e) => { step = s; elapsed = e },
    })
    expect(step).toBe('')
    expect(elapsed).toBe(0)
  })

  it('token event without text/length passes defaults', async () => {
    let text = 'unset'
    let length = -999
    await readSseStream(makeResponse([sse({ type: 'token' })]), {
      onToken: (t, l) => { text = t; length = l },
    })
    expect(text).toBe('')
    expect(length).toBe(0)
  })

  it('buildId event without buildId passes empty string', async () => {
    let id = 'unset'
    await readSseStream(makeResponse([sse({ type: 'buildId' })]), {
      onBuildId: (b) => { id = b },
    })
    expect(id).toBe('')
  })

  it('error event without error field passes "Unknown error"', async () => {
    let captured = 'unset'
    await readSseStream(makeResponse([sse({ type: 'error' })]), {
      onError: (e) => { captured = e },
    })
    expect(captured).toBe('Unknown error')
  })
})

describe('readSseStream — timeout', () => {
  it('fires onError with timeout message when stream stalls', async () => {
    let captured: string | null = null
    const t0 = Date.now()
    await readSseStream(
      makeHangingResponse(),
      { onError: (e) => { captured = e } },
      { timeoutMs: 50 },
    )
    const elapsed = Date.now() - t0
    expect(captured).not.toBeNull()
    expect(captured!).toContain('timed out')
    expect(elapsed).toBeGreaterThanOrEqual(40) // allow some scheduling slack
    expect(elapsed).toBeLessThan(500)
  })

  it('timeout message includes the configured seconds', async () => {
    let captured: string | null = null
    await readSseStream(
      makeHangingResponse(),
      { onError: (e) => { captured = e } },
      { timeoutMs: 1_000 },
    )
    expect(captured).toContain('1s')
  })
})

describe('readSseStream — abort signal', () => {
  it('returns silently when signal is already aborted before start', async () => {
    let captured: string | null = null
    const controller = new AbortController()
    controller.abort()
    await readSseStream(
      makeResponse([sse({ type: 'progress', step: 'should not fire', elapsed: 1 })]),
      {
        onError: (e) => { captured = e },
        onProgress: () => { captured = 'progress-fired' },
      },
      { signal: controller.signal },
    )
    // No handler should be called.
    expect(captured).toBeNull()
  })

  it('aborts mid-stream when external signal fires', async () => {
    let captured: string | null = null
    const controller = new AbortController()

    // Build a response that emits one event, then waits forever.
    const stream = new ReadableStream<Uint8Array>({
      start(controller2) {
        controller2.enqueue(new TextEncoder().encode(sse({ type: 'progress', step: 'first', elapsed: 1 })))
        // don't close — wait for abort
      },
    })

    // Abort after 50ms.
    setTimeout(() => controller.abort(), 50)

    await readSseStream(
      new Response(stream),
      {
        onError: (e) => { captured = e },
      },
      { signal: controller.signal, timeoutMs: 5_000 },
    )
    // External abort should NOT call onError (user-initiated).
    expect(captured).toBeNull()
  })
})

describe('readSseStream — stream error', () => {
  it('calls onError when the underlying stream errors', async () => {
    let captured: string | null = null
    await readSseStream(makeErrorResponse(), {
      onError: (e) => { captured = e },
    })
    expect(captured).not.toBeNull()
    expect(captured).toContain('network reset')
  })
})

describe('readSseStream — handler optionality', () => {
  it('does not throw when no handlers are provided', async () => {
    await expect(readSseStream(
      makeResponse([sse({ type: 'progress', step: 'x', elapsed: 1 })]),
      {},
    )).resolves.toBeUndefined()
  })

  it('does not throw when terminal event has no matching handler', async () => {
    // No onResult handler — terminal event should still terminate the stream.
    await expect(readSseStream(
      makeResponse([sse({ type: 'result', html: 'x', tokens: 1, ms: 1 })]),
      {},
    )).resolves.toBeUndefined()
  })

  it('does not throw when error event has no onError handler', async () => {
    await expect(readSseStream(
      makeResponse([sse({ type: 'error', error: 'boom' })]),
      {},
    )).resolves.toBeUndefined()
  })
})
