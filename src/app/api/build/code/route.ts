// POST /api/build/code — Stage 2 with SSE streaming + keepalive.
// Returns a stream of Server-Sent Events:
//   data: {"type":"progress","step":"Writing code...","elapsed":15}
//   data: {"type":"progress","step":"Adding styles...","elapsed":30}
//   data: {"type":"result","html":"<!DOCTYPE html>...","tokens":3000,"ms":45000}
//   data: {"type":"error","error":"message"}
//
// The keepalive events prevent proxy/browser timeout during long LLM calls.
// No arbitrary maxTokens limit — LLM generates until it's naturally done.

import type { NextRequest } from 'next/server'
import { llmChatStream, llmChat } from '@/lib/llm'
import { stripCodeFences, looksLikeHtml, injectCsp } from '@/lib/html-utils'
import { validateMission } from '@/lib/mission'
import { RateLimiter } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'
import { validateOutput, estimateTokenBudget, analyzeQuality } from '@/lib/build-intelligence'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 180 // generous — keepalive prevents proxy timeout

const CODER_PROMPT = `You are an expert front-end engineer. Output the complete HTML app.

OUTPUT FORMAT:
- Output ONLY raw HTML. No explanation, no markdown, no code fences.
- Complete document: <!DOCTYPE html>, <html>, <head>, <body>.
- All CSS in <style>, all JS in <script>. Everything inline. One file.
- Do NOT use localStorage, sessionStorage, or document.cookie. Use in-memory variables.
- No external resources (no fetch, no CDN scripts, no external fonts/images).

PLAN:
- If a Plan is provided in the user message, follow it closely:
  implement every listed feature, use the suggested approach, apply the suggested
  colors, and structure the UI per the suggested layout.
- The plan was created by an architect — trust its feature list and key functions.

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

const PROGRESS_STEPS = [
  'Writing HTML structure...',
  'Adding CSS styles...',
  'Implementing JavaScript logic...',
  'Adding interactivity...',
  'Polishing the UI...',
  'Finalizing the code...',
]

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

  // Validate mission (same validation as architect route — control chars, length, etc.)
  const missionCheck = validateMission(mission)
  if (!missionCheck.ok) {
    return Response.json({ ok: false, error: missionCheck.error ?? 'Invalid mission' }, { status: 400 })
  }

  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || request.headers.get('x-real-ip') || 'unknown'
  const rl = codeLimiter.check(ip)
  if (!rl.ok) {
    return Response.json({ ok: false, error: 'Rate limited' }, { status: 429 })
  }

  logger.info('code.started', { ip, mission: mission.slice(0, 80), hasPlan: !!plan })

  const planContext = plan
    ? `Plan:\n${JSON.stringify(plan, null, 2)}\n\nMission: ${mission}`
    : `Mission: ${mission}`

  // Create SSE stream with keepalive
  const encoder = new TextEncoder()
  const startTime = Date.now()

  const stream = new ReadableStream({
    async start(controller) {
      let keepAliveInterval: ReturnType<typeof setInterval> | null = null
      let stepIndex = 0

      // Send keepalive progress events every 3 seconds
      // This prevents proxy/browser timeout during long LLM calls
      keepAliveInterval = setInterval(() => {
        const elapsed = Math.floor((Date.now() - startTime) / 1000)
        const step = PROGRESS_STEPS[Math.min(stepIndex, PROGRESS_STEPS.length - 1)]
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'progress', step, elapsed })}\n\n`))
        } catch {
          // Stream closed by client — stop the keepalive to prevent silent interval spam
          if (keepAliveInterval) clearInterval(keepAliveInterval)
          keepAliveInterval = null
        }
        // Advance step every 8 seconds
        if (elapsed > (stepIndex + 1) * 8) {
          stepIndex++
        }
      }, 3000)

      try {
        // Adaptive token budget
        const tokenBudget = estimateTokenBudget(plan)
        logger.info('code.budget', { ip, maxTokens: tokenBudget, hasPlan: !!plan })

        // ═══ REAL STREAMING ═══
        // Stream tokens from LLM → client in real-time via SSE
        // User sees HTML appearing character by character
        let fullText = ''
        let totalTokens = 0
        let llmMs = 0
        let streamError: string | null = null

        for await (const chunk of llmChatStream(CODER_PROMPT, planContext, {
          maxTokens: tokenBudget,
          temperature: 0.4,
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
          logger.error('code.failed', { ip, error: streamError, ms: llmMs })
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'error', error: streamError })}\n\n`))
          controller.close()
          return
        }

        let rawHtml = stripCodeFences(fullText)

        // Truncation detection + continuation retry
        if (rawHtml.length > 100 && !rawHtml.toLowerCase().includes('</html>')) {
          logger.warn('code.truncated', { ip, ms: llmMs, tokens: totalTokens, previewLen: rawHtml.length })
          // Send progress event
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'progress', step: 'Completing truncated output...', elapsed: Math.floor((Date.now() - startTime) / 1000) })}\n\n`))

          const lastChars = rawHtml.slice(-500)
          const retryResult = await llmChat(
            'You are continuing an interrupted HTML generation. Output ONLY the remaining HTML. Start exactly where the previous output stopped.',
            `The previous output was truncated. Last 500 chars:\n\n${lastChars}\n\nContinue and complete with </html>.`,
            { maxTokens: 8000, temperature: 0.2, timeoutMs: 40_000, signal: request.signal }
          )
          if (retryResult.ok) {
            rawHtml = rawHtml + stripCodeFences(retryResult.text)
            logger.info('code.retry_completed', { ip, ms: retryResult.ms, tokens: retryResult.tokens, totalLen: rawHtml.length })
          }
        }

        if (!looksLikeHtml(rawHtml)) {
          logger.warn('code.invalid_html', { ip, ms: llmMs, tokens: totalTokens, previewLen: rawHtml.length })
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'error', error: 'The AI generated invalid output. Try again or simplify your request.' })}\n\n`))
          controller.close()
          return
        }

        const html = injectCsp(rawHtml)
        const totalMs = Date.now() - startTime

        // ── INTELLIGENCE: Validate output quality ──
        const validation = validateOutput(html, mission)
        logger.info('code.validated', { ip, score: validation.score, passed: validation.passed, checks: validation.checks.length })

        // If validation failed (score < 70), try ONE retry with targeted hint
        if (!validation.passed && validation.retryHint) {
          logger.warn('code.validation_failed', { ip, score: validation.score, retrying: true })
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'progress', step: 'Improving output quality...', elapsed: Math.floor((Date.now() - startTime) / 1000) })}\n\n`))

          const retryPrompt = `${planContext}\n\n${validation.retryHint}\n\nOutput the complete corrected HTML:`
          const retryResult = await llmChat(CODER_PROMPT, retryPrompt, {
            maxTokens: tokenBudget,
            temperature: 0.3,
            timeoutMs: 25_000, // 25s — must fit within maxDuration (180s) after stream (150s) + truncation retry (40s)
            signal: request.signal,
          })

          if (retryResult.ok) {
            const retryHtml = stripCodeFences(retryResult.text)
            if (looksLikeHtml(retryHtml)) {
              const retryValidation = validateOutput(injectCsp(retryHtml), mission)
              logger.info('code.retry_validated', { ip, score: retryValidation.score, improved: retryValidation.score > validation.score })
              if (retryValidation.score > validation.score) {
                // Use the improved version
                const finalHtml = injectCsp(retryHtml)
                const metrics = analyzeQuality(finalHtml)
                logger.info('code.completed', { ip, ms: Date.now() - startTime, tokens: totalTokens + retryResult.tokens, htmlBytes: finalHtml.length, score: retryValidation.score, metrics: metrics.summary })
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'result', html: finalHtml, tokens: totalTokens + retryResult.tokens, ms: Date.now() - startTime, quality: retryValidation.score, metrics: metrics.summary })}\n\n`))
                controller.close()
                return
              }
            }
          }
          // Retry didn't help — use original
        }

        // ── INTELLIGENCE: Quality metrics ──
        const metrics = analyzeQuality(html)
        logger.info('code.completed', { ip, ms: totalMs, tokens: totalTokens, htmlBytes: html.length, score: validation.score, metrics: metrics.summary })

        // Send the final result with quality score and metrics
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'result', html, tokens: totalTokens, ms: totalMs, quality: validation.score, metrics: metrics.summary })}\n\n`))
        controller.close()
      } catch (err: unknown) {
        if (keepAliveInterval) clearInterval(keepAliveInterval)
        const errorMsg = err instanceof Error ? err.message : 'Unknown error'
        logger.error('code.exception', { ip, error: errorMsg })
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
