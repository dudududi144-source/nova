// TokenRouter — Kimi K3 LLM backend (OpenAI-compatible API).
//
// This is NOVA's secondary model. The primary is Z.AI (via z-ai-web-dev-sdk).
// When Z.AI is unavailable (rate-limited, down, circuit breaker tripped), NOVA
// falls back to TokenRouter, which proxies to Kimi K3 (a reasoning model).
//
// Key differences from the Z.AI wrapper:
// - Uses fetch() directly against the OpenAI-compatible /chat/completions endpoint
//   (no SDK dependency — keeps the bundle small).
// - Handles `reasoning_content` — Kimi K3 is a reasoning model. Its output may
//   contain both reasoning tokens (the model's chain-of-thought) AND content
//   tokens (the actual answer). We expose both separately.
// - If ALL tokens are consumed by reasoning (the model thought but never
//   answered), we return a specific error so the caller can retry with a
//   simpler prompt.
//
// Server-side only — the API key (TOKENROUTER_API_KEY) is read from env.

import { logger } from './logger'

// ── Constants ──

const BASE_URL = 'https://api.tokenrouter.com/v1'
export const DEFAULT_MODEL = 'moonshotai/kimi-k3-free'

// ── Types ──

export interface TokenRouterOptions {
  /** Model ID. Defaults to 'moonshotai/kimi-k3-free'. */
  model?: string
  /** Sampling temperature (0-2). Defaults to 0.4. */
  temperature?: number
  /** Max output tokens. Defaults to 8000. */
  maxTokens?: number
  /** Hard timeout in ms. Defaults to 60_000. */
  timeoutMs?: number
  /** External abort signal (e.g., client disconnect). */
  signal?: AbortSignal
}

/** A single chunk from the streaming API. */
export interface TokenRouterChunk {
  /** New content text since the last chunk. */
  text: string
  /** Accumulated content text so far. */
  fullText: string
  /** New reasoning text since the last chunk (Kimi K3 reasoning model). */
  reasoning?: string
  /** Accumulated reasoning text so far. */
  reasoningText?: string
  /** True when the stream is complete. */
  done: boolean
  /** Total token count (set on the final chunk). */
  tokens: number
  /** Elapsed time in ms (set on the final chunk). */
  ms: number
  /** Error message (set when an error occurs). */
  error?: string
}

/** Result of a non-streaming chat call. */
export interface TokenRouterResult {
  ok: boolean
  text: string
  tokens: number
  ms: number
  /** The model's reasoning (chain-of-thought), if any. */
  reasoning?: string
  error?: string
}

// ── Configuration check ──

/**
 * Check if the TokenRouter backend is configured (API key present).
 * Returns false if TOKENROUTER_API_KEY is missing or empty.
 */
export function isTokenRouterConfigured(): boolean {
  // v29.39: Check settings first, then env
  let key: string | undefined
  try {
    const settings = globalThis as unknown as { __novaSettings?: { tokenrouterApiKey?: string } }
    key = settings.__novaSettings?.tokenrouterApiKey?.trim() || undefined
  } catch {}
  if (!key) key = process.env.TOKENROUTER_API_KEY
  return typeof key === 'string' && key.trim().length > 0
}

// v29.39: Get effective API key (settings > env)
function getApiKey(): string | undefined {
  let key: string | undefined
  try {
    const settings = globalThis as unknown as { __novaSettings?: { tokenrouterApiKey?: string } }
    key = settings.__novaSettings?.tokenrouterApiKey?.trim() || undefined
  } catch {}
  if (!key) key = process.env.TOKENROUTER_API_KEY
  return key
}

// ── Streaming chat ──

/**
 * Stream a chat completion from TokenRouter.
 *
 * Yields TokenRouterChunk objects as content arrives. The final chunk has
 * `done: true` and includes the total token count and elapsed time.
 *
 * Handles the OpenAI SSE format: lines starting with "data: " containing
 * JSON objects, terminated by "data: [DONE]".
 *
 * Kimi K3 specifics:
 * - Each SSE event's `delta` may contain both `content` (the answer) and
 *   `reasoning_content` (the model's chain-of-thought).
 * - We accumulate both separately and expose them on the chunk.
 * - If the stream ends with `reasoningText` but no `text` (the model thought
 *   but never answered), we yield an error chunk with a specific message.
 */
