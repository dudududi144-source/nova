// LLM wrapper — server-side only.
// Thin, honest wrapper around z-ai-web-dev-sdk.
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

let zaiInstance: any = null

async function getZai(): Promise<any> {
  if (zaiInstance) return zaiInstance
  zaiInstance = await ZAI.create()
  return zaiInstance
}

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
    } as any)

    const text = (completion?.choices?.[0]?.message?.content ?? '').toString()
    const tokens =
      (completion?.usage?.prompt_tokens ?? 0) +
      (completion?.usage?.completion_tokens ?? 0)

    clearTimeout(timer)

    if (!text || !text.trim()) {
      return { ok: false, text: '', tokens, ms: Date.now() - t0, error: 'The model returned an empty response. Try again.' }
    }
    return { ok: true, text, tokens, ms: Date.now() - t0 }
  } catch (err) {
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
    return { ok: false, text: '', tokens: 0, ms: Date.now() - t0, error: 'The AI service encountered an error. Try again.' }
  }
}

// Mission validation — cheap, deterministic, no LLM.
export function validateMission(mission: string): { ok: boolean; error?: string } {
  if (!mission || !mission.trim()) return { ok: false, error: 'Mission is empty' }
  const trimmed = mission.trim()
  if (trimmed.length < 3) return { ok: false, error: 'Mission too short (min 3 chars)' }
  if (trimmed.length > 500) return { ok: false, error: `Mission too long (max 500 chars, got ${trimmed.length})` }
  if (/[\x00-\x08\x0B\x0C\x0E-\x1F]/.test(trimmed)) {
    return { ok: false, error: 'Mission contains invalid characters' }
  }
  return { ok: true }
}

// Strip markdown fences if the LLM wrapped its HTML in ```html ... ```
export function stripCodeFences(text: string): string {
  const fenceMatch = text.match(/```(?:html|htm)?\s*\n?([\s\S]*?)\n?```/)
  if (fenceMatch) return fenceMatch[1].trim()
  return text.trim()
}

// Basic sanity check: does this look like a complete HTML document?
// Must start (after optional whitespace/fences) with <!doctype html> or <html>.
// Rejects "Here's your app:\n<div>...</div>" style LLM outputs that contain HTML
// fragments but aren't complete documents.
export function looksLikeHtml(text: string): boolean {
  const lower = text.trimStart().toLowerCase()
  return lower.startsWith('<!doctype') || lower.startsWith('<html')
}

// Inject a Content-Security-Policy meta tag into the HTML <head>.
// This blocks the sandboxed iframe from making external network requests
// (fetch, XHR, websocket, img, script, etc.) — defense in depth on top of
// the sandbox="allow-scripts" attribute.
//
// If a CSP meta already exists, we don't add another (browsers use the first).
// If there's no <head>, we inject one.
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

export function injectCsp(html: string): string {
  // Already has a CSP meta — don't override (respect the LLM's choice)
  if (/<meta\s+http-equiv=["']?content-security-policy["']?/i.test(html)) {
    return html
  }
  const cspMeta = `<meta http-equiv="Content-Security-Policy" content="${PREVIEW_CSP}">`
  // Inject right after <head> (case-insensitive)
  const headMatch = html.match(/<head[^>]*>/i)
  if (headMatch) {
    return html.replace(/<head[^>]*>/i, `${headMatch[0]}\n${cspMeta}`)
  }
  // No <head> — inject one right after <html> or at the start
  const htmlTagMatch = html.match(/<html[^>]*>/i)
  if (htmlTagMatch) {
    return html.replace(/<html[^>]*>/i, `${htmlTagMatch[0]}<head>${cspMeta}</head>`)
  }
  // No <html> tag — shouldn't happen (looksLikeHtml requires it), but handle gracefully
  return `${cspMeta}\n${html}`
}
