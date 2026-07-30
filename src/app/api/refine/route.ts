// POST /api/refine — Chat-driven refinement with SSE streaming + real token streaming.
// Same keepalive + token streaming pattern as /api/build/code.
//
// SSE events:
//   data: {"type":"progress","step":"Analyzing code...","elapsed":15}
//   data: {"type":"token","text":"...","length":1234}
//   data: {"type":"result","html":"...","tokens":2000,"ms":30000}
//   data: {"type":"error","error":"message"}

import type { NextRequest } from 'next/server'
import { llmChatStream, llmChat } from '@/lib/llm'
import { stripCodeFences, looksLikeHtml, injectCsp } from '@/lib/html-utils'
import { validateMission } from '@/lib/mission'
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

  // Validate mission (control chars, length, etc. — same as architect and code routes)
  const missionCheck = validateMission(mission)
  if (!missionCheck.ok) return Response.json({ ok: false, error: missionCheck.error ?? 'Invalid mission' }, { status: 400 })
  // Validate message (reuse validateMission — same rules: 3-500 chars, no control chars)
  const messageCheck = validateMission(message)
  if (!messageCheck.ok) return Response.json({ ok: false, error: messageCheck.error ?? 'Invalid message' }, { status: 400 })
  // Validate HTML — must look like a complete HTML document
  if (!looksLikeHtml(html)) return Response.json({ ok: false, error: 'Invalid HTML' }, { status: 400 })

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
        } catch {
          // Stream closed by client — stop the keepalive to prevent silent interval spam
          if (keepAliveInterval) clearInterval(keepAliveInterval)
          keepAliveInterval = null
        }
        if (elapsed > (stepIndex + 1) * 8) stepIndex++
      }, 3000)

      try {
        // Adaptive token budget — adapt to current HTML size.
        // 1 token ≈ 3.5 chars for HTML, plus 4000 for the change.
        // Clamp to [16000, 32000] so small HTML doesn't under-allocate
        // and large HTML doesn't exceed the model's context window.
        const estimatedInputTokens = Math.ceil(html.length / 3.5)
        const tokenBudget = Math.max(16000, Math.min(32000, estimatedInputTokens + 4000))
        logger.info('refine.budget', { ip, maxTokens: tokenBudget, htmlBytes: html.length })

        // ═══ REAL STREAMING ═══
        // Stream tokens from LLM → client in real-time via SSE
        // User sees the refined HTML appearing character by character
        let fullText = ''
        let totalTokens = 0
        let llmMs = 0
        let streamError: string | null = null

        for await (const chunk of llmChatStream(REFINE_PROMPT, userPrompt, {
          maxTokens: tokenBudget,
          temperature: 0.3,
          timeoutMs: 150_000,
          signal: request.signal,
        })) {
          if (chunk.error) {
            streamError = chunk.error
            break
          }
          if (chunk.done) {
            totalTokens = chunk.tokens
            llmMs = chunk.ms
            break
          }
          // Send each token chunk to client immediately
          if (chunk.text) {
            fullText = chunk.fullText
            try {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'token', text: chunk.text, length: fullText.length })}\n\n`))
            } catch {
              // stream closed by client
              break
            }
          }
        }

        // Stop keepalive
        if (keepAliveInterval) clearInterval(keepAliveInterval)

        if (streamError) {
          logger.error('refine.failed', { ip, error: streamError, ms: llmMs })
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'error', error: streamError })}\n\n`))
          controller.close()
          return
        }

        let rawHtml = stripCodeFences(fullText)

        // Truncation detection + continuation retry
        if (rawHtml.length > 100 && !rawHtml.toLowerCase().includes('</html>')) {
          logger.warn('refine.truncated', { ip, ms: llmMs, tokens: totalTokens, previewLen: rawHtml.length })
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'progress', step: 'Completing truncated output...', elapsed: Math.floor((Date.now() - startTime) / 1000) })}\n\n`))

          const lastChars = rawHtml.slice(-500)
          const retryResult = await llmChat(
            'You are continuing an interrupted HTML generation. Output ONLY the remaining HTML. Start exactly where the previous output stopped.',
            `The previous output was truncated. Last 500 chars:\n\n${lastChars}\n\nContinue and complete with </html>.`,
            { maxTokens: 8000, temperature: 0.2, timeoutMs: 40_000, signal: request.signal }
          )
          if (retryResult.ok) {
            rawHtml = rawHtml + stripCodeFences(retryResult.text)
            logger.info('refine.retry_completed', { ip, ms: retryResult.ms, tokens: retryResult.tokens, totalLen: rawHtml.length })
          }
        }

        if (!looksLikeHtml(rawHtml)) {
          logger.warn('refine.invalid_html', { ip, ms: llmMs, tokens: totalTokens, previewLen: rawHtml.length })
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'error', error: 'The AI generated invalid output. Try rephrasing your request.' })}\n\n`))
          controller.close()
          return
        }

        const finalHtml = injectCsp(rawHtml)
        const totalMs = Date.now() - startTime

        // ── INTELLIGENCE: Validate refined output ──
        const validation = validateOutput(finalHtml, mission)
        logger.info('refine.validated', { ip, score: validation.score, passed: validation.passed })

        // If validation failed (score < 70), try ONE retry with targeted hint (same as code route)
        if (!validation.passed && validation.retryHint) {
          logger.warn('refine.validation_failed', { ip, score: validation.score, retrying: true })
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'progress', step: 'Improving output quality...', elapsed: Math.floor((Date.now() - startTime) / 1000) })}\n\n`))

          const retryPrompt = `${userPrompt}\n\n${validation.retryHint}\n\nOutput the complete corrected HTML:`
          const retryResult = await llmChat(REFINE_PROMPT, retryPrompt, {
            maxTokens: tokenBudget,
            temperature: 0.3,
            timeoutMs: 100_000,
            signal: request.signal,
          })

          if (retryResult.ok) {
            const retryHtml = stripCodeFences(retryResult.text)
            if (looksLikeHtml(retryHtml)) {
              const retryValidation = validateOutput(injectCsp(retryHtml), mission)
              logger.info('refine.retry_validated', { ip, score: retryValidation.score, improved: retryValidation.score > validation.score })
              if (retryValidation.score > validation.score) {
                // Use the improved version
                const improvedHtml = injectCsp(retryHtml)
                const metrics = analyzeQuality(improvedHtml)
                logger.info('refine.completed', { ip, ms: Date.now() - startTime, tokens: totalTokens + retryResult.tokens, htmlBytes: improvedHtml.length, score: retryValidation.score, metrics: metrics.summary })
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'result', html: improvedHtml, tokens: totalTokens + retryResult.tokens, ms: Date.now() - startTime, quality: retryValidation.score, metrics: metrics.summary })}\n\n`))
                controller.close()
                return
              }
            }
          }
          // Retry didn't help — use original
        }

        // ── INTELLIGENCE: Quality metrics ──
        const metrics = analyzeQuality(finalHtml)
        logger.info('refine.completed', { ip, ms: totalMs, tokens: totalTokens, htmlBytes: finalHtml.length, score: validation.score, metrics: metrics.summary })

        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'result', html: finalHtml, tokens: totalTokens, ms: totalMs, quality: validation.score, metrics: metrics.summary })}\n\n`))
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
      'X-Accel-Buffering': 'no', // Disable nginx buffering — critical for SSE streaming
    },
  })
}
