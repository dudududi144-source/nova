// POST /api/build — 2-stage pipeline: ARCHITECT + CODE
//
// Stage 1 (ARCHITECT): Small, fast, reliable LLM call. Returns a JSON plan:
//   { type, title, features: [], approach: "brief description", colorScheme: {} }
//   ~200-500 tokens. Never truncates. Always succeeds.
//
// Stage 2 (CODE): Uses the plan as context to generate focused HTML.
//   The plan guides the LLM — less "thinking" wasted, more tokens for actual code.
//   If truncated, automatic continuation retry.
//
// This approach is different from single-shot: it separates thinking from coding.
// The architect thinks cheaply. The coder writes efficiently. Both stages are
// less likely to truncate because each has a focused job.

import type { NextRequest } from 'next/server'
import { llmChat, validateMission, stripCodeFences, looksLikeHtml, injectCsp } from '@/lib/llm'
import { RateLimiter } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 120

// ── Stage 1: Architect Prompt ──
// Returns a small JSON plan. Very low token count. Very reliable.
const ARCHITECT_PROMPT = `You are a software architect. Given a mission, output a JSON plan for a single-file HTML app.

Rules:
- Output ONLY valid JSON. No markdown, no explanation.
- Keep it brief — this plan guides code generation.

JSON format:
{
  "type": "game|tool|app|utility",
  "title": "short title",
  "features": ["feature 1", "feature 2", "feature 3"],
  "approach": "1-2 sentence description of how to build it",
  "colors": { "bg": "#hex", "primary": "#hex", "accent": "#hex" },
  "layout": "description of the UI layout",
  "keyFunctions": ["function1", "function2"]
}`

// ── Stage 2: Coder Prompt ──
// Uses the plan to write focused, complete HTML.
const CODER_PROMPT = `You are a senior front-end engineer. You receive a plan and must output the complete HTML.

OUTPUT FORMAT:
- Output ONLY raw HTML. No explanation, no markdown, no code fences.
- Must be a complete document: <!DOCTYPE html>, <html>, <head>, <body>.
- All CSS in <style>, all JS in <script>. Everything inline. One file.
- Do NOT use localStorage, sessionStorage, or cookies. Use in-memory variables.
- No external resources (scripts, fonts, images, fetch).

QUALITY:
- The app MUST work. Implement every feature in the plan.
- Use semantic HTML, aria-labels, keyboard accessibility.
- Use requestAnimationFrame for animations. No infinite loops.
- Dark theme by default (use the colors from the plan).

Follow the plan precisely. Output the complete HTML now:`

// Rate limit: 10 builds/hour in production, 100/hour in development
const RATE_LIMIT_MAX = process.env.NODE_ENV === 'production' ? 10 : 100
const buildLimiter = new RateLimiter(RATE_LIMIT_MAX, 60 * 60 * 1000, 5 * 60 * 1000, 1000)

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
  plan: unknown
}

function errorResponse(error: string, status: number, extraHeaders?: Record<string, string>): Response {
  const body: ErrorBody = { ok: false, error }
  return Response.json(body, { status, headers: extraHeaders })
}

