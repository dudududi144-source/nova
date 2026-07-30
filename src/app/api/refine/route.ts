// POST /api/refine — Chat-driven refinement.
// Body: { mission: string, html: string, message: string }
// Returns: { ok, html, tokens, ms } or { ok: false, error }
//
// The LLM receives the current mission + full HTML + user message.
// It returns the COMPLETE updated HTML file (not a patch).
// This avoids patch-merge bugs at the cost of more tokens per refine.

import type { NextRequest } from 'next/server'
import { llmChat, validateMission, stripCodeFences, looksLikeHtml, injectCsp } from '@/lib/llm'
import { RateLimiter } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 120

const REFINE_PROMPT = `You are a senior front-end engineer refining an existing HTML app.

The user has an existing single-file HTML app. They want to change something.
You will receive: the original mission, the current HTML, and the user's request.

OUTPUT FORMAT:
- Output ONLY the complete updated raw HTML. No explanation, no markdown.
- Do NOT wrap the output in code fences. Output raw HTML directly.
- The HTML must remain a complete document: <!DOCTYPE html>, <html>, <head>, <body>.
- Keep all CSS in <style> tags and all JS in <script> tags — everything inline.
- Do NOT use localStorage, sessionStorage, or cookies. Use in-memory variables.
- No external resources (scripts, stylesheets, fonts, images, fetch).

REFINEMENT RULES:
- Apply the user's requested change to the existing HTML.
- Keep everything else the same — don't rewrite unrelated parts.
- If the user asks a question (e.g., "what does this do?"), still return the full HTML
  with no changes — they're just exploring.
- If the change is ambiguous, make a reasonable interpretation and apply it.
- Preserve all existing functionality unless the user explicitly asks to remove it.
- Maintain accessibility (semantic HTML, aria-labels, keyboard nav).
- Maintain the dark theme unless the user specifies otherwise.`

// Rate limit: same as build (shared quota — both consume LLM tokens)
const RATE_LIMIT_MAX = process.env.NODE_ENV === 'production' ? 10 : 100
const refineLimiter = new RateLimiter(RATE_LIMIT_MAX, 60 * 60 * 1000, 5 * 60 * 1000, 1000)

const MAX_BODY_BYTES = 50_000 // larger than build — HTML can be 15-20KB

interface RefineBody {
  mission?: unknown
  html?: unknown
  message?: unknown
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

function errorResponse(error: string, status: number): Response {
  const body: ErrorBody = { ok: false, error }
  return Response.json(body, { status })
}

export async function POST(request: NextRequest): Promise<Response> {
  // Body size limit
  const contentLength = parseInt(request.headers.get('content-length') ?? '0', 10)
  if (contentLength > MAX_BODY_BYTES) {
    return errorResponse('Request body too large (max 50KB)', 413)
  }

  // Parse body
  let body: RefineBody
  try {
    body = (await request.json()) as RefineBody
  } catch {
    return errorResponse('Invalid JSON', 400)
  }

  // Validate fields
  const mission = typeof body?.mission === 'string' ? body.mission.trim() : ''
  const html = typeof body?.html === 'string' ? body.html : ''
  const message = typeof body?.message === 'string' ? body.message.trim() : ''

  if (!mission) return errorResponse('Missing mission', 400)
  if (!html) return errorResponse('Missing current HTML', 400)
  if (!message) return errorResponse('Missing message', 400)
  if (message.length > 500) return errorResponse('Message too long (max 500 chars)', 400)

  // Rate limit (after validation — bad requests don't consume quota)
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || request.headers.get('x-real-ip')
    || 'unknown'
  const rl = refineLimiter.check(ip)
  if (!rl.ok) {
    const mins = Math.ceil(rl.resetInMs / 60000)
    logger.warn('refine.rate_limited', { ip, resetInMs: rl.resetInMs })
    return errorResponse(
      `Rate limit reached. Try again in ${mins} minute(s).`,
      429
    )
  }

  logger.info('refine.started', { ip, mission: mission.slice(0, 80), message: message.slice(0, 80) })

  // Timeout controller (95s — under Next.js 120s maxDuration)
  const timeoutController = new AbortController()
  const timeoutMs = 95_000
  const timeoutTimer = setTimeout(() => timeoutController.abort(), timeoutMs)

  if (request.signal.aborted) {
    clearTimeout(timeoutTimer)
    timeoutController.abort()
  } else {
    request.signal.addEventListener('abort', () => {
      clearTimeout(timeoutTimer)
      timeoutController.abort()
    }, { once: true })
  }

  const userPrompt = `Original mission: ${mission}

Current HTML:
${html}

User request: ${message}

Return the complete updated HTML with the requested change applied.`

  let result = await llmChat(REFINE_PROMPT, userPrompt, {
    maxTokens: 16000,
    temperature: 0.3, // lower temp for refinement — more precise
    timeoutMs: 90_000,
    signal: timeoutController.signal,
  })

  clearTimeout(timeoutTimer)

  if (!result.ok) {
    const errorMsg = result.error ?? 'Unknown error'
    logger.error('refine.llm_failed', { ip, error: errorMsg, ms: result.ms })
    return errorResponse(errorMsg, 502)
  }

  let rawHtml = stripCodeFences(result.text)

  // Check if output was truncated — retry with continuation
  if (rawHtml.length > 100 && !rawHtml.toLowerCase().includes('</html>')) {
    logger.warn('refine.truncated', { ip, ms: result.ms, tokens: result.tokens, previewLen: rawHtml.length })
    const lastChars = rawHtml.slice(-500)
    const retryResult = await llmChat(
      'You are continuing an interrupted HTML generation. Output ONLY the remaining HTML. Start exactly where the previous output stopped.',
      `The previous output was truncated. Last 500 chars:\n\n${lastChars}\n\nContinue and complete with </html>.`,
      { maxTokens: 8000, temperature: 0.2, timeoutMs: 60_000, signal: timeoutController.signal }
    )
    if (retryResult.ok) {
      rawHtml = rawHtml + stripCodeFences(retryResult.text)
      logger.info('refine.retry_completed', { ip, ms: retryResult.ms, tokens: retryResult.tokens, totalLen: rawHtml.length })
    }
  }

  if (!looksLikeHtml(rawHtml)) {
    logger.warn('refine.invalid_html', { ip, ms: result.ms, tokens: result.tokens, previewLen: rawHtml.length })
    return errorResponse('The model did not return valid HTML. Try rephrasing your request.', 502)
  }

  const finalHtml = injectCsp(rawHtml)

  logger.info('refine.completed', { ip, ms: result.ms, tokens: result.tokens, htmlBytes: finalHtml.length })

  const responseBody: SuccessBody = {
    ok: true,
    html: finalHtml,
    tokens: result.tokens,
    ms: result.ms,
  }
  return Response.json(responseBody)
}
