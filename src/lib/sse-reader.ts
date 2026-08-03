// Shared SSE reading utility.
//
// NOVA's build and refine routes stream Server-Sent Events to the client.
// Previously, the SSE parsing logic was duplicated inline in 4 places in
// page.tsx (build, autoFix, autoFixLoop, sendChat), with inconsistent behavior:
// - Some flushed the decoder, some didn't (last event lost if no trailing \n\n).
// - Some normalized \r\n, some didn't (broke on proxies that add \r).
// - Some handled 'error' events, some silently dropped them.
// - Some had a timeout, some didn't (could hang forever).
//
// This module provides ONE place to read an SSE stream. All 4 call sites use it.
//
// The reader:
// - Normalizes \r\n to \n (proxy-safe)
// - Flushes the decoder after the stream ends (catches the last event)
// - Has a 90s timeout (prevents hanging forever if the server stalls)
// - Supports an external abort signal (for user-initiated cancel)
// - Calls typed handlers for each event type (progress, token, buildId, result, error)

// ── Types ──

/** Handlers for each SSE event type. All are optional. */
export interface SseHandlers {
  /** Called for { type: 'progress', step, elapsed } events. */
  onProgress?: (step: string, elapsed: number) => void
  /** Called for { type: 'token', text, length } events. */
  onToken?: (text: string, length: number) => void
  /** Called for { type: 'buildId', buildId } events. */
  onBuildId?: (buildId: string) => void
  /** Called for { type: 'result', html, tokens, ms, quality?, metrics? } events. */
  onResult?: (data: SseResultEvent) => void
  /** Called for { type: 'error', error } events OR unrecoverable stream errors. */
  onError?: (error: string) => void
}

/** The shape of a 'result' SSE event from the build/refine routes. */
export interface SseResultEvent {
  html: string
  tokens: number
  ms: number
  quality?: number
  metrics?: string
  /** Optional: multi-file output (files array). */
  files?: Array<{ path: string; content: string; language: string }>
  /** Optional: output type (html-app, react, etc.). */
  outputType?: string
  /** Optional: whether the result can be previewed in an iframe. */
  previewable?: boolean
}

/** Options for readSseStream. */
export interface SseReaderOptions {
  /** External abort signal (e.g., user clicks Cancel). Aborts the reader. */
  signal?: AbortSignal
  /** Hard timeout in ms. Default 90_000 (90s). */
  timeoutMs?: number
}

// ── Constants ──

const DEFAULT_TIMEOUT_MS = 90_000

// ── Main reader ──

/**
 * Read an SSE stream from a fetch Response, dispatching events to handlers.
 *
 * Returns when:
 * - The stream ends naturally (server closes the connection)
 * - A 'result' event is received (terminal — stream is done)
 * - An 'error' event is received (terminal — stream is done)
 * - The timeout fires (90s default — calls onError with a timeout message)
 * - The external abort signal fires (returns silently — no error handler call,
 *   since the user initiated the cancel)
 *
 * Handles:
 * - \r\n normalization (some proxies convert \n to \r\n)
 * - Decoder flush after stream end (catches the last event if no trailing \n\n)
 * - Malformed JSON (skipped silently — doesn't kill the stream)
 * - Empty data lines (skipped)
 *
 * @param response The fetch Response object with a streamable body.
 * @param handlers Callbacks for each event type.
 * @param opts Optional configuration (signal, timeout).
 */
