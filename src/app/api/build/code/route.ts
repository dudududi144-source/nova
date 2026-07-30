// POST /api/build/code — Stage 2 only.
// Accepts a mission + plan, generates complete HTML.
// Uses the plan to guide code generation — more focused, less truncation.

import type { NextRequest } from 'next/server'
import { llmChat, stripCodeFences, looksLikeHtml, injectCsp } from '@/lib/llm'
import { RateLimiter } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 90

const CODER_PROMPT = `You are an expert front-end engineer. Output the complete HTML app.

OUTPUT FORMAT:
- Output ONLY raw HTML. No explanation, no markdown, no code fences.
- Complete document: <!DOCTYPE html>, <html>, <head>, <body>.
- All CSS in <style>, all JS in <script>. Everything inline. One file.
- Do NOT use localStorage. Use in-memory variables.
- No external resources.

QUALITY:
- The app MUST work fully. Every button, input, interaction.
- Games: game loop (requestAnimationFrame), score, game-over, restart, arrow keys.
- Professional UI: dark theme (#0f172a bg, #1e293b cards, #e2e8f0 text), gradients,
  shadows, rounded corners, responsive layout.
- Semantic HTML, aria-labels, CSS transitions on interactive elements.
- Handle edge cases (empty input, game-over state).

Keep it concise but complete. Output the HTML now:`

const codeLimiter = new RateLimiter(100, 60 * 60 * 1000, 5 * 60 * 1000, 1000)
const MAX_BODY_BYTES = 50_000

interface CodeBody {
  mission?: unknown
  plan?: unknown
}

export async function POST(request: NextRequest): Promise<Response> {
  const contentLength = parseInt(request.headers.get('content-length') ?? '0', 10)
  if (contentLength > MAX_BODY_BYTES) {
    return Response.json({ ok: false, error: 'Request body too large' }, { status: 413 })
  }

  let body: CodeBody
  try {
    body = (await request.json()) as CodeBody
  } catch {
    return Response.json({ ok: false, error: 'Invalid JSON' }, { status: 400 })
  }

  const mission = typeof body?.mission === 'string' ? body.mission.trim() : ''
  const plan = body?.plan

  if (!mission) {
    return Response.json({ ok: false, error: 'Missing mission' }, { status: 400 })
  }

  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || request.headers.get('x-real-ip') || 'unknown'
  const rl = codeLimiter.check(ip)
  if (!rl.ok) {
    return Response.json({ ok: false, error: 'Rate limited' }, { status: 429 })
  }

  logger.info('code.started', { ip, mission: mission.slice(0, 80), hasPlan: !!plan })

  // Timeout controller — 75s (under 90s maxDuration, under Caddy/browser timeout)
  const timeoutController = new AbortController()
  const timeoutTimer = setTimeout(() => timeoutController.abort(), 75_000)

  if (request.signal.aborted) {
    clearTimeout(timeoutTimer)
    timeoutController.abort()
  } else {
    request.signal.addEventListener('abort', () => {
      clearTimeout(timeoutTimer)
      timeoutController.abort()
    }, { once: true })
  }

  const planContext = plan
    ? `Plan:\n${JSON.stringify(plan, null, 2)}\n\nMission: ${mission}`
    : `Mission: ${mission}`

  const result = await llmChat(CODER_PROMPT, planContext, {
    maxTokens: 12000,
    temperature: 0.4,
    timeoutMs: 70_000,
    signal: timeoutController.signal,
  })

  if (!result.ok) {
    clearTimeout(timeoutTimer)
    logger.error('code.failed', { ip, error: result.error, ms: result.ms })
    return Response.json({ ok: false, error: result.error ?? 'Coder failed' }, { status: 502 })
  }

  let rawHtml = stripCodeFences(result.text)

  // Truncation detection + continuation retry
  if (rawHtml.length > 100 && !rawHtml.toLowerCase().includes('</html>')) {
    logger.warn('code.truncated', { ip, ms: result.ms, tokens: result.tokens, previewLen: rawHtml.length })
    const lastChars = rawHtml.slice(-500)
    const retryResult = await llmChat(
      'You are continuing an interrupted HTML generation. Output ONLY the remaining HTML. Start exactly where the previous output stopped.',
      `The previous output was truncated. Last 500 chars:\n\n${lastChars}\n\nContinue and complete with </html>.`,
      { maxTokens: 8000, temperature: 0.2, timeoutMs: 40_000, signal: timeoutController.signal }
    )
    if (retryResult.ok) {
      rawHtml = rawHtml + stripCodeFences(retryResult.text)
      logger.info('code.retry_completed', { ip, ms: retryResult.ms, tokens: retryResult.tokens, totalLen: rawHtml.length })
    }
  }

  clearTimeout(timeoutTimer)

  if (!looksLikeHtml(rawHtml)) {
    logger.warn('code.invalid_html', { ip, ms: result.ms, tokens: result.tokens, previewLen: rawHtml.length })
    return Response.json({
      ok: false,
      error: 'The AI generated invalid output. Try simplifying your request or try again.',
    }, { status: 502 })
  }

  const html = injectCsp(rawHtml)
  logger.info('code.completed', { ip, ms: result.ms, tokens: result.tokens, htmlBytes: html.length })

  return Response.json({
    ok: true,
    html,
    tokens: result.tokens,
    ms: result.ms,
  })
}
