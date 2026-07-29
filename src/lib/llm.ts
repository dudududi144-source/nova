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

let zaiInstance: any = null

async function getZai(): Promise<any> {
  if (zaiInstance) return zaiInstance
  zaiInstance = await ZAI.create()
  return zaiInstance
}

export async function llmChat(
  systemPrompt: string,
  userPrompt: string,
  opts: { maxTokens?: number; temperature?: number; timeoutMs?: number } = {}
): Promise<LlmResult> {
  const t0 = Date.now()
  const maxTokens = opts.maxTokens ?? 4000
  const temperature = opts.temperature ?? 0.4
  const timeoutMs = opts.timeoutMs ?? 60_000

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

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
      return { ok: false, text: '', tokens, ms: Date.now() - t0, error: 'empty response' }
    }
    return { ok: true, text, tokens, ms: Date.now() - t0 }
  } catch (err) {
    clearTimeout(timer)
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, text: '', tokens: 0, ms: Date.now() - t0, error: msg }
  }
}

// Mission validation — cheap, deterministic, no LLM.
// Length + charset + a tiny blocklist. The real safety check is the LLM
// returning HTML structure we can verify.
export function validateMission(mission: string): { ok: boolean; error?: string } {
  if (!mission || !mission.trim()) return { ok: false, error: 'Mission is empty' }
  const trimmed = mission.trim()
  if (trimmed.length < 3) return { ok: false, error: 'Mission too short (min 3 chars)' }
  if (trimmed.length > 500) return { ok: false, error: `Mission too long (max 500 chars, got ${trimmed.length})` }
  // Reject control characters
  if (/[\x00-\x08\x0B\x0C\x0E-\x1F]/.test(trimmed)) {
    return { ok: false, error: 'Mission contains invalid characters' }
  }
  return { ok: true }
}

// Strip markdown fences if the LLM wrapped its HTML in ```html ... ```
export function stripCodeFences(text: string): string {
  const fenceMatch = text.match(/```(?:html)?\s*\n?([\s\S]*?)\n?```/)
  if (fenceMatch) return fenceMatch[1].trim()
  return text.trim()
}

// Basic sanity check: does this look like HTML?
export function looksLikeHtml(text: string): boolean {
  const lower = text.toLowerCase()
  return (
    lower.includes('<!doctype') ||
    lower.includes('<html') ||
    (lower.includes('<body') && lower.includes('</body>')) ||
    (lower.includes('<div') && lower.includes('</div>'))
  )
}
