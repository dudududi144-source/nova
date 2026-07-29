// LLM wrapper — server-side only.
// Thin wrapper around z-ai-web-dev-sdk.
// One job: take a system + user prompt, return text or a structured error.

import ZAI from 'z-ai-web-dev-sdk'

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
 */
async function getZai(): Promise<ZaiClient> {
  if (zaiInstance) return zaiInstance
  if (zaiPromise) return zaiPromise
  zaiPromise = ZAI.create().then((inst: unknown) => {
    zaiInstance = inst as ZaiClient
    zaiPromise = null
    return zaiInstance
  }).catch((err: unknown) => {
    zaiPromise = null
    throw err
  })
  return zaiPromise
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
  const maxTokens = opts.maxTokens ?? 4000
  const temperature = opts.temperature ?? 0.4
  const timeoutMs = opts.timeoutMs ?? 60_000

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
    const zai = await getZai()
    const completion = await zai.chat.completions.create({
      messages: [
        { role: 'assistant', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature,
      max_tokens: maxTokens,
      thinking: { type: 'disabled' },
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
 * Validate a mission string.
 * Checks: non-empty, length 3-500, no control characters (including DEL and
 * extended control chars in the C1 set \x80-\x9F).
 * Returns { ok: true } or { ok: false, error: string }.
 */
export function validateMission(mission: string): { ok: boolean; error?: string } {
  if (!mission || !mission.trim()) return { ok: false, error: 'Mission is empty' }
  const trimmed = mission.trim()
  if (trimmed.length < 3) return { ok: false, error: 'Mission too short (min 3 chars)' }
  if (trimmed.length > 500) return { ok: false, error: `Mission too long (max 500 chars, got ${trimmed.length})` }
  // Block C0 control chars (except tab \x09, newline \x0A, carriage return \x0D),
  // DEL (\x7F), and C1 extended control chars (\x80-\x9F)
  if (/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F\x80-\x9F]/.test(trimmed)) {
    return { ok: false, error: 'Mission contains invalid characters' }
  }
  return { ok: true }
}

/**
 * Strip markdown code fences from LLM output.
 * Handles: ```html, ```, 4+ backtick fences, empty first block, whitespace,
 * and any language identifier (javascript, css, etc. — not just html/htm).
 * Returns the first non-empty fence block, or the trimmed text if no fences.
 */
export function stripCodeFences(text: string): string {
  // Find all fence blocks. Allow any language identifier (or none).
  // Handles 3+ backticks (``` or ```` or more).
  // Language identifier is matched permissively: [a-zA-Z0-9_-]*
  const fenceRegex = /`{3,}\s*[a-zA-Z0-9_-]*\s*\n?([\s\S]*?)\n?`{3,}/g
  let match
  while ((match = fenceRegex.exec(text)) !== null) {
    const content = match[1].trim()
    if (content) return content
  }
  return text.trim()
}

/**
 * Check if text looks like a complete HTML document.
 * Must start (after optional whitespace) with <!doctype or <html>.
 * Rejects HTML fragments, conversational text, JSON, markdown.
 */
export function looksLikeHtml(text: string): boolean {
  const lower = text.trimStart().toLowerCase()
  return lower.startsWith('<!doctype') || lower.startsWith('<html')
}

/**
 * Content-Security-Policy for preview iframes.
 * Blocks all external network requests (fetch, XHR, websocket, img, script).
 */
const PREVIEW_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  "img-src 'unsafe-inline' data:",
  "font-src 'unsafe-inline' data:",
  "connect-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ')

/**
 * Inject a CSP meta tag into the HTML <head>.
 * - If a CSP meta already exists (case-insensitive), don't override it.
 * - If there's no <head>, inject one after <html>.
 * - If there's no <html>, prepend the meta.
 */
export function injectCsp(html: string): string {
  if (/<meta\s+http-equiv=["']?content-security-policy["']?/i.test(html)) {
    return html
  }
  const cspMeta = `<meta http-equiv="Content-Security-Policy" content="${PREVIEW_CSP}">`
  const headMatch = html.match(/<head[^>]*>/i)
  if (headMatch) {
    return html.replace(/<head[^>]*>/i, `${headMatch[0]}\n${cspMeta}`)
  }
  const htmlTagMatch = html.match(/<html[^>]*>/i)
  if (htmlTagMatch) {
    return html.replace(/<html[^>]*>/i, `${htmlTagMatch[0]}<head>${cspMeta}</head>`)
  }
  return `${cspMeta}\n${html}`
}