export async function* tokenRouterStream(
  systemPrompt: string,
  userPrompt: string,
  opts: TokenRouterOptions = {}
): AsyncGenerator<TokenRouterChunk> {
  const t0 = Date.now()
  const model = opts.model ?? DEFAULT_MODEL
  const temperature = opts.temperature ?? 0.4
  const maxTokens = opts.maxTokens ?? 8000
  const timeoutMs = opts.timeoutMs ?? 60_000

  const apiKey = getApiKey() // v29.39: settings > env
  if (!apiKey) {
    yield { text: '', fullText: '', done: true, tokens: 0, ms: 0, error: 'TokenRouter API key not configured' }
    return
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  // Link external signal (client disconnect) to our controller
  let externalAborted = false
  if (opts.signal) {
    if (opts.signal.aborted) {
      externalAborted = true
      controller.abort()
    } else {
      opts.signal.addEventListener('abort', () => {
        externalAborted = true
        controller.abort()
      }, { once: true })
    }
  }

  try {
    const response = await fetch(`${BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature,
        max_tokens: maxTokens,
        stream: true,
        // Some OpenAI-compatible endpoints support `stream_options` for usage
        // in the final chunk. Include it — harmless if unsupported.
        stream_options: { include_usage: true },
      }),
      signal: controller.signal,
    })

    if (!response.ok) {
      const errText = await response.text().catch(() => '')
      clearTimeout(timer)
      const err = sanitizeHttpError(response.status, errText)
      logger.warn('tokenrouter.http_error', { status: response.status, model })
      yield { text: '', fullText: '', done: true, tokens: 0, ms: Date.now() - t0, error: err }
      return
    }

    if (!response.body) {
      clearTimeout(timer)
      yield { text: '', fullText: '', done: true, tokens: 0, ms: Date.now() - t0, error: 'No response body from TokenRouter' }
      return
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let fullText = ''
    let reasoningText = ''
    let totalTokens = 0

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })

      // Parse SSE: events separated by \n\n, each line starting with "data: "
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? '' // keep incomplete line

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed.startsWith('data: ')) continue

        const jsonStr = trimmed.slice(6)
        if (jsonStr === '[DONE]') {
          clearTimeout(timer)
          // Check if reasoning consumed all tokens
          if (!fullText && reasoningText) {
            yield {
              text: '',
              fullText: '',
              reasoning: '',
              reasoningText,
              done: true,
              tokens: totalTokens,
              ms: Date.now() - t0,
              error: 'The model produced reasoning but no final answer (all tokens consumed by chain-of-thought). Try simplifying your prompt or increasing maxTokens.',
            }
            return
          }
          yield {
            text: '',
            fullText,
            reasoning: '',
            reasoningText,
            done: true,
            tokens: totalTokens,
            ms: Date.now() - t0,
          }
          return
        }

        try {
          const data = JSON.parse(jsonStr)
          const delta = data?.choices?.[0]?.delta
          if (delta) {
            // Content (the actual answer)
            const content = typeof delta.content === 'string' ? delta.content : ''
            // Reasoning (Kimi K3 chain-of-thought)
            const reasoning = typeof delta.reasoning_content === 'string' ? delta.reasoning_content : ''

            if (content) {
              fullText += content
              yield { text: content, fullText, reasoning: '', reasoningText, done: false, tokens: 0, ms: 0 }
            }
            if (reasoning) {
              reasoningText += reasoning
              // Don't yield reasoning as content — but include it in the chunk
              // so callers that want to display reasoning can.
              yield { text: '', fullText, reasoning, reasoningText, done: false, tokens: 0, ms: 0 }
            }
          }
          // Track usage if present (some servers send it in the final chunk)
          if (data?.usage?.completion_tokens) {
            totalTokens = (data.usage.prompt_tokens ?? 0) + (data.usage.completion_tokens ?? 0)
          }
        } catch {
          // Skip malformed JSON
        }
      }
    }

    // Flush the decoder — any remaining bytes
    buffer += decoder.decode()
    if (buffer.trim()) {
      const trimmed = buffer.trim()
      if (trimmed.startsWith('data: ')) {
        const jsonStr = trimmed.slice(6)
        if (jsonStr !== '[DONE]') {
          try {
            const data = JSON.parse(jsonStr)
            const delta = data?.choices?.[0]?.delta
            if (delta?.content) fullText += delta.content
            if (delta?.reasoning_content) reasoningText += delta.reasoning_content
            if (data?.usage?.completion_tokens) {
              totalTokens = (data.usage.prompt_tokens ?? 0) + (data.usage.completion_tokens ?? 0)
            }
          } catch {}
        }
      }
    }

    clearTimeout(timer)
    // Stream ended without [DONE]
    if (!fullText && reasoningText) {
      yield {
        text: '',
        fullText: '',
        reasoningText,
        done: true,
        tokens: totalTokens,
        ms: Date.now() - t0,
        error: 'The model produced reasoning but no final answer (all tokens consumed by chain-of-thought). Try simplifying your prompt or increasing maxTokens.',
      }
      return
    }
    yield { text: '', fullText, reasoningText, done: true, tokens: totalTokens, ms: Date.now() - t0 }
  } catch (err: unknown) {
    clearTimeout(timer)
    if (externalAborted) {
      yield { text: '', fullText: '', done: true, tokens: 0, ms: Date.now() - t0, error: 'Build was cancelled.' }
      return
    }
    if (controller.signal.aborted) {
      yield { text: '', fullText: '', done: true, tokens: 0, ms: Date.now() - t0, error: `TokenRouter timed out after ${Math.round(timeoutMs / 1000)}s.` }
      return
    }
    const msg = err instanceof Error ? err.message : String(err)
    yield { text: '', fullText: '', done: true, tokens: 0, ms: Date.now() - t0, error: sanitizeError(msg) }
  }
}

// ── Non-streaming chat ──

/**
 * Call TokenRouter in non-streaming mode.
 *
 * Uses its OWN AbortController for the hard timeout — independent of any
 * external signal. This ensures the timeout fires even if the caller's
 * signal is never aborted.
 *
 * Returns a TokenRouterResult with ok/text/tokens/ms/reasoning/error.
 */
export async function tokenRouterChat(
  systemPrompt: string,
  userPrompt: string,
  opts: TokenRouterOptions = {}
): Promise<TokenRouterResult> {
  const t0 = Date.now()
  const model = opts.model ?? DEFAULT_MODEL
  const temperature = opts.temperature ?? 0.4
  const maxTokens = opts.maxTokens ?? 8000
  const timeoutMs = opts.timeoutMs ?? 60_000

  const apiKey = getApiKey() // v29.39: settings > env
  if (!apiKey) {
    return { ok: false, text: '', tokens: 0, ms: 0, error: 'TokenRouter API key not configured' }
  }

  // Use our OWN controller for the hard timeout — independent of opts.signal
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  // Link external signal
  let externalAborted = false
  if (opts.signal) {
    if (opts.signal.aborted) {
      externalAborted = true
      controller.abort()
    } else {
      opts.signal.addEventListener('abort', () => {
        externalAborted = true
        controller.abort()
      }, { once: true })
    }
  }

  try {
    const response = await fetch(`${BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature,
        max_tokens: maxTokens,
        stream: false,
      }),
      signal: controller.signal,
    })

    clearTimeout(timer)

    if (!response.ok) {
      const errText = await response.text().catch(() => '')
      const err = sanitizeHttpError(response.status, errText)
      logger.warn('tokenrouter.chat_http_error', { status: response.status, model })
      return { ok: false, text: '', tokens: 0, ms: Date.now() - t0, error: err }
    }

    const data = await response.json() as TokenRouterChatResponse
    const choice = data?.choices?.[0]
    const text = choice?.message?.content ?? ''
    const reasoning = choice?.message?.reasoning_content ?? undefined
    const tokens = (data?.usage?.prompt_tokens ?? 0) + (data?.usage?.completion_tokens ?? 0)

    if (!text || !text.trim()) {
      if (reasoning && reasoning.trim()) {
        return {
          ok: false,
          text: '',
          tokens,
          ms: Date.now() - t0,
          reasoning,
          error: 'The model produced reasoning but no final answer (all tokens consumed by chain-of-thought). Try simplifying your prompt or increasing maxTokens.',
        }
      }
      return { ok: false, text: '', tokens, ms: Date.now() - t0, error: 'The model returned an empty response.' }
    }

    return { ok: true, text, tokens, ms: Date.now() - t0, reasoning }
  } catch (err: unknown) {
    clearTimeout(timer)
    if (externalAborted) {
      return { ok: false, text: '', tokens: 0, ms: Date.now() - t0, error: 'Build was cancelled.' }
    }
    if (controller.signal.aborted) {
      return { ok: false, text: '', tokens: 0, ms: Date.now() - t0, error: `TokenRouter timed out after ${Math.round(timeoutMs / 1000)}s.` }
    }
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, text: '', tokens: 0, ms: Date.now() - t0, error: sanitizeError(msg) }
  }
}

