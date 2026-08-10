// LLM wrapper — server-side only.
// Thin wrapper around z-ai-web-dev-sdk.
// Supports both non-streaming (llmChat) and real token streaming (llmChatStream).
//
// NOTE: Pure utility functions (stripCodeFences, looksLikeHtml, injectCsp)
// live in html-utils.ts, and mission validation lives in mission.ts.
// This separation ensures that mocking this module for route tests
// does NOT break those pure functions for other test files.
//
// v29.85: The z-ai-web-dev-sdk is loaded via dynamic import() instead of a
// static top-level import. This is critical for memory-constrained sandbox
// environments (4GB RAM): a static import forces Turbopack to bundle the
// entire SDK when ANY route that imports from this file is compiled, which
// causes OOM during on-demand compilation. With dynamic import, the SDK
// only loads when an actual LLM call is made — route compilation stays
// lightweight and fast.

// Minimal type for the dynamically-imported SDK module.
type ZAIModule = { default: { create: () => Promise<unknown>; new (config: Record<string, unknown>): unknown } }
let zaiModule: ZAIModule | null = null
let zaiModulePromise: Promise<ZAIModule> | null = null

async function loadZAI(): Promise<ZAIModule> {
  if (zaiModule) return zaiModule
  if (zaiModulePromise) return zaiModulePromise
  zaiModulePromise = import('z-ai-web-dev-sdk').then((mod: unknown) => {
    zaiModule = mod as ZAIModule
    zaiModulePromise = null
    return zaiModule
  }).catch((err: unknown) => {
    zaiModulePromise = null
    throw err
  })
  return zaiModulePromise
}

export interface LlmResult {
  ok: boolean
  text: string
  tokens: number
  ms: number
  error?: string
}

export interface LlmOptions {
  maxTokens?: number
  temperature?: number
  timeoutMs?: number
  /** External abort signal (e.g., client disconnect). Aborts the LLM call. */
  signal?: AbortSignal
  /** v29.61: Enable deep reasoning mode for higher quality output. */
  thinking?: boolean
}

// SDK types are loose; we define a minimal interface for what we use.
type ChatRole = 'system' | 'user' | 'assistant'

interface ZaiCompletion {
  choices: Array<{ message: { content: string | null } }>
  usage?: { prompt_tokens?: number; completion_tokens?: number }
}

interface ZaiClient {
  chat: {
    completions: {
      create: (opts: {
        messages: Array<{ role: ChatRole; content: string }>
        temperature: number
        max_tokens: number
        thinking: { type: string }
        stream: boolean
        signal: AbortSignal
      }) => Promise<ZaiCompletion>
    }
  }
}

let zaiInstance: ZaiClient | null = null
let zaiPromise: Promise<ZaiClient> | null = null

/**
 * Get the ZAI SDK singleton instance.
 * Uses a promise cache to prevent double-instantiation if two builds
 * start before the first create() resolves.
 * Resets on failure so a stale instance doesn't poison all future calls.
 *
 * v29.73: If a Z.AI API key is set via the Settings UI, use it directly
 * instead of relying on the SDK's config file auto-detection.
 */
async function getZai(): Promise<ZaiClient> {
  if (zaiInstance) return zaiInstance
  if (zaiPromise) return zaiPromise

  zaiPromise = (async () => {
    const ZAI = await loadZAI()
    const inst = await ZAI.default.create()
    zaiInstance = inst as ZaiClient
    zaiPromise = null
    return zaiInstance
  })().catch((err: unknown) => {
    zaiPromise = null
    throw err
  })
  return zaiPromise
}

/**
 * v29.73: Check if a custom Z.AI API key is set via Settings UI.
 * If so, create a new ZAI instance with that key (overriding the config file).
 * This makes the Settings UI key actually work for Z.AI.
 * v29.74: Cache the custom instance to avoid recreating it on every call.
 */
let customZaiInstance: ZaiClient | null = null
let customZaiKey: string | null = null

