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
import { generateDesignTokens, DESIGN_TOKENS_INSTRUCTION } from '@/lib/design-tokens'
import { injectRuntimeErrorCapture } from '@/lib/runtime-errors'
import { checkPlanAdherence } from '@/lib/plan-adherence'
import { analyzeHtml } from '@/lib/static-analysis'
import { registerBuild, storeResult, storeError } from '@/lib/build-store'
import { recordSuccess, recordFailure } from '@/lib/model-circuit-breaker'
import { findTemplate, buildSeededPrompt } from '@/lib/golden-templates'
import { parseOutput } from '@/lib/multi-file'
import { isTokenRouterConfigured, tokenRouterStream } from '@/lib/tokenrouter'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 180 // generous — keepalive prevents proxy timeout

const CODER_PROMPT = `You are an expert front-end engineer. Output the complete HTML app.

OUTPUT FORMAT:
- Output ONLY raw HTML. No explanation, no markdown, no code fences.
- Complete document: <!DOCTYPE html>, <html lang="en">, <head>, <body>.
- All CSS in <style>, all JS in <script>. Everything inline. One file.
- Do NOT use localStorage, sessionStorage, or document.cookie. Use in-memory variables.
- No external resources (no fetch, no CDN scripts, no external fonts/images).

${DESIGN_TOKENS_INSTRUCTION}

PLAN:
- If a Plan is provided in the user message, follow it closely:
  implement every listed feature, use the suggested approach, apply the suggested
  colors, and structure the UI per the suggested layout.
- The plan was created by an architect — trust its feature list and key functions.

QUALITY:
- The app MUST work fully. Every button, input, interaction.
- Professional UI: use the design tokens, gradients, shadows, rounded corners, responsive layout.

GAME-SPECIFIC (if building a game):
- Use HTML5 Canvas for rendering (not DOM elements for game objects).
- Game loop with requestAnimationFrame (not setInterval for rendering).
- Implement: start screen, gameplay, game-over screen, restart button.
- Score display, lives/health, level progression if applicable.
- Keyboard controls (arrow keys, WASD, space) with preventDefault.
- Collision detection and response.
- Pause functionality (P key or button).
- Sound effects using Web Audio API (oscillator, no external files).

TOOL-SPECIFIC (if building a tool like calculator, converter, etc.):
- Clear input/output areas with proper labeling.
- Input validation with user-friendly error messages.
- Copy-to-clipboard functionality where appropriate.
- Keyboard support for all inputs.
- Reset/clear button.
- History of recent operations (in-memory).

APP-SPECIFIC (if building an app like todo, notes, etc.):
- CRUD operations: create, read, update, delete.
- Filter/search functionality.
- Empty state with helpful message.
- Responsive layout that works on mobile and desktop.
- Form validation with inline error messages.
- Confirmation dialogs for destructive actions.

ACCESSIBILITY (REQUIRED):
- Add lang="en" to the <html> tag.
- Use semantic HTML: <main>, <nav>, <header>, <section>, <article>, <footer>.
- Add aria-label to every <button>, <input>, and icon-only element.
- Ensure keyboard navigation: all interactive elements reachable via Tab.
- Use sufficient color contrast (minimum 4.5:1 for text).

PERFORMANCE & POLISH:
- Add CSS transitions on interactive elements (hover, focus, active states).
- Debounce scroll/resize event listeners (100ms).
- Use requestAnimationFrame for animations, not setInterval when possible.
- Add :focus-visible styles for keyboard users.
- Add hover effects on buttons and cards.

ERROR HANDLING:
- Wrap game/app logic in try-catch to prevent crashes.
- Handle edge cases: empty input, game-over state, division by zero.
- Validate user input before processing.
- If an error occurs, show a user-friendly message, don't let the app freeze.

OUTPUT LENGTH:
- For simple apps (calculator, timer): ~200-400 lines is fine.
- For medium apps (todo, editor): ~400-800 lines.
- For complex apps (games, music): ~800-2000 lines. Don't truncate — output the COMPLETE app.
- If you're running out of space, prioritize working core features over polish.

Keep it concise but complete. Output the HTML now:`

