// POST /api/refine — Chat-driven refinement with SSE streaming.
// Same keepalive pattern as /api/build/code — prevents proxy timeout.
//
// SSE events:
//   data: {"type":"progress","step":"Analyzing code...","elapsed":15}
//   data: {"type":"result","html":"...","tokens":2000,"ms":30000}
//   data: {"type":"error","error":"message"}

import type { NextRequest } from 'next/server'
import { llmChat, stripCodeFences, looksLikeHtml, injectCsp } from '@/lib/llm'
import { RateLimiter } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'
import { validateOutput, estimateTokenBudget, analyzeQuality } from '@/lib/build-intelligence'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 180

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
- If the change is ambiguous, make a reasonable interpretation and apply it.
- Preserve all existing functionality unless the user explicitly asks to remove it.
- Maintain accessibility (semantic HTML, aria-labels, keyboard nav).
- Maintain the dark theme unless the user specifies otherwise.`

const refineLimiter = new RateLimiter(100, 60 * 60 * 1000, 5 * 60 * 1000, 1000)
const MAX_BODY_BYTES = 50_000

const REFINE_PROGRESS_STEPS = [
  'Analyzing current code...',
  'Understanding your request...',
  'Planning the changes...',
  'Applying modifications...',
  'Verifying everything still works...',
  'Finalizing the update...',
]

interface RefineBody {
  mission?: unknown
  html?: unknown
  message?: unknown
}

export async function POST(request: NextRequest): Promise<Response> {
  const contentLength = parseInt(request.headers.get('content-length') ?? '0', 10)
  if (contentLength > MAX_BODY_BYTES) {
    return Response.json({ ok: false, error: 'Request body too large (max 50KB)' }, { status: 413 })
  }

  let body: RefineBody
  try {
    body = (await request.json()) as RefineBody
  } catch {
    return Response.json({ ok: false, error: 'Invalid JSON' }, { status: 400 })
  }

  const mission = typeof body?.mission === 'string' ? body.mission.trim() : ''
  const html = typeof body?.html === 'string' ? body.html : ''
  const message = typeof body?.message === 'string' ? body.message.trim() : ''

  if (!mission) return Response.json({ ok: false, error: 'Missing mission' }, { status: 400 })
  if (!html) return Response.json({ ok: false, error: 'Missing current HTML' }, { status: 400 })
  if (!message) return Response.json({ ok: false, error: 'Missing message' }, { status: 400 })
  if (message.length > 500) return Response.json({ ok: false, error: 'Message too long (max 500 chars)' }, { status: 400 })

  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || request.headers.get('x-real-ip') || 'unknown'
  const rl = refineLimiter.check(ip)
  if (!rl.ok) {
    return Response.json({ ok: false, error: 'Rate limited' }, { status: 429 })
  }

  logger.info('refine.started', { ip, mission: mission.slice(0, 80), message: message.slice(0, 80) })

  const userPrompt = `Original mission: ${mission}\n\nCurrent HTML:\n${html}\n\nUser request: ${message}\n\nReturn the complete updated HTML.`

  const encoder = new TextEncoder()
  const startTime = Date.now()

  const stream = new ReadableStream({
    async start(controller) {
      let keepAliveInterval: ReturnType<typeof setInterval> | null = null
      let stepIndex = 0

      keepAliveInterval = setInterval(() => {
        const elapsed = Math.floor((Date.now() - startTime) / 1000)
        const step = REFINE_PROGRESS_STEPS[Math.min(stepIndex, REFINE_PROGRESS_STEPS.length - 1)]
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'progress', step, elapsed })}\n\n`))
        } catch {}
        if (elapsed > (stepIndex + 1) * 8) stepIndex++
      }, 3000)

      try {
        // Adaptive token budget — refine usually needs less than build
        const tokenBudget = estimateTokenBudget(null) // refine doesn't have a plan, use default
        logger.info('refine.budget', { ip, maxTokens: tokenBudget })

        const result = await llmChat(REFINE_PROMPT, userPrompt, {
          maxTokens: tokenBudget,
          temperature: 0.3,
          timeoutMs: 150_000,
          signal: request.signal,
        })

        if (keepAliveInterval) clearInterval(keepAliveInterval)

        if (!result.ok) {
          logger.error('refine.llm_failed', { ip, error: result.error, ms: result.ms })
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'error', error: result.error ?? 'Refine failed' })}\n\n`))
          controller.close()
          return
        }

        let rawHtml = stripCodeFences(result.text)

        // Truncation detection + continuation
        if (rawHtml.length > 100 && !rawHtml.toLowerCase().includes('</html>')) {
          logger.warn('refine.truncated', { ip, ms: result.ms, tokens: result.tokens, previewLen: rawHtml.length })
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'progress', step: 'Completing truncated output...', elapsed: Math.floor((Date.now() - startTime) / 1000) })}\n\n`))
          const lastChars = rawHtml.slice(-500)
          const retryResult = await llmChat(
            'Continue the interrupted HTML. Output ONLY the remaining HTML.',
            `Truncated. Last 500 chars:\n\n${lastChars}\n\nContinue with </html>.`,
            { maxTokens: 8000, temperature: 0.2, timeoutMs: 40_000, signal: request.signal }
          )
          if (retryResult.ok) {
            rawHtml = rawHtml + stripCodeFences(retryResult.text)
          }
        }

        if (!looksLikeHtml(rawHtml)) {
          logger.warn('refine.invalid_html', { ip, ms: result.ms, tokens: result.tokens, previewLen: rawHtml.length })
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'error', error: 'The AI generated invalid output. Try rephrasing your request.' })}\n\n`))
          controller.close()
          return
        }

        const finalHtml = injectCsp(rawHtml)
        const totalMs = Date.now() - startTime

        // ── INTELLIGENCE: Validate refined output ──
        const validation = validateOutput(finalHtml, mission)
        logger.info('refine.validated', { ip, score: validation.score, passed: validation.passed })

        // ── INTELLIGENCE: Quality metrics ──
        const metrics = analyzeQuality(finalHtml)
        logger.info('refine.completed', { ip, ms: totalMs, tokens: result.tokens, htmlBytes: finalHtml.length, score: validation.score, metrics: metrics.summary })

        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'result', html: finalHtml, tokens: result.tokens, ms: totalMs, quality: validation.score, metrics: metrics.summary })}\n\n`))
        controller.close()
      } catch (err: unknown) {
        if (keepAliveInterval) clearInterval(keepAliveInterval)
        const errorMsg = err instanceof Error ? err.message : 'Unknown error'
        logger.error('refine.exception', { ip, error: errorMsg })
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'error', error: errorMsg })}\n\n`))
        } catch {}
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  })
}