async function getZaiWithSettingsKey(): Promise<ZaiClient> {
  try {
    const { getEffectiveApiKey } = await import('@/app/api/settings/route')
    const customKey = getEffectiveApiKey('zai')

    // If key matches cached instance, return it
    if (customZaiInstance && customZaiKey === customKey) {
      return customZaiInstance
    }

    if (customKey && customKey !== 'Z.ai') {
      // A custom key was set via Settings UI — create and cache a new instance
      const ZAIMod = await loadZAI()
      const ZaiCtor = ZAIMod.default as unknown as { new (config: Record<string, unknown>): unknown }
      customZaiInstance = new ZaiCtor({
        baseUrl: 'https://internal-api.z.ai/v1',
        apiKey: customKey,
      }) as ZaiClient
      customZaiKey = customKey
      return customZaiInstance
    }
    // Key changed or cleared — invalidate cache
    customZaiInstance = null
    customZaiKey = null
  } catch {
    // Settings API not available — fall back to default
  }
  return getZai()
}

/**
 * Call the LLM with a system + user prompt.
 * Returns a structured result with ok/text/tokens/ms/error.
 * Errors are sanitized — raw SDK messages never leak to the client.
 */
export async function llmChat(
  systemPrompt: string,
  userPrompt: string,
  opts: LlmOptions = {}
): Promise<LlmResult> {
  const t0 = Date.now()
  const maxTokens = opts.maxTokens ?? 8000
  const temperature = opts.temperature ?? 0.4
  const timeoutMs = opts.timeoutMs ?? 120_000
  // v29.61: Enable thinking mode for deep reasoning (was always disabled)
  const thinkingType = opts.thinking ? 'enabled' : 'disabled'

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
    const zai = await getZaiWithSettingsKey()
    const completion = await zai.chat.completions.create({
      messages: [
        { role: 'assistant', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature,
      max_tokens: maxTokens,
      thinking: { type: thinkingType },
      stream: false,
      signal: controller.signal,
    })

    const text = (completion?.choices?.[0]?.message?.content ?? '').toString()
    const tokens =
      (completion?.usage?.prompt_tokens ?? 0) +
      (completion?.usage?.completion_tokens ?? 0)

    clearTimeout(timer)

    if (!text || !text.trim()) {
      return { ok: false, text: '', tokens, ms: Date.now() - t0, error: 'The model returned an empty response. Try again.' }
    }
    return { ok: true, text, tokens, ms: Date.now() - t0 }
  } catch (err: unknown) {
    clearTimeout(timer)

    // Human-friendly abort/timeout messages
    if (externalAborted) {
      return { ok: false, text: '', tokens: 0, ms: Date.now() - t0, error: 'Build was cancelled.' }
    }
    if (controller.signal.aborted) {
      return { ok: false, text: '', tokens: 0, ms: Date.now() - t0, error: `Build timed out after ${Math.round(timeoutMs / 1000)}s. Try simplifying your request.` }
    }

    const msg = err instanceof Error ? err.message : String(err)

    // Rate limit — don't expose raw SDK message
    if (msg.includes('429') || msg.toLowerCase().includes('rate limit') || msg.toLowerCase().includes('too many requests')) {
      return { ok: false, text: '', tokens: 0, ms: Date.now() - t0, error: 'The AI service is busy. Try again in a minute.' }
    }

    // Don't leak raw internal errors; give a safe generic message
    // Reset the instance — it might be stale (expired token, dropped connection)
    zaiInstance = null
    return { ok: false, text: '', tokens: 0, ms: Date.now() - t0, error: 'The AI service encountered an error. Try again.' }
  }
}

/**
 * Stream LLM tokens in real-time via the SDK's streaming mode.
 * Returns an async generator that yields text chunks as they arrive.
 *
 * Usage:
 *   for await (const chunk of llmChatStream(sys, user, opts)) {
 *     // chunk.text = partial text
 *     // chunk.done = true when stream is complete
 *     // chunk.tokens = total tokens (on done)
 *   }
 */
export interface StreamChunk {
  text: string      // new text since last chunk
  fullText: string  // accumulated text so far
  done: boolean
  tokens: number
  ms: number
  error?: string
}

export async function* llmChatStream(
  systemPrompt: string,
  userPrompt: string,
  opts: LlmOptions = {}
): AsyncGenerator<StreamChunk> {
  const t0 = Date.now()
  const maxTokens = opts.maxTokens ?? 32000
  const temperature = opts.temperature ?? 0.4
  const timeoutMs = opts.timeoutMs ?? 300_000
  // v29.61: Enable thinking mode for deep reasoning (was always disabled)
  const thinkingType = opts.thinking ? 'enabled' : 'disabled'

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  // Link external signal
  if (opts.signal) {
    if (opts.signal.aborted) {
      controller.abort()
    } else {
      opts.signal.addEventListener('abort', () => controller.abort(), { once: true })
    }
  }

  try {
    const zai = await getZaiWithSettingsKey()

    // Enable streaming — SDK returns response.body (ReadableStream)
    const streamBody = await zai.chat.completions.create({
      messages: [
        { role: 'assistant', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature,
      max_tokens: maxTokens,
      thinking: { type: thinkingType },
      stream: true,
      signal: controller.signal,
    })

    // streamBody is a ReadableStream — read it chunk by chunk
    const reader = (streamBody as unknown as ReadableStream<Uint8Array>).getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let fullText = ''
    let totalTokens = 0

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })

      // Parse SSE lines: data: {...}\n\n
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed.startsWith('data: ')) continue

        const jsonStr = trimmed.slice(6)
        if (jsonStr === '[DONE]') {
          clearTimeout(timer)
          yield { text: '', fullText, done: true, tokens: totalTokens, ms: Date.now() - t0 }
          return
        }

        try {
          const data = JSON.parse(jsonStr)
          const content = data?.choices?.[0]?.delta?.content ?? ''
          if (content) {
            fullText += content
            yield { text: content, fullText, done: false, tokens: 0, ms: 0 }
          }
          // Track usage if present
          if (data?.usage?.completion_tokens) {
            totalTokens = (data.usage.prompt_tokens ?? 0) + (data.usage.completion_tokens ?? 0)
          }
        } catch {
          // Skip malformed JSON
        }
      }
    }

    // Flush the decoder — any remaining bytes in the internal buffer (incomplete multi-byte chars)
    buffer += decoder.decode()
    // Process any remaining complete lines in the buffer
    if (buffer.trim()) {
      const trimmed = buffer.trim()
      if (trimmed.startsWith('data: ')) {
        const jsonStr = trimmed.slice(6)
        if (jsonStr === '[DONE]') {
          clearTimeout(timer)
          yield { text: '', fullText, done: true, tokens: totalTokens, ms: Date.now() - t0 }
          return
        }
        try {
          const data = JSON.parse(jsonStr)
          const content = data?.choices?.[0]?.delta?.content ?? ''
          if (content) fullText += content
          if (data?.usage?.completion_tokens) {
            totalTokens = (data.usage.prompt_tokens ?? 0) + (data.usage.completion_tokens ?? 0)
          }
        } catch {}
      }
    }

    // Stream ended without [DONE]
    clearTimeout(timer)
    yield { text: '', fullText, done: true, tokens: totalTokens, ms: Date.now() - t0 }
  } catch (err: unknown) {
    clearTimeout(timer)
    const msg = err instanceof Error ? err.message : String(err)

    if (msg.includes('429') || msg.toLowerCase().includes('rate limit')) {
      yield { text: '', fullText: '', done: true, tokens: 0, ms: Date.now() - t0, error: 'The AI service is busy. Try again in a minute.' }
    } else if (controller.signal.aborted) {
      yield { text: '', fullText: '', done: true, tokens: 0, ms: Date.now() - t0, error: `Build timed out after ${Math.round(timeoutMs / 1000)}s.` }
    } else {
      yield { text: '', fullText: '', done: true, tokens: 0, ms: Date.now() - t0, error: 'The AI service encountered an error. Try again.' }
    }
  }
}