const codeLimiter = new RateLimiter(1000, 60 * 60 * 1000, 5 * 60 * 1000, 5000)
const MAX_BODY_BYTES = 200_000

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
  theme?: unknown
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
  const themeName = typeof body?.theme === 'string' ? body.theme : 'slate'

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

  // v10: Golden template seeding — find a matching template and use it as starting point
  const template = findTemplate(mission)
  if (template) {
    logger.info('code.template_seeded', { ip, template: template.id })
  }

  const planContext = plan
    ? `Plan:\n${JSON.stringify(plan, null, 2)}\n\nMission: ${mission}`
    : template
      ? buildSeededPrompt(mission, template)
      : `Mission: ${mission}`

  // Create SSE stream with keepalive
  const encoder = new TextEncoder()
  const startTime = Date.now()

  // v10: Generate build ID for polling fallback (SSE recovery)
  const buildId = `build_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
  registerBuild(buildId)

  const stream = new ReadableStream({
    async start(controller) {
      let keepAliveInterval: ReturnType<typeof setInterval> | null = null
      let stepIndex = 0
      let controllerClosed = false // Track closed state to avoid "Controller is already closed" errors

      // Safe enqueue — wraps in try-catch and tracks closed state.
      // The controller can be closed by the runtime when the client disconnects,
      // and enqueuing on a closed controller throws "Invalid state: Controller is already closed".
      const safeEnqueue = (data: string): boolean => {
        if (controllerClosed) return false
        try {
          controller.enqueue(encoder.encode(data))
          return true
        } catch {
          controllerClosed = true
          return false
        }
      }

      // Safe close — wraps in try-catch and tracks closed state.
      const safeClose = (): void => {
        if (controllerClosed) return
        controllerClosed = true
        try {
          controller.close()
        } catch {}
      }

      // v10: Send buildId to client immediately (for polling fallback)
      safeEnqueue(`data: ${JSON.stringify({ type: 'buildId', buildId })}\n\n`)

      // Send keepalive progress events every 3 seconds
      // This prevents proxy/browser timeout during long LLM calls
      keepAliveInterval = setInterval(() => {
        const elapsed = Math.floor((Date.now() - startTime) / 1000)
        const step = PROGRESS_STEPS[Math.min(stepIndex, PROGRESS_STEPS.length - 1)]
        if (!safeEnqueue(`data: ${JSON.stringify({ type: 'progress', step, elapsed })}\n\n`)) {
          // Stream closed by client — stop the keepalive
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
            if (!safeEnqueue(`data: ${JSON.stringify({ type: 'token', text: chunk.text, length: fullText.length })}\n\n`)) {
              // stream closed by client — break out of the token loop
              break
            }
          }
        }

        // Stop keepalive
        if (keepAliveInterval) clearInterval(keepAliveInterval)

        if (streamError) {
          logger.error('code.failed', { ip, error: streamError, ms: llmMs })
          safeEnqueue(`data: ${JSON.stringify({ type: 'error', error: streamError })}\n\n`)
          safeClose()
          return
        }

        let rawHtml = stripCodeFences(fullText)

        // Truncation detection + continuation retry
        if (rawHtml.length > 100 && !rawHtml.toLowerCase().includes('</html>')) {
          logger.warn('code.truncated', { ip, ms: llmMs, tokens: totalTokens, previewLen: rawHtml.length })
          // Send progress event
          safeEnqueue(`data: ${JSON.stringify({ type: 'progress', step: 'Completing truncated output...', elapsed: Math.floor((Date.now() - startTime) / 1000) })}\n\n`)

          const lastChars = rawHtml.slice(-1000)
          const retryResult = await llmChat(
            'You are continuing an interrupted HTML generation. Output ONLY the remaining HTML. Start exactly where the previous output stopped.',
            `The previous output was truncated. Last 1000 chars:\n\n${lastChars}\n\nContinue and complete with </html>.`,
            { maxTokens: 16000, temperature: 0.2, timeoutMs: 40_000, signal: request.signal }
          )
          if (retryResult.ok) {
            rawHtml = rawHtml + stripCodeFences(retryResult.text)
            logger.info('code.retry_completed', { ip, ms: retryResult.ms, tokens: retryResult.tokens, totalLen: rawHtml.length })
          }
        }

        if (!looksLikeHtml(rawHtml)) {
          logger.warn('code.invalid_html', { ip, ms: llmMs, tokens: totalTokens, previewLen: rawHtml.length })
          safeEnqueue(`data: ${JSON.stringify({ type: 'error', error: 'The AI generated invalid output. Try again or simplify your request.' })}\n\n`)
          safeClose()
          return
        }

        // ═══ POST-PROCESSING: Inject design tokens, CSP, and runtime error capture ═══
        // 1. Design tokens — CSS custom properties for consistent theming
        // 2. CSP — blocks external network requests
        // 3. Runtime error capture — injects script to catch JS errors via postMessage
        const designTokens = generateDesignTokens(themeName)
        let html = rawHtml
        // Inject design tokens right after <head>
        const headMatch = html.match(/<head[^>]*>/i)
        if (headMatch) {
          html = html.replace(/<head[^>]*>/i, `${headMatch[0]}\n${designTokens}`)
        }
        // Inject CSP (strips any existing CSP, adds NOVA's strict CSP)
        html = injectCsp(html)
        // Inject runtime error capture (before app's scripts)
        html = injectRuntimeErrorCapture(html)

        const totalMs = Date.now() - startTime

        // ═══ STATIC ANALYSIS — catch real bugs BEFORE the user sees them ═══
        // Runs in <1ms on the server. Catches:
        // - getElementById() referencing IDs that don't exist
        // - addEventListener() referencing undefined functions
        // - Function calls to undefined functions
        // - Variable assignments without declaration
        const staticAnalysis = analyzeHtml(html)
        if (staticAnalysis.issues.length > 0) {
          logger.warn('code.static_analysis', { ip, issues: staticAnalysis.issues.length, errors: staticAnalysis.issues.filter(i => i.severity === 'error').length })
        } else {
          logger.info('code.static_analysis_passed', { ip })
        }

        // ── INTELLIGENCE: Validate output quality ──
        const validation = validateOutput(html, mission)
        logger.info('code.validated', { ip, score: validation.score, passed: validation.passed, checks: validation.checks.length })

        // ── INTELLIGENCE: Plan adherence check ──
        const planAdherence = checkPlanAdherence(html, plan)
        if (!planAdherence.adherent) {
          logger.warn('code.plan_not_adherent', { ip, missing: planAdherence.missingFeatures.length, features: planAdherence.missingFeatures.slice(0, 3) })
        }

        // Combine ALL hints: static analysis + validation + plan adherence
        const staticHint = staticAnalysis.issues.length > 0
          ? `Static analysis found these bugs:\n${staticAnalysis.issues.map(i => `- [${i.severity}] ${i.message}\n  Fix: ${i.fixHint}`).join('\n')}`
          : null

        const combinedHint = [staticHint, validation.retryHint, planAdherence.hint].filter(Boolean).join('\n\n')

        // If ANY check found issues, try ONE retry with the combined hint
        if ((!staticAnalysis.passed || !validation.passed || !planAdherence.adherent) && combinedHint) {
          logger.warn('code.retry_needed', { ip, score: validation.score, staticIssues: staticAnalysis.issues.length, missingFeatures: planAdherence.missingFeatures.length, retrying: true })
          safeEnqueue(`data: ${JSON.stringify({ type: 'progress', step: 'Fixing bugs found by analysis...', elapsed: Math.floor((Date.now() - startTime) / 1000) })}\n\n`)

          const retryPrompt = `${planContext}\n\n${combinedHint}\n\nOutput the complete corrected HTML:`
          const retryResult = await llmChat(CODER_PROMPT, retryPrompt, {
            maxTokens: tokenBudget,
            temperature: 0.3,
            timeoutMs: 25_000,
            signal: request.signal,
          })

          if (retryResult.ok) {
            const retryHtmlRaw = stripCodeFences(retryResult.text)
            if (looksLikeHtml(retryHtmlRaw)) {
              // Apply the same post-processing to retry HTML
              let retryHtml = retryHtmlRaw
              const retryHeadMatch = retryHtml.match(/<head[^>]*>/i)
              if (retryHeadMatch) {
                retryHtml = retryHtml.replace(/<head[^>]*>/i, `${retryHeadMatch[0]}\n${designTokens}`)
              }
              retryHtml = injectCsp(retryHtml)
              retryHtml = injectRuntimeErrorCapture(retryHtml)

              const retryValidation = validateOutput(retryHtml, mission)
              logger.info('code.retry_validated', { ip, score: retryValidation.score, improved: retryValidation.score > validation.score })
              if (retryValidation.score > validation.score) {
                // Use the improved version
                const metrics = analyzeQuality(retryHtml)
                logger.info('code.completed', { ip, ms: Date.now() - startTime, tokens: totalTokens + retryResult.tokens, htmlBytes: retryHtml.length, score: retryValidation.score, metrics: metrics.summary })
                safeEnqueue(`data: ${JSON.stringify({ type: 'result', html: retryHtml, tokens: totalTokens + retryResult.tokens, ms: Date.now() - startTime, quality: retryValidation.score, metrics: metrics.summary })}\n\n`)
                safeClose()
                return
              }
            }
          }
          // Retry didn't help — use original
        }

        // ── INTELLIGENCE: Quality metrics ──
        const metrics = analyzeQuality(html)
        logger.info('code.completed', { ip, ms: totalMs, tokens: totalTokens, htmlBytes: html.length, score: validation.score, metrics: metrics.summary })
        recordSuccess('z-ai')

        // v10: Multi-file support — parse output for files array
        const multiFileResult = parseOutput(html)
        const resultData: Record<string, unknown> = {
          type: 'result', html, tokens: totalTokens, ms: totalMs, quality: validation.score, metrics: metrics.summary,
        }
        if (multiFileResult.files.length > 1 || multiFileResult.type !== 'html-app') {
          resultData.files = multiFileResult.files
          resultData.outputType = multiFileResult.type
          resultData.previewable = multiFileResult.previewable
        }

        // v10: Store result for polling fallback
        storeResult(buildId, { html, tokens: totalTokens, ms: totalMs, quality: validation.score, metrics: metrics.summary })

        // Send the final result with quality score and metrics
        safeEnqueue(`data: ${JSON.stringify(resultData)}\n\n`)
        safeClose()
      } catch (err: unknown) {
        if (keepAliveInterval) clearInterval(keepAliveInterval)
        const errorMsg = err instanceof Error ? err.message : 'Unknown error'
        // Don't log AbortError as an error — it's a normal cancellation (client disconnect or cancel)
        if (err instanceof DOMException && err.name === 'AbortError') {
          logger.info('code.aborted', { ip })
          storeError(buildId, 'Build was cancelled')
        } else {
          logger.error('code.exception', { ip, error: errorMsg })
          storeError(buildId, errorMsg)
          recordFailure('z-ai', errorMsg)
          // Only send error to client if it wasn't an abort (client may already be gone)
          safeEnqueue(`data: ${JSON.stringify({ type: 'error', error: errorMsg })}\n\n`)
        }
        safeClose()
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
