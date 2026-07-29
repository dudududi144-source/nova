// POST /api/build — one-shot LLM build.
// Body: { mission: string }
// Returns: { ok, html, tokens, ms } or { ok: false, error }
//
// No DB. No streaming. No events. One LLM call, one HTML string.
// CSP is injected into the returned HTML to block external requests from the preview iframe.

import type { NextRequest } from 'next/server'
import { llmChat, validateMission, stripCodeFences, looksLikeHtml, injectCsp } from '@/lib/llm'
import { RateLimiter } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 120

const SYSTEM_PROMPT = `You are a senior front-end engineer who builds complete, working, single-file HTML apps.

OUTPUT FORMAT:
- Output ONLY raw HTML. No explanation, no markdown, no commentary before or after.
- Do NOT wrap the output in \`\`\`html or \`\`\` code fences. Output raw HTML directly.
- Must be a complete document: <!DOCTYPE html>, <html>, <head>, <body>.
- All CSS in a <style> tag in <head>. All JS in a <script> tag before </body>.
- Everything inline. No external scripts, stylesheets, fonts, images, or fetch requests.
- Keep it in ONE file.

QUALITY BAR:
- The app must actually work. A snake game needs a game loop, scoring, game-over. A todo app needs add/complete/delete. A markdown editor needs live preview.
- If the mission is ambiguous (e.g., "build a game"), pick a reasonable default (e.g., snake) and build it well. Don't ask for clarification.
- Include clear visual feedback for user actions (hover states, click responses, status messages).
- Make it responsive — work on both desktop and mobile widths.

ACCESSIBILITY:
- Use semantic HTML (<button>, <main>, <header>, <section>).
- All interactive elements must be keyboard-accessible.
- Include appropriate aria-labels for icon-only buttons.
- Ensure sufficient color contrast (WCAG AA).

PERFORMANCE:
- Cap animation at 60fps using requestAnimationFrame.
- No infinite loops. No busy-waiting. No synchronous heavy computation.
- Clean up event listeners and intervals on game-over/unmount if applicable.

THEME:
- Default to a dark theme (background #0f172a, text #e2e8f0) UNLESS the user specifies otherwise.
- If the user says "light theme" or "white background", honor that.

The output must be playable/usable immediately when opened in a browser.`

// Rate limit: 10 builds/hour in production, 100/hour in development
const RATE_LIMIT_MAX = process.env.NODE_ENV === 'production' ? 10 : 100
const buildLimiter = new RateLimiter(RATE_LIMIT_MAX, 60 * 60 * 1000)

interface BuildBody {
  mission?: unknown
}

export async function POST(request: NextRequest): Promise<Response> {
  // ── Request body size limit (prevent abuse) ──
  const contentLength = parseInt(request.headers.get('content-length') ?? '0', 10)
  if (contentLength > 10_000) {
    return Response.json(
      { ok: false, error: 'Request body too large (max 10KB)' },
      { status: 413 }
    )
  }

  // ── Rate limit ──
  // X-Forwarded-For is trusted because Caddy (the gateway) sets it.
  // In a deployment without a trusted proxy, this would be spoofable.
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || request.headers.get('x-real-ip')
    || 'unknown'
  const rl = buildLimiter.check(ip)
  if (!rl.ok) {
    const mins = Math.ceil(rl.resetInMs / 60000)
    logger.warn('build.rate_limited', { ip, resetInMs: rl.resetInMs })
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
    logger.warn('build.invalid_mission', { ip, error: validation.error, missionLen: mission.length })
    return Response.json({ ok: false, error: validation.error }, { status: 400 })
  }

  logger.info('build.started', { ip, mission: mission.slice(0, 80), remaining: rl.remaining })

  // Pass request.signal so the LLM call aborts if the client disconnects
  const result = await llmChat(SYSTEM_PROMPT, `Build this: ${mission}`, {
    maxTokens: 8000,
    temperature: 0.4,
    timeoutMs: 90_000,
    signal: request.signal,
  })

  if (!result.ok) {
    // result.error is already human-friendly (sanitized in llmChat)
    logger.error('build.llm_failed', { ip, mission: mission.slice(0, 80), error: result.error, ms: result.ms, tokens: result.tokens })
    return Response.json(
      { ok: false, error: result.error, tokens: result.tokens, ms: result.ms },
      { status: 502, headers: { 'X-RateLimit-Remaining': String(rl.remaining) } }
    )
  }

  const rawHtml = stripCodeFences(result.text)

  if (!looksLikeHtml(rawHtml)) {
    logger.warn('build.invalid_html', { ip, mission: mission.slice(0, 80), ms: result.ms, tokens: result.tokens, previewLen: rawHtml.length })
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

  logger.info('build.completed', { ip, mission: mission.slice(0, 80), ms: result.ms, tokens: result.tokens, htmlBytes: html.length })

  return Response.json({
    ok: true,
    html,
    tokens: result.tokens,
    ms: result.ms,
  })
}
