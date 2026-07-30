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

STORAGE LIMITATION:
- The app runs in a sandboxed iframe WITHOUT access to localStorage or sessionStorage.
- Do NOT use localStorage, sessionStorage, or cookies. They will silently fail.
- Use in-memory JavaScript variables (arrays, objects) to store state instead.
- State will reset when the page reloads — that's expected and fine.

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
// Max 1000 tracked IPs to bound memory (each entry is ~100 bytes → max ~100KB)
const buildLimiter = new RateLimiter(RATE_LIMIT_MAX, 60 * 60 * 1000, 5 * 60 * 1000, 1000)

// Max request body size (10KB — mission is max 500 chars, so this is generous)
const MAX_BODY_BYTES = 10_000

interface BuildBody {
  mission?: unknown
}

interface ErrorBody {
  ok: false
  error: string
}

interface SuccessBody {
  ok: true
  html: string
  tokens: number
  ms: number
}

function errorResponse(error: string, status: number, extraHeaders?: Record<string, string>): Response {
  const body: ErrorBody = { ok: false, error }
  return Response.json(body, { status, headers: extraHeaders })
}

export async function POST(request: NextRequest): Promise<Response> {
  // ── Request body size limit (prevent abuse) ──
  // Content-Length may be missing for chunked encoding — treat as 0 (will be caught by JSON parse)
  const contentLength = parseInt(request.headers.get('content-length') ?? '0', 10)
  if (contentLength > MAX_BODY_BYTES) {
    return errorResponse('Request body too large (max 10KB)', 413)
  }

  // ── Parse body first (before rate limiting) ──
  // We don't want to consume rate limit quota on requests that fail validation.
  let body: BuildBody
  try {
    body = (await request.json()) as BuildBody
  } catch {
    return errorResponse('Invalid JSON', 400)
  }

  const mission = typeof body?.mission === 'string' ? body.mission.trim() : ''
  const validation = validateMission(mission)
  if (!validation.ok) {
    const errorMsg = validation.error ?? 'Invalid mission'
    logger.warn('build.invalid_mission', { error: errorMsg, missionLen: mission.length })
    return errorResponse(errorMsg, 400)
  }

  // ── Rate limit (after validation, so bad requests don't consume quota) ──
  // X-Forwarded-For is trusted because Caddy (the gateway) sets it.
  // In a deployment without a trusted proxy, this would be spoofable.
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || request.headers.get('x-real-ip')
    || 'unknown'
  const rl = buildLimiter.check(ip)
  if (!rl.ok) {
    const mins = Math.ceil(rl.resetInMs / 60000)
    logger.warn('build.rate_limited', { ip, resetInMs: rl.resetInMs })
    return errorResponse(
      `Rate limit reached. Try again in ${mins} minute(s).`,
      429,
      {
        'Retry-After': String(Math.ceil(rl.resetInMs / 1000)),
        'X-RateLimit-Remaining': '0',
        'X-RateLimit-Reset': String(Math.ceil(rl.resetInMs / 1000)),
      }
    )
  }

  logger.info('build.started', { ip, mission: mission.slice(0, 80), remaining: rl.remaining })

  // Create an abort controller that fires on:
  // 1. Client disconnect (request.signal)
  // 2. Timeout (95s — under Next.js's 120s maxDuration)
  // This prevents hung LLM calls from tying up the server.
  const timeoutController = new AbortController()
  const timeoutMs = 95_000
  const timeoutTimer = setTimeout(() => timeoutController.abort(), timeoutMs)

  // Link request.signal to our timeout controller
  if (request.signal.aborted) {
    clearTimeout(timeoutTimer)
    timeoutController.abort()
  } else {
    request.signal.addEventListener('abort', () => {
      clearTimeout(timeoutTimer)
      timeoutController.abort()
    }, { once: true })
  }

  const result = await llmChat(SYSTEM_PROMPT, `Build this: ${mission}`, {
    maxTokens: 16000,
    temperature: 0.4,
    timeoutMs: 90_000,
    signal: timeoutController.signal,
  })

  clearTimeout(timeoutTimer)

  if (!result.ok) {
    const errorMsg = result.error ?? 'Unknown error'
    logger.error('build.llm_failed', { ip, mission: mission.slice(0, 80), error: errorMsg, ms: result.ms, tokens: result.tokens })
    return errorResponse(
      errorMsg,
      502,
      { 'X-RateLimit-Remaining': String(rl.remaining) }
    )
  }

  let rawHtml = stripCodeFences(result.text)

  // Check if output was truncated (doesn't end with </html>) — retry with continuation
  if (rawHtml.length > 100 && !rawHtml.toLowerCase().includes('</html>')) {
    logger.warn('build.truncated', { ip, mission: mission.slice(0, 80), ms: result.ms, tokens: result.tokens, previewLen: rawHtml.length })

    // Retry: ask the LLM to complete the HTML from where it left off
    const lastChars = rawHtml.slice(-500) // send last 500 chars as context
    const retryResult = await llmChat(
      'You are continuing an interrupted HTML generation. Output ONLY the remaining HTML to complete the document. Start exactly where the previous output stopped. Do not repeat what was already generated.',
      `The previous output was truncated. Here are the last 500 characters:\n\n${lastChars}\n\nContinue from here and complete the HTML document. End with </html>.`,
      { maxTokens: 8000, temperature: 0.2, timeoutMs: 60_000, signal: timeoutController.signal }
    )

    if (retryResult.ok) {
      const continuation = stripCodeFences(retryResult.text)
      rawHtml = rawHtml + continuation
      logger.info('build.retry_completed', { ip, ms: retryResult.ms, tokens: retryResult.tokens, totalLen: rawHtml.length })
    }
  }

  if (!looksLikeHtml(rawHtml)) {
    logger.warn('build.invalid_html', { ip, mission: mission.slice(0, 80), ms: result.ms, tokens: result.tokens, previewLen: rawHtml.length })
    return errorResponse(
      'The model did not return valid HTML. Try rephrasing your request.',
      502,
      { 'X-RateLimit-Remaining': String(rl.remaining) }
    )
  }

  // Inject CSP to block external requests from the preview iframe
  const html = injectCsp(rawHtml)

  logger.info('build.completed', { ip, mission: mission.slice(0, 80), ms: result.ms, tokens: result.tokens, htmlBytes: html.length })

  const responseBody: SuccessBody = {
    ok: true,
    html,
    tokens: result.tokens,
    ms: result.ms,
  }
  return Response.json(responseBody)
}