// ── HTML critique ──

/**
 * Ask TokenRouter to critique an HTML app and suggest improvements.
 *
 * Uses a focused system prompt that asks for a JSON response with a
 * `suggestions` array. Falls back to splitting prose by newlines if the
 * response isn't valid JSON.
 *
 * Returns { ok, suggestions } where suggestions is an array of short,
 * actionable strings. On error, returns { ok: false, suggestions: [], error }.
 */
export async function critiqueHtml(
  html: string,
  mission: string
): Promise<{ ok: boolean; suggestions: string[]; reasoning?: string; error?: string }> {
  // Truncate HTML to avoid token explosion — Kimi K3 has a context limit.
  // 8000 chars ≈ 2000 tokens, leaving plenty of room for the model's response.
  const truncatedHtml = html.length > 8000
    ? html.slice(0, 8000) + '\n<!-- ... truncated ... -->'
    : html

  const systemPrompt = `You are a senior front-end engineer reviewing an HTML app. Output ONLY valid JSON.

Format:
{
  "suggestions": [
    "Short, actionable suggestion 1 (max 100 chars)",
    "Short, actionable suggestion 2",
    "Short, actionable suggestion 3"
  ]
}

Rules:
- Output 3-5 specific, actionable suggestions.
- Focus on real issues: bugs, accessibility, performance, UX.
- Don't suggest "add more features" — focus on improving what's there.
- Each suggestion must be under 100 characters.
- Output ONLY the JSON object — no prose, no markdown, no code fences.`

  const userPrompt = `Mission: ${mission}\n\nHTML to review:\n${truncatedHtml}`

  const result = await tokenRouterChat(systemPrompt, userPrompt, {
    maxTokens: 1000,
    temperature: 0.3,
    timeoutMs: 30_000,
  })

  if (!result.ok) {
    return { ok: false, suggestions: [], error: result.error, reasoning: result.reasoning }
  }

  // Try to parse JSON
  const suggestions = parseSuggestions(result.text)
  if (suggestions.length > 0) {
    return { ok: true, suggestions, reasoning: result.reasoning }
  }

  // Fallback: split prose by newlines, take first 5 non-empty lines
  const lines = result.text
    .split('\n')
    .map(l => l.replace(/^[-*\d.\s]+/, '').trim())
    .filter(l => l.length > 0 && l.length < 200)
    .slice(0, 5)

  if (lines.length > 0) {
    return { ok: true, suggestions: lines, reasoning: result.reasoning }
  }

  return {
    ok: false,
    suggestions: [],
    error: 'The model did not produce any suggestions.',
    reasoning: result.reasoning,
  }
}

