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
import { llmChat, stripCodeFences, looksLikeHtml, injectCsp } from '@/lib/llm'
import { RateLimiter } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 180 // generous — keepalive prevents proxy timeout

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
          // stream closed
        }
        // Advance step every 8 seconds
        if (elapsed > (stepIndex + 1) * 8) {
          stepIndex++
        }
      }, 3000)

      try {
        // Call LLM — no arbitrary token limit, let it finish naturally
        // High maxTokens (32000) but LLM stops when it's done
        const result = await llmChat(CODER_PROMPT, planContext, {
          maxTokens: 32000,
          temperature: 0.4,
          timeoutMs: 150_000, // 2.5 min — generous, keepalive prevents timeout
          signal: request.signal,
        })

        // Stop keepalive
        if (keepAliveInterval) clearInterval(keepAliveInterval)

        if (!result.ok) {
          logger.error('code.failed', { ip, error: result.error, ms: result.ms })
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'error', error: result.error ?? 'Coder failed' })}\n\n`))
          controller.close()
          return
        }

        let rawHtml = stripCodeFences(result.text)

        // Truncation detection + continuation retry
        if (rawHtml.length > 100 && !rawHtml.toLowerCase().includes('</html>')) {
          logger.warn('code.truncated', { ip, ms: result.ms, tokens: result.tokens, previewLen: rawHtml.length })
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
          logger.warn('code.invalid_html', { ip, ms: result.ms, tokens: result.tokens, previewLen: rawHtml.length })
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'error', error: 'The AI generated invalid output. Try again or simplify your request.' })}\n\n`))
          controller.close()
          return
        }

        const html = injectCsp(rawHtml)
        const totalMs = Date.now() - startTime
        logger.info('code.completed', { ip, ms: totalMs, tokens: result.tokens, htmlBytes: html.length })

        // Send the final result
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'result', html, tokens: result.tokens, ms: totalMs })}\n\n`))
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
    },
  })
}