export async function POST(request: NextRequest): Promise<Response> {
  const contentLength = parseInt(request.headers.get('content-length') ?? '0', 10)
  if (contentLength > MAX_BODY_BYTES) {
    return errorResponse('Request body too large (max 10KB)', 413)
  }

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
      { 'Retry-After': String(Math.ceil(rl.resetInMs / 1000)) }
    )
  }

  logger.info('build.started', { ip, mission: mission.slice(0, 80), remaining: rl.remaining })

  // ── Timeout controller ──
  const timeoutController = new AbortController()
  const timeoutTimer = setTimeout(() => timeoutController.abort(), 110_000) // 110s — under 120s maxDuration

  if (request.signal.aborted) {
    clearTimeout(timeoutTimer)
    timeoutController.abort()
  } else {
    request.signal.addEventListener('abort', () => {
      clearTimeout(timeoutTimer)
      timeoutController.abort()
    }, { once: true })
  }

  // ═══════════════════════════════════════════════════════════
  // STAGE 1: ARCHITECT — generate a small JSON plan
  // ═══════════════════════════════════════════════════════════
  logger.info('build.architect_started', { ip, mission: mission.slice(0, 80) })

  const architectResult = await llmChat(ARCHITECT_PROMPT, `Mission: ${mission}`, {
    maxTokens: 1000,
    temperature: 0.5,
    timeoutMs: 30_000,
    signal: timeoutController.signal,
  })

  if (!architectResult.ok) {
    clearTimeout(timeoutTimer)
    const errorMsg = architectResult.error ?? 'Architect failed'
    logger.error('build.architect_failed', { ip, error: errorMsg, ms: architectResult.ms })
    return errorResponse(errorMsg, 502)
  }

  // Parse the plan (best-effort — if it fails, use a default plan)
  let plan: unknown = null
  try {
    const planText = architectResult.text.trim()
    const jsonStart = planText.indexOf('{')
    const jsonEnd = planText.lastIndexOf('}')
    if (jsonStart >= 0 && jsonEnd > jsonStart) {
      plan = JSON.parse(planText.slice(jsonStart, jsonEnd + 1))
    }
  } catch {
    // Plan parsing failed — continue with null plan, coder will still work
  }

  logger.info('build.architect_completed', { ip, ms: architectResult.ms, tokens: architectResult.tokens, hasPlan: !!plan })

  // ═══════════════════════════════════════════════════════════
  // STAGE 2: CODER — generate complete HTML using the plan
  // ═══════════════════════════════════════════════════════════
  logger.info('build.coder_started', { ip })

  const planContext = plan
    ? `Plan:\n${JSON.stringify(plan, null, 2)}\n\nMission: ${mission}`
    : `Mission: ${mission}`

  const coderResult = await llmChat(CODER_PROMPT, planContext, {
    maxTokens: 16000,
    temperature: 0.4,
    timeoutMs: 80_000,
    signal: timeoutController.signal,
  })

  if (!coderResult.ok) {
    clearTimeout(timeoutTimer)
    const errorMsg = coderResult.error ?? 'Coder failed'
    logger.error('build.coder_failed', { ip, error: errorMsg, ms: coderResult.ms })
    return errorResponse(errorMsg, 502)
  }

  let rawHtml = stripCodeFences(coderResult.text)

  // ── Truncation detection + continuation retry ──
  if (rawHtml.length > 100 && !rawHtml.toLowerCase().includes('</html>')) {
    logger.warn('build.truncated', { ip, ms: coderResult.ms, tokens: coderResult.tokens, previewLen: rawHtml.length })

    const lastChars = rawHtml.slice(-500)
    const retryResult = await llmChat(
      'You are continuing an interrupted HTML generation. Output ONLY the remaining HTML to complete the document. Start exactly where the previous output stopped. Do not repeat what was already generated.',
      `The previous output was truncated. Here are the last 500 characters:\n\n${lastChars}\n\nContinue from here and complete the HTML document. End with </html>.`,
      { maxTokens: 8000, temperature: 0.2, timeoutMs: 40_000, signal: timeoutController.signal }
    )

    if (retryResult.ok) {
      rawHtml = rawHtml + stripCodeFences(retryResult.text)
      logger.info('build.retry_completed', { ip, ms: retryResult.ms, tokens: retryResult.tokens, totalLen: rawHtml.length })
    }
  }

  clearTimeout(timeoutTimer)

  if (!looksLikeHtml(rawHtml)) {
    logger.warn('build.invalid_html', { ip, ms: coderResult.ms, tokens: coderResult.tokens, previewLen: rawHtml.length })
    return errorResponse(
      'The AI generated invalid output. This usually happens with very complex requests. Try simplifying your request, or try again — the AI varies between attempts.',
      502
    )
  }

  const html = injectCsp(rawHtml)

  const totalMs = architectResult.ms + coderResult.ms
  const totalTokens = architectResult.tokens + coderResult.tokens

  logger.info('build.completed', { ip, ms: totalMs, tokens: totalTokens, htmlBytes: html.length, hasPlan: !!plan })

  const responseBody: SuccessBody = {
    ok: true,
    html,
    tokens: totalTokens,
    ms: totalMs,
    plan,
  }
  return Response.json(responseBody)
}
