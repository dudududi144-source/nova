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
import { stripCodeFences, looksLikeHtml, injectCsp, stripBlockedAPIs } from '@/lib/html-utils'
import { fixConversionMath } from '@/lib/math-fixer'
import { fixForms } from '@/lib/form-fixer'
import { fixCss } from '@/lib/css-fixer'
// v29.65: Add Kimi fallback for refine
import { isTokenRouterConfigured, tokenRouterStream } from '@/lib/tokenrouter'
import { validateMission } from '@/lib/mission'
import { RateLimiter } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'
import { validateOutput, estimateTokenBudget, analyzeQuality } from '@/lib/build-intelligence'
import { generateDesignTokens } from '@/lib/design-tokens'
import { injectRuntimeErrorCapture } from '@/lib/runtime-errors'
import { analyzeHtml } from '@/lib/static-analysis'
import { registerBuild, storeResult, storeError } from '@/lib/build-store'
import { isDashScopeConfigured, dashscopeStream } from '@/lib/dashscope'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 180

const REFINE_PROMPT = `You are a senior front-end engineer refining an existing HTML app.

The user has an existing single-file HTML app. They want to change something.
You will receive: the original mission, the current HTML, and the user's request.

OUTPUT FORMAT:
- Output ONLY the complete updated raw HTML. No explanation, no markdown.
- Do NOT wrap the output in code fences. Output raw HTML directly.
- The HTML must remain a complete document: <!DOCTYPE html>, <html lang="en">, <head>, <body>.
- Keep all CSS in <style> tags and all JS in <script> tags — everything inline.
- Do NOT use localStorage, sessionStorage, or cookies. Use in-memory variables.
- No external resources (scripts, stylesheets, fonts, images, fetch).

REFINEMENT RULES:
- Apply the user's requested change to the existing HTML.
- Keep everything else the same — don't rewrite unrelated parts.
- If the change is ambiguous, make a reasonable interpretation and apply it.
- Preserve all existing functionality unless the user explicitly asks to remove it.
- Maintain accessibility: semantic HTML, aria-labels, keyboard nav, lang attribute.
- Maintain the dark theme unless the user specifies otherwise.
- Add CSS transitions on new interactive elements.
- Use :focus-visible styles for keyboard users.
- Wrap new logic in try-catch to prevent crashes.`

const refineLimiter = new RateLimiter(1000, 60 * 60 * 1000, 5 * 60 * 1000, 5000)
const MAX_BODY_BYTES = 200_000

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
  theme?: unknown  // v10 fix: accept theme from request
}

