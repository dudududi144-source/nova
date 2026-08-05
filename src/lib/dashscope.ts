// DashScope (Qwen) LLM client — OpenAI-compatible API for Alibaba's Qwen models.
//
// This is NOVA's third LLM backend. It provides access to Qwen models via
// the DashScope API (Alibaba Cloud). The API is OpenAI-compatible, so we
// use the OpenAI SDK with a custom baseURL.
//
// Model: qwen-flash-character (free tier, available without purchase)
// BaseURL: https://dashscope-intl.aliyuncs.com/compatible-mode/v1
//
// The API key is read from the DASHSCOPE_API_KEY environment variable.

import OpenAI from 'openai'

export interface DashScopeOptions {
  model?: string
  temperature?: number
  maxTokens?: number
  timeoutMs?: number
  signal?: AbortSignal
}

export interface DashScopeChunk {
  text: string
  fullText: string
  done: boolean
  tokens: number
  ms: number
  error?: string
}

let client: OpenAI | null = null
let lastApiKey: string | null = null

function getClient(): OpenAI {
  // v29.39: Check settings first, then env var
  let apiKey: string | undefined
  try {
    // Dynamic import to avoid circular dependency
    const settings = globalThis as unknown as { __novaSettings?: { dashscopeApiKey?: string } }
    apiKey = settings.__novaSettings?.dashscopeApiKey?.trim() || undefined
  } catch {}
  if (!apiKey) {
    apiKey = process.env.DASHSCOPE_API_KEY
  }
  if (!apiKey || apiKey === 'your-key-here') {
    throw new Error('DASHSCOPE_API_KEY not configured. Set it in Settings or .env')
  }
  // Recreate client if key changed (e.g., user updated it via Settings)
  if (client && lastApiKey === apiKey) return client
  client = new OpenAI({
    baseURL: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
    apiKey,
  })
  lastApiKey = apiKey
  return client
}

/**
 * Check if DashScope is configured (has a valid API key).
 */
export function isDashScopeConfigured(): boolean {
  // v29.39: Check settings first, then env
  let key: string | undefined
  try {
    const settings = globalThis as unknown as { __novaSettings?: { dashscopeApiKey?: string } }
    key = settings.__novaSettings?.dashscopeApiKey?.trim() || undefined
  } catch {}
  if (!key) key = process.env.DASHSCOPE_API_KEY
  return !!key && key !== 'your-key-here' && key.length > 10
}

/**
 * Stream chat completions from DashScope (Qwen).
 * Returns an async generator that yields text chunks as they arrive.
 * OpenAI-compatible streaming — same interface as tokenRouterStream.
 */
export async function* dashscopeStream(
  systemPrompt: string,
  userPrompt: string,
  opts: DashScopeOptions = {}
): AsyncGenerator<DashScopeChunk> {
  const t0 = Date.now()
  const model = opts.model ?? 'qwen-flash-character'
  const temperature = opts.temperature ?? 0.4
  const maxTokens = opts.maxTokens ?? 32000

  try {
    const openai = getClient()

    const stream = await openai.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature,
      max_tokens: maxTokens,
      stream: true,
      stream_options: { include_usage: true },
    }, {
      signal: opts.signal,
      timeout: opts.timeoutMs ?? 120_000,
    })

    let fullText = ''
    let totalTokens = 0

    for await (const chunk of stream) {
      if (chunk.choices && chunk.choices.length > 0) {
        const delta = chunk.choices[0].delta
        if (delta?.content) {
          fullText += delta.content
          yield { text: delta.content, fullText, done: false, tokens: 0, ms: 0 }
        }
      }

      if (chunk.usage) {
        totalTokens = (chunk.usage.prompt_tokens ?? 0) + (chunk.usage.completion_tokens ?? 0)
      }
    }

    yield { text: '', fullText, done: true, tokens: totalTokens, ms: Date.now() - t0 }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)

    if (msg.includes('429') || msg.toLowerCase().includes('rate limit')) {
      yield { text: '', fullText: '', done: true, tokens: 0, ms: Date.now() - t0, error: 'DashScope rate limited. Try again in a minute.' }
    } else if (msg.includes('aborted') || (err instanceof Error && err.name === 'AbortError')) {
      yield { text: '', fullText: '', done: true, tokens: 0, ms: Date.now() - t0, error: 'Request was cancelled.' }
    } else if (msg.includes('not configured')) {
      yield { text: '', fullText: '', done: true, tokens: 0, ms: Date.now() - t0, error: 'DASHSCOPE_API_KEY not configured.' }
    } else {
      yield { text: '', fullText: '', done: true, tokens: 0, ms: Date.now() - t0, error: `DashScope error: ${msg}` }
    }
  }
}

/**
 * Non-streaming chat completion from DashScope.
 */
export async function dashscopeChat(
  systemPrompt: string,
  userPrompt: string,
  opts: DashScopeOptions = {}
): Promise<{ ok: boolean; text: string; tokens: number; ms: number; error?: string }> {
  const t0 = Date.now()
  const model = opts.model ?? 'qwen-flash-character'
  const temperature = opts.temperature ?? 0.4
  const maxTokens = opts.maxTokens ?? 32000
  const timeoutMs = opts.timeoutMs ?? 120_000

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  if (opts.signal) {
    if (opts.signal.aborted) {
      controller.abort()
    } else {
      opts.signal.addEventListener('abort', () => controller.abort(), { once: true })
    }
  }

  try {
    const openai = getClient()

    const completion = await openai.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature,
      max_tokens: maxTokens,
      stream: false,
    }, {
      signal: controller.signal,
      timeout: timeoutMs,
    })

    const text = completion.choices?.[0]?.message?.content ?? ''
    const tokens = (completion.usage?.prompt_tokens ?? 0) + (completion.usage?.completion_tokens ?? 0)

    if (!text || !text.trim()) {
      return { ok: false, text: '', tokens, ms: Date.now() - t0, error: 'Empty response from model.' }
    }

    return { ok: true, text, tokens, ms: Date.now() - t0 }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)

    if (msg.includes('429') || msg.toLowerCase().includes('rate limit')) {
      return { ok: false, text: '', tokens: 0, ms: Date.now() - t0, error: 'DashScope rate limited.' }
    }
    if (controller.signal.aborted) {
      return { ok: false, text: '', tokens: 0, ms: Date.now() - t0, error: `Request timed out after ${Math.round(timeoutMs / 1000)}s.` }
    }

    return { ok: false, text: '', tokens: 0, ms: Date.now() - t0, error: `DashScope error: ${msg}` }
  } finally {
    clearTimeout(timer)
  }
}