// ── Internal helpers ──

/** Minimal shape of the OpenAI-compatible chat response. */
interface TokenRouterChatResponse {
  choices?: Array<{
    message?: {
      content?: string | null
      reasoning_content?: string | null
    }
  }>
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
  }
}

/**
 * Parse a suggestions array from a JSON string.
 * Returns empty array if parsing fails or the result isn't an array of strings.
 */
function parseSuggestions(text: string): string[] {
  if (!text) return []
  try {
    // Try direct parse first
    const parsed = JSON.parse(text)
    if (parsed && typeof parsed === 'object' && Array.isArray(parsed.suggestions)) {
      return parsed.suggestions
        .filter((s: unknown): s is string => typeof s === 'string' && s.trim().length > 0)
        .map((s: string) => s.trim().slice(0, 200))
    }
  } catch {
    // Fall through to brace-extraction
  }
  // Extract the first balanced {...} block and retry
  try {
    const start = text.indexOf('{')
    if (start < 0) return []
    let depth = 0
    let inStr = false
    let escaped = false
    let end = -1
    for (let i = start; i < text.length; i++) {
      const ch = text[i]
      if (escaped) { escaped = false; continue }
      if (ch === '\\' && inStr) { escaped = true; continue }
      if (ch === '"') { inStr = !inStr; continue }
      if (inStr) continue
      if (ch === '{') depth++
      else if (ch === '}') {
        depth--
        if (depth === 0) { end = i; break }
      }
    }
    if (end < 0) return []
    const parsed = JSON.parse(text.slice(start, end + 1))
    if (parsed && typeof parsed === 'object' && Array.isArray(parsed.suggestions)) {
      return parsed.suggestions
        .filter((s: unknown): s is string => typeof s === 'string' && s.trim().length > 0)
        .map((s: string) => s.trim().slice(0, 200))
    }
  } catch {}
  return []
}

/**
 * Sanitize an HTTP error response into a user-friendly message.
 * Never leaks raw server error text.
 */
function sanitizeHttpError(status: number, body: string): string {
  if (status === 401 || status === 403) {
    return 'TokenRouter authentication failed. Check the API key.'
  }
  if (status === 429) {
    return 'The AI service is busy. Try again in a minute.'
  }
  if (status >= 500) {
    return 'The AI service encountered an error. Try again.'
  }
  // Don't leak body — it might contain internal details
  void body
  return `TokenRouter returned status ${status}. Try again.`
}

/**
 * Sanitize a generic error message.
 * Converts known patterns (rate limit, network) into friendly messages.
 */
function sanitizeError(msg: string): string {
  const lower = msg.toLowerCase()
  if (lower.includes('429') || lower.includes('rate limit') || lower.includes('too many requests')) {
    return 'The AI service is busy. Try again in a minute.'
  }
  if (lower.includes('network') || lower.includes('fetch') || lower.includes('econnrefused') ||
      lower.includes('enotfound') || lower.includes('socket hang up')) {
    return 'Network error reaching the AI service.'
  }
  return 'The AI service encountered an error. Try again.'
}