export async function POST(request: NextRequest): Promise<Response> {
  const contentLength = parseInt(request.headers.get('content-length') ?? '0', 10)
  if (contentLength > MAX_BODY_BYTES) {
    return Response.json({ ok: false, error: 'Request body too large (max 200KB)' }, { status: 413 })
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
  // v29.9: Allow non-HTML code too (Python, SQL, Bash, etc.) — not just HTML
  // if (!looksLikeHtml(html)) return Response.json({ ok: false, error: 'Invalid HTML' }, { status: 400 })

  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || request.headers.get('x-real-ip') || 'unknown'
  const rl = refineLimiter.check(ip)
  if (!rl.ok) {
    return Response.json({ ok: false, error: 'Rate limited' }, { status: 429 })
  }

  logger.info('refine.started', { ip, mission: mission.slice(0, 80), message: message.slice(0, 80) })

  // v29.9: Adapt prompt based on whether input is HTML or other code
  const isHtml = looksLikeHtml(html)
  const userPrompt = isHtml
    ? `Original mission: ${mission}\n\nCurrent HTML:\n${html}\n\nUser request: ${message}\n\nReturn the complete updated HTML.`
    : `Original mission: ${mission}\n\nCurrent code:\n${html}\n\nUser request: ${message}\n\nReturn the complete updated code.`

  const encoder = new TextEncoder()
  const startTime = Date.now()

  // v10: Generate build ID for polling fallback
  const buildId = `refine_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
  registerBuild(buildId)

  const stream = new ReadableStream({
    async start(controller) {
      let keepAliveInterval: ReturnType<typeof setInterval> | null = null
      let stepIndex = 0
      let controllerClosed = false

      // Safe enqueue/close — same pattern as code route. Prevents "Controller is already closed" errors.
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
      const safeClose = (): void => {
        if (controllerClosed) return
        controllerClosed = true
        if (keepAliveInterval) { clearInterval(keepAliveInterval); keepAliveInterval = null }
        try { controller.close() } catch {}
      }

      // v10: Send buildId to client for polling fallback
      safeEnqueue(`data: ${JSON.stringify({ type: 'buildId', buildId })}\n\n`)

      keepAliveInterval = setInterval(() => {
        const elapsed = Math.floor((Date.now() - startTime) / 1000)
        const step = REFINE_PROGRESS_STEPS[Math.min(stepIndex, REFINE_PROGRESS_STEPS.length - 1)]
        if (!safeEnqueue(`data: ${JSON.stringify({ type: 'progress', step, elapsed })}\n\n`)) {
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
          timeoutMs: 180_000,
          thinking: true, // v29.61: Enable deep reasoning for better refinements
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
              break
            }
          }
        }

        // v10.8: Qwen fallback for refine + keep keepalive running
        if (streamError && isDashScopeConfigured()) {
          logger.info('refine.fallback_qwen', { ip, reason: streamError })
          safeEnqueue(`data: ${JSON.stringify({ type: 'progress', step: 'Retrying with Qwen AI...', elapsed: Math.floor((Date.now() - startTime) / 1000) })}\n\n`)
          fullText = ''; totalTokens = 0; llmMs = 0; streamError = null
          for await (const chunk of dashscopeStream(REFINE_PROMPT, userPrompt, {
            maxTokens: tokenBudget, temperature: 0.3, timeoutMs: 180_000, signal: request.signal,
          })) {
            if (chunk.error) { streamError = chunk.error; break }
            if (chunk.done) { totalTokens = chunk.tokens; llmMs = chunk.ms; break }
            if (chunk.text) {
              fullText = chunk.fullText
              if (!safeEnqueue(`data: ${JSON.stringify({ type: 'token', text: chunk.text, length: fullText.length })}\n\n`)) break
            }
          }
        }

        // v29.65: Kimi (TokenRouter) fallback — if Qwen also failed
        if (streamError && isTokenRouterConfigured()) {
          logger.info('refine.fallback_kimi', { ip, reason: streamError })
          safeEnqueue(`data: ${JSON.stringify({ type: 'progress', step: 'Retrying with Kimi K3...', elapsed: Math.floor((Date.now() - startTime) / 1000) })}\n\n`)
          fullText = ''; totalTokens = 0; llmMs = 0; streamError = null
          for await (const chunk of tokenRouterStream(REFINE_PROMPT, userPrompt, {
            maxTokens: tokenBudget, temperature: 0.3, timeoutMs: 180_000, signal: request.signal,
          })) {
            if (chunk.error) { streamError = chunk.error; break }
            if (chunk.done) { totalTokens = chunk.tokens; llmMs = chunk.ms; break }
            if (chunk.text) {
              fullText = chunk.fullText
              if (!safeEnqueue(`data: ${JSON.stringify({ type: 'token', text: chunk.text, length: fullText.length })}\n\n`)) break
            }
          }
        }

        if (streamError) {
          logger.error('refine.failed', { ip, error: streamError, ms: llmMs })
          safeEnqueue(`data: ${JSON.stringify({ type: 'error', error: streamError })}\n\n`)
          safeClose()
          return
        }

        let rawHtml = stripCodeFences(fullText)

        // v29.9: Handle non-HTML output (Python, SQL, Bash, etc.) — check FIRST,
        // before the truncation-retry, so we don't append HTML to non-HTML code.
        if (!looksLikeHtml(rawHtml)) {
          // Non-HTML output — return it as-is with language detection
          logger.info('refine.non_html_output', { ip, ms: llmMs, tokens: totalTokens, outputLen: rawHtml.length })
          const totalMs = Date.now() - startTime
          const metrics = `${rawHtml.split('\n').length} lines`

          // Detect language from content
          const { detectLanguageFromContent, defaultFileNameForLanguage } = await import('@/lib/multi-file')
          const language = detectLanguageFromContent(rawHtml)
          const fileName = defaultFileNameForLanguage(language)

          const resultData = {
            type: 'result',
            html: rawHtml,
            tokens: totalTokens,
            ms: totalMs,
            quality: 100,
            metrics,
            outputType: language === 'python' ? 'python' : language === 'javascript' || language === 'typescript' ? 'node' : 'code',
            previewable: false,
            language,
            fileName,
          }

          storeResult(buildId, {
            html: rawHtml, tokens: totalTokens, ms: totalMs, quality: 100, metrics,
            outputType: resultData.outputType, previewable: false,
          })
          safeEnqueue(`data: ${JSON.stringify(resultData)}\n\n`)
          await new Promise(r => setTimeout(r, 200))
          safeClose()
          return
        }

        // Truncation detection + continuation retry (only for HTML output)
        if (rawHtml.length > 100 && !rawHtml.toLowerCase().includes('</html>')) {
          logger.warn('refine.truncated', { ip, ms: llmMs, tokens: totalTokens, previewLen: rawHtml.length })
          safeEnqueue(`data: ${JSON.stringify({ type: 'progress', step: 'Completing truncated output...', elapsed: Math.floor((Date.now() - startTime) / 1000) })}\n\n`)

          const lastChars = rawHtml.slice(-1000)
          const retryResult = await llmChat(
            'You are continuing an interrupted HTML generation. Output ONLY the remaining HTML. Start exactly where the previous output stopped.',
            `The previous output was truncated. Last 1000 chars:\n\n${lastChars}\n\nContinue and complete with </html>.`,
            { maxTokens: tokenBudget, temperature: 0.2, timeoutMs: 60_000, thinking: true, signal: request.signal }
          )
          if (retryResult.ok) {
            rawHtml = rawHtml + stripCodeFences(retryResult.text)
            logger.info('refine.retry_completed', { ip, ms: retryResult.ms, tokens: retryResult.tokens, totalLen: rawHtml.length })
          }
        }

        // ═══ POST-PROCESSING: Inject design tokens, CSP, and runtime error capture (same as code route) ═══
        // v10 fix: use theme from request (was hardcoded 'slate')
        const VALID_THEMES = new Set(['slate', 'midnight', 'ocean', 'forest', 'sunset', 'amber', 'rose', 'violet', 'emerald', 'cyan'])
        const themeName = typeof body?.theme === 'string' && VALID_THEMES.has(body.theme) ? body.theme : 'slate'
        const designTokens = generateDesignTokens(themeName)
        let finalHtml = rawHtml
        const headMatch = finalHtml.match(/<head[^>]*>/i)
        if (headMatch) {
          finalHtml = finalHtml.replace(/<head[^>]*>/i, `${headMatch[0]}\n${designTokens}`)
        }
        finalHtml = injectCsp(finalHtml)
        // v26: Inject polyfill for blocked APIs
        finalHtml = stripBlockedAPIs(finalHtml)
        // v27: Fix common math errors
        finalHtml = fixConversionMath(finalHtml)
        // v27: Fix form submit handlers
        finalHtml = fixForms(finalHtml)
        // v27: Fix CSS issues (modal, search, button overlays)
        finalHtml = fixCss(finalHtml)
        finalHtml = injectRuntimeErrorCapture(finalHtml)
        const totalMs = Date.now() - startTime

        // ═══ STATIC ANALYSIS — same as code route, catch bugs before user sees them ═══
        // v29.53-v29.54: Strip the polyfill block before analysis (same as code route)
        const polyfillPattern = /<script[^>]*>\s*\/\/\s*v\d+:?\s*In-memory polyfill for localStorage[\s\S]*?<\/script>/gi
        const htmlForAnalysis = finalHtml.replace(polyfillPattern, '')
        const staticAnalysis = analyzeHtml(htmlForAnalysis)
        if (staticAnalysis.issues.length > 0) {
          logger.warn('refine.static_analysis', { ip, issues: staticAnalysis.issues.length, errors: staticAnalysis.issues.filter(i => i.severity === 'error').length })
        }

        // ── INTELLIGENCE: Validate refined output ──
        const validation = validateOutput(finalHtml, mission)
        logger.info('refine.validated', { ip, score: validation.score, passed: validation.passed })

        // Combine static analysis + validation hints
        const staticHint = staticAnalysis.issues.length > 0
          ? `Static analysis found these bugs:\n${staticAnalysis.issues.map(i => `- [${i.severity}] ${i.message}\n  Fix: ${i.fixHint}`).join('\n')}`
          : null
        const combinedHint = [staticHint, validation.retryHint].filter(Boolean).join('\n\n')

        // If static analysis or validation found issues, retry with combined hint
        if ((!staticAnalysis.passed || !validation.passed) && combinedHint) {
          logger.warn('refine.retry_needed', { ip, score: validation.score, staticIssues: staticAnalysis.issues.length, retrying: true })
          safeEnqueue(`data: ${JSON.stringify({ type: 'progress', step: 'Fixing bugs found by analysis...', elapsed: Math.floor((Date.now() - startTime) / 1000) })}\n\n`)

          const retryPrompt = `${userPrompt}\n\n${combinedHint}\n\nOutput the complete corrected HTML:`
          const retryResult = await llmChat(REFINE_PROMPT, retryPrompt, {
            maxTokens: tokenBudget,
            temperature: 0.3,
            timeoutMs: 25_000,
            signal: request.signal,
          })

          if (retryResult.ok) {
            const retryHtml = stripCodeFences(retryResult.text)
            if (looksLikeHtml(retryHtml)) {
              // Apply same post-processing to retry HTML (must match the main path)
              let processedRetryHtml = retryHtml

              // v29.67: Check for unclosed <script> tags (same as code route)
              {
                const ro = (processedRetryHtml.match(/<script/gi) || []).length
                const rc = (processedRetryHtml.match(/<\/script>/gi) || []).length
                if (ro > rc) {
                  const ct = '</script>\n'
                  if (processedRetryHtml.toLowerCase().includes('</body>')) {
                    processedRetryHtml = processedRetryHtml.replace(/<\/body>/i, `${ct}</body>`)
                  } else if (processedRetryHtml.toLowerCase().includes('</html>')) {
                    processedRetryHtml = processedRetryHtml.replace(/<\/html>/i, `${ct}</html>`)
                  } else {
                    processedRetryHtml = processedRetryHtml + ct + '</body>\n</html>'
                  }
                }
              }

              const retryHeadMatch = processedRetryHtml.match(/<head[^>]*>/i)
              if (retryHeadMatch) {
                processedRetryHtml = processedRetryHtml.replace(/<head[^>]*>/i, `${retryHeadMatch[0]}\n${designTokens}`)
              }
              processedRetryHtml = injectCsp(processedRetryHtml)
              // v29.43: Apply ALL post-processing fixers to retry HTML (was missing 4 fixers)
              processedRetryHtml = stripBlockedAPIs(processedRetryHtml)
              processedRetryHtml = fixConversionMath(processedRetryHtml)
              processedRetryHtml = fixForms(processedRetryHtml)
              processedRetryHtml = fixCss(processedRetryHtml)
              processedRetryHtml = injectRuntimeErrorCapture(processedRetryHtml)

              const retryValidation = validateOutput(processedRetryHtml, mission)
              logger.info('refine.retry_validated', { ip, score: retryValidation.score, improved: retryValidation.score > validation.score })
              if (retryValidation.score > validation.score) {
                // Use the improved version
                const metrics = analyzeQuality(processedRetryHtml)
                logger.info('refine.completed', { ip, ms: Date.now() - startTime, tokens: totalTokens + retryResult.tokens, htmlBytes: processedRetryHtml.length, score: retryValidation.score, metrics: metrics.summary })
                safeEnqueue(`data: ${JSON.stringify({ type: 'result', html: processedRetryHtml, tokens: totalTokens + retryResult.tokens, ms: Date.now() - startTime, quality: retryValidation.score, metrics: metrics.summary })}\n\n`)
                safeClose()
                return
              }
            }
          }
          // Retry didn't help — use original
        }

        // ── INTELLIGENCE: Quality metrics ──
        const metrics = analyzeQuality(finalHtml)
        logger.info('refine.completed', { ip, ms: totalMs, tokens: totalTokens, htmlBytes: finalHtml.length, score: validation.score, metrics: metrics.summary })

        // v10: Store result for polling fallback
        storeResult(buildId, { html: finalHtml, tokens: totalTokens, ms: totalMs, quality: validation.score, metrics: metrics.summary })

        safeEnqueue(`data: ${JSON.stringify({ type: 'result', html: finalHtml, tokens: totalTokens, ms: totalMs, quality: validation.score, metrics: metrics.summary })}\n\n`)
        safeClose()
      } catch (err: unknown) {
        if (keepAliveInterval) clearInterval(keepAliveInterval)
        const errorMsg = err instanceof Error ? err.message : 'Unknown error'
        if (err instanceof DOMException && err.name === 'AbortError') {
          logger.info('refine.aborted', { ip })
          storeError(buildId, 'Refine was cancelled')
        } else {
          logger.error('refine.exception', { ip, error: errorMsg })
          storeError(buildId, errorMsg)
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