export async function readSseStream(
  response: Response,
  handlers: SseHandlers,
  opts: SseReaderOptions = {}
): Promise<void> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS

  if (!response.body) {
    handlers.onError?.('No response body')
    return
  }

  // Set up the hard timeout — if no event arrives in `timeoutMs`, abort.
  // We reset the timer on every event so a long stream with steady events
  // doesn't time out.
  let timeoutId: ReturnType<typeof setTimeout> | null = null
  let aborted = false

  const resetTimeout = (): void => {
    if (timeoutId) clearTimeout(timeoutId)
    timeoutId = setTimeout(() => {
      aborted = true
      try { reader.cancel() } catch {}
      handlers.onError?.(`Stream timed out after ${Math.round(timeoutMs / 1000)}s with no activity`)
    }, timeoutMs)
  }

  // External abort signal (user clicks Cancel)
  const onExternalAbort = (): void => {
    aborted = true
    if (timeoutId) clearTimeout(timeoutId)
    try { reader.cancel() } catch {}
    // Don't call onError — the user initiated this, not an error
  }
  if (opts.signal) {
    if (opts.signal.aborted) {
      // Already aborted before we started
      return
    }
    opts.signal.addEventListener('abort', onExternalAbort, { once: true })
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  resetTimeout()

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (aborted) break

      buffer += decoder.decode(value, { stream: true })

      // Normalize \r\n to \n — some proxies (nginx, Cloudflare) convert \n to \r\n.
      // Without this, split('\n\n') won't find event boundaries.
      const normalized = buffer.replace(/\r\n/g, '\n')

      // SSE events are separated by a blank line (\n\n).
      // Split, keeping the last (possibly incomplete) chunk in the buffer.
      const events = normalized.split('\n\n')
      buffer = events.pop() ?? ''

      for (const eventStr of events) {
        // Reset the timeout on every event — the stream is alive
        resetTimeout()

        const dataLine = eventStr.trim()
        if (!dataLine.startsWith('data: ')) continue

        const jsonStr = dataLine.slice(6)
        if (!jsonStr) continue

        // Parse and dispatch
        const handled = dispatchEvent(jsonStr, handlers)
        if (handled === 'terminal') {
          // result or error event — stream is done
          if (timeoutId) clearTimeout(timeoutId)
          if (opts.signal) opts.signal.removeEventListener('abort', onExternalAbort)
          return
        }
      }
    }

    // Flush the decoder — any remaining bytes (incomplete multi-byte chars)
    buffer += decoder.decode()

    // Process any remaining complete event in the buffer
    if (buffer.trim() && !aborted) {
      const normalized = buffer.replace(/\r\n/g, '\n')
      const events = normalized.split('\n\n')
      for (const eventStr of events) {
        const dataLine = eventStr.trim()
        if (!dataLine.startsWith('data: ')) continue
        const jsonStr = dataLine.slice(6)
        if (!jsonStr) continue
        const handled = dispatchEvent(jsonStr, handlers)
        if (handled === 'terminal') {
          if (timeoutId) clearTimeout(timeoutId)
          if (opts.signal) opts.signal.removeEventListener('abort', onExternalAbort)
          return
        }
      }
    }
  } catch (err: unknown) {
    if (!aborted) {
      const msg = err instanceof Error ? err.message : String(err)
      handlers.onError?.(msg)
    }
  } finally {
    if (timeoutId) clearTimeout(timeoutId)
    if (opts.signal) opts.signal.removeEventListener('abort', onExternalAbort)
    try { reader.releaseLock() } catch {}
  }
}

// ── Event dispatch ──

type DispatchResult = 'handled' | 'terminal' | 'skipped'

/**
 * Parse and dispatch a single SSE event.
 * Returns 'terminal' if the event was a result or error (stream should end),
 * 'handled' for other event types, 'skipped' for malformed/unknown events.
 */
function dispatchEvent(jsonStr: string, handlers: SseHandlers): DispatchResult {
  let evt: Record<string, unknown>
  try {
    evt = JSON.parse(jsonStr)
  } catch {
    return 'skipped'
  }

  if (!evt || typeof evt !== 'object') return 'skipped'

  const type = evt.type
  switch (type) {
    case 'progress':
      handlers.onProgress?.(String(evt.step ?? ''), Number(evt.elapsed ?? 0))
      return 'handled'
    case 'token':
      handlers.onToken?.(String(evt.text ?? ''), Number(evt.length ?? 0))
      return 'handled'
    case 'buildId':
      handlers.onBuildId?.(String(evt.buildId ?? ''))
      return 'handled'
    case 'result':
      handlers.onResult?.(extractResultEvent(evt))
      return 'terminal'
    case 'error':
      handlers.onError?.(String(evt.error ?? 'Unknown error'))
      return 'terminal'
    default:
      // Unknown event type — don't kill the stream, just skip
      return 'skipped'
  }
}

/**
 * Extract a typed SseResultEvent from a parsed JSON object.
 * Coerces types defensively — LLM output may have missing/wrong-typed fields.
 */
function extractResultEvent(evt: Record<string, unknown>): SseResultEvent {
  const result: SseResultEvent = {
    html: typeof evt.html === 'string' ? evt.html : '',
    tokens: typeof evt.tokens === 'number' ? evt.tokens : 0,
    ms: typeof evt.ms === 'number' ? evt.ms : 0,
  }
  if (typeof evt.quality === 'number') result.quality = evt.quality
  if (typeof evt.metrics === 'string') result.metrics = evt.metrics
  if (typeof evt.outputType === 'string') result.outputType = evt.outputType
  if (typeof evt.previewable === 'boolean') result.previewable = evt.previewable
  if (Array.isArray(evt.files)) {
    result.files = evt.files
      .map((f: unknown) => {
        if (!f || typeof f !== 'object') return null
        const fo = f as Record<string, unknown>
        const path = typeof fo.path === 'string' ? fo.path : (typeof fo.name === 'string' ? fo.name : '')
        const content = typeof fo.content === 'string' ? fo.content : ''
        const language = typeof fo.language === 'string' ? fo.language : 'text'
        return path ? { path, content, language } : null
      })
      .filter((f: { path: string; content: string; language: string } | null): f is { path: string; content: string; language: string } => f !== null)
  }
  return result
}
