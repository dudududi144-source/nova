// POST /api/build/code — Stage 2 only.
// Accepts a mission + plan, generates complete HTML.
// Uses the plan to guide code generation — more focused, less truncation.

import type { NextRequest } from 'next/server'
import { llmChat, stripCodeFences, looksLikeHtml, injectCsp } from '@/lib/llm'
import { RateLimiter } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 120

const CODER_PROMPT = `You are an expert front-end engineer who builds polished, production-quality HTML apps.

OUTPUT FORMAT:
- Output ONLY raw HTML. No explanation, no markdown, no code fences.
- Must be a complete document: <!DOCTYPE html>, <html>, <head>, <body>.
- All CSS in <style>, all JS in <script>. Everything inline. One file.
- Do NOT use localStorage, sessionStorage, or cookies. Use in-memory variables.
- No external resources (scripts, fonts, images, fetch).

QUALITY REQUIREMENTS — ALL MANDATORY:
- The app MUST be fully functional. Every button, every input, every interaction works.
- Minimum 300 lines of code (HTML + CSS + JS combined). Small apps are unacceptable.
- Games MUST have: working game loop, score display, game-over state, restart button,
  responsive controls (keyboard + touch), visual feedback (colors, animations).
- Tools MUST have: clear input fields, validation, output display, error handling.
- The UI MUST look professional: gradients, shadows, rounded corners, transitions,
  proper spacing, responsive layout. Not a basic HTML page — a polished product.
- Use CSS Grid or Flexbox for layout. Add hover effects on interactive elements.
- Add a header with the app title. Add a footer or instructions section.
- Use semantic HTML (<main>, <header>, <section>, <button>).
- Add aria-labels for accessibility.
- Dark theme: background #0f172a, cards #1e293b, text #e2e8f0, primary accent from plan.

CODE QUALITY:
- Use requestAnimationFrame for game loops. Clean up on game-over.
- Use CSS custom properties (variables) for colors.
- Add CSS transitions for smooth interactions.
- Handle edge cases: empty input, division by zero, game-over state.
- Add keyboard shortcuts where appropriate (e.g., arrow keys for games).

Follow the plan precisely. Implement EVERY feature listed. Output the complete HTML now:`

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

  // Timeout controller
  const timeoutController = new AbortController()
  const timeoutTimer = setTimeout(() => timeoutController.abort(), 110_000)

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
    maxTokens: 16000,
    temperature: 0.4,
    timeoutMs: 100_000,
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
