// POST /api/build — one-shot LLM build.
// Body: { mission: string }
// Returns: { ok, html, tokens, ms } or { ok: false, error }
//
// No DB. No streaming. No events. One LLM call, one HTML string.
// CSP is injected into the returned HTML to block external requests from the preview iframe.

import type { NextRequest } from 'next/server'
import { llmChat, validateMission, stripCodeFences, looksLikeHtml, injectCsp } from '@/lib/llm'
import { RateLimiter } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 120

const SYSTEM_PROMPT = `You are a senior front-end engineer. You build complete, working, single-file HTML apps.

Rules:
- Output ONLY the HTML. No explanation, no markdown, no commentary.
- The HTML must be a complete document: <!DOCTYPE html>, <html>, <head>, <body>.
- All CSS goes in a <style> tag in <head>. All JS goes in a <script> tag before </body>.
- The app must be fully functional in a sandboxed iframe (no external requests, no API keys, no fetch to outside services).
- Use modern, clean, dark-themed UI (background #0f172a, text #e2e8f0) unless the user specifies otherwise.
- Make it actually work. A snake game must have a game loop, scoring, and game-over. A todo app must have add/complete/delete. A markdown editor must render in real time.
- Keep it in ONE file. Do not split into multiple files.
- Do not include any external scripts, stylesheets, fonts, or images. Everything must be inline.
- The output must be playable/usable immediately when opened in a browser.`

// 10 builds per hour per IP
const buildLimiter = new RateLimiter(10, 60 * 60 * 1000)

interface BuildBody {
  mission?: unknown
}

export async function POST(request: NextRequest): Promise<Response> {
  // ── Rate limit ──
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || request.headers.get('x-real-ip')
    || 'unknown'
  const rl = buildLimiter.check(ip)
  if (!rl.ok) {
    const mins = Math.ceil(rl.resetInMs / 60000)
    return Response.json(
      { ok: false, error: `Rate limit reached. Try again in ${mins} minute(s).` },
      {
        status: 429,
        headers: {
          'Retry-After': String(Math.ceil(rl.resetInMs / 1000)),
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': String(Math.ceil(rl.resetInMs / 1000)),
        },
      }
    )
  }

  let body: BuildBody
  try {
    body = (await request.json()) as BuildBody
  } catch {
    return Response.json({ ok: false, error: 'Invalid JSON' }, { status: 400 })
  }

  const mission = typeof body?.mission === 'string' ? body.mission.trim() : ''
  const validation = validateMission(mission)
  if (!validation.ok) {
    return Response.json({ ok: false, error: validation.error }, { status: 400 })
  }

  // Pass request.signal so the LLM call aborts if the client disconnects
  const result = await llmChat(SYSTEM_PROMPT, `Build this: ${mission}`, {
    maxTokens: 8000,
    temperature: 0.4,
    timeoutMs: 90_000,
    signal: request.signal,
  })

  if (!result.ok) {
    // result.error is already human-friendly (sanitized in llmChat)
    return Response.json(
      { ok: false, error: result.error, tokens: result.tokens, ms: result.ms },
      { status: 502, headers: { 'X-RateLimit-Remaining': String(rl.remaining) } }
    )
  }

  const rawHtml = stripCodeFences(result.text)

  if (!looksLikeHtml(rawHtml)) {
    return Response.json(
      {
        ok: false,
        error: 'The model did not return valid HTML. Try rephrasing your request.',
        tokens: result.tokens,
        ms: result.ms,
      },
      { status: 502, headers: { 'X-RateLimit-Remaining': String(rl.remaining) } }
    )
  }

  // Inject CSP to block external requests from the preview iframe
  const html = injectCsp(rawHtml)

  return Response.json({
    ok: true,
    html,
    tokens: result.tokens,
    ms: result.ms,
  })
}
