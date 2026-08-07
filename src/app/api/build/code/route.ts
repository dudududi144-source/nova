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
import { stripCodeFences, looksLikeHtml, injectCsp, stripBlockedAPIs } from '@/lib/html-utils'
import { fixConversionMath } from '@/lib/math-fixer'
import { fixForms } from '@/lib/form-fixer'
import { fixCss } from '@/lib/css-fixer'
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
import { parseOutput, detectLanguageFromContent, defaultFileNameForLanguage } from '@/lib/multi-file'
import { isTokenRouterConfigured, tokenRouterStream } from '@/lib/tokenrouter'
import { isDashScopeConfigured, dashscopeStream } from '@/lib/dashscope'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 180 // generous — keepalive prevents proxy timeout

// v28: Dynamic prompt — adapts to what the user asks for.
// If they ask for an HTML app → HTML rules.
// If they ask for Python/Node/SQL/config → generic code rules.
// No more forcing everything into HTML.

function isWebAppRequest(mission: string): boolean {
  const lower = mission.toLowerCase()
  // Check if the request is for a web app / interactive UI
  const webAppKeywords = ['app', 'dashboard', 'game', 'tool', 'calculator', 'todo', 'editor',
    'timer', 'counter', 'player', 'converter', 'board', 'canvas', 'widget', 'visualizer',
    'tracker', 'planner', 'calendar', 'weather', 'music', 'drawing', 'snake', 'tetris',
    'puzzle', 'quiz', 'stopwatch', 'pomodoro', 'palette', 'markdown']
  const nonWebKeywords = ['python', 'script', 'api', 'server', 'sql', 'query', 'database',
    'config', 'yaml', 'json', 'docker', 'nginx', 'ansible', 'terraform', 'bash', 'shell',
    'rust', 'go ', 'java ', 'c++', 'c#', 'ruby', 'php', 'swift', 'kotlin', 'dart',
    '.py', '.js', '.ts', '.go', '.rs', '.java', '.rb', '.php', '.sh', '.sql',
    'algorithm', 'data structure', 'leetcode', 'code challenge', 'function that',
    'write a script', 'write a program', 'write a function', 'write a class',
    'command line', 'cli tool', 'backend', 'endpoint', 'rest api', 'graphql']

  // If explicitly non-web, return false
  if (nonWebKeywords.some(kw => lower.includes(kw))) return false
  // If explicitly web, return true
  if (webAppKeywords.some(kw => lower.includes(kw))) return true
  // Default: assume web app (most common use case)
  return true
}

function buildPrompt(mission: string): string {
  const isWebApp = isWebAppRequest(mission)

  if (isWebApp) {
    // HTML app prompt (with all the rules that make web apps work)
    return `You are an elite software engineer and UI/UX designer. You build complete, production-quality web applications from a single prompt.

OUTPUT: A single complete HTML file. All CSS and JS inline. No external resources. No localStorage — use in-memory state.

${DESIGN_TOKENS_INSTRUCTION}

You have full creative freedom. Analyze what the user wants and build it the best way you know how. Choose your own architecture, design, and implementation strategy. There are no fixed patterns — adapt to each request uniquely.

CRITICAL RULES (follow strictly — these are the most common bugs):
1. EVERY function referenced in HTML onclick/event listeners MUST be defined in <script>.
   - If you write onclick="addTask()", you MUST define function addTask() in the script.
   - If you write addEventListener('click', handleX), you MUST define handleX.
   - Before outputting, scan all event handlers and verify each function exists.
2. Define ALL functions BEFORE they are called. JavaScript hoists function declarations, but not arrow functions assigned to const.
3. Every button must DO something visible when clicked — change text, add element, update counter, toggle class.
4. Do NOT use prompt() or confirm() — they are blocked in the sandbox. Use inline input fields and modals instead.
5. Do NOT use localStorage — it is blocked. Use in-memory variables only.
6. If you show an instructions/help overlay, it MUST have a close button that hides it. Do NOT cover interactive elements with static text overlays.
7. FORMS: If you use a <form> element, you MUST call event.preventDefault() in the submit handler. Without this, the form tries to navigate away and the app breaks. Example:
   form.addEventListener('submit', function(e) { e.preventDefault(); addTask(); });
   OR use <button type="button"> instead of submit, and handle click with onclick.
8. INPUTS: When reading input values, use .value and .trim(). If empty, show a visual error (red border) instead of alert.
9. LISTS: When adding items to a list, create DOM elements with document.createElement, set their textContent, and append to the list container. Do NOT use innerHTML += (it breaks event listeners). Each list item MUST have class="task-item" or class="note-item" or data-task attribute so it can be found by search/filter.
10. EVENT BINDING: When using addEventListener, you MUST bind EVERY interactive element. If you have buttons 0-9, you MUST add listeners for ALL 10, not just some. Use a loop: document.querySelectorAll('[data-number]').forEach(btn => btn.addEventListener('click', () => appendNumber(btn.textContent))). Never skip elements.
11. INIT: Call your init() function AFTER the DOM is ready. Use: document.addEventListener('DOMContentLoaded', init) OR place the <script> at the END of <body> (after all HTML elements). If init() runs before elements exist, all getElementById calls return null and nothing works.
12. MATH: Double-check all conversion formulas and calculations. For example: meters to km = divide by 1000, NOT multiply. Celsius to Fahrenheit = (C * 9/5) + 32. Test your math mentally before outputting.
13. MODALS: When a modal is open, the user MUST be able to close it via: (a) a visible X button, (b) clicking the backdrop, (c) pressing Escape. After closing, the modal must be hidden (display:none) and NOT block clicks on the page below.
14. SEARCH: When implementing search/filter, you MUST update the displayed results when the user types. Use input event (not just change). Filter the DOM elements — show/hide based on match, do NOT just log to console.

QUALITY RULES:
- Build something impressive but CONCISE — aim for 500-1000 lines, not 2000+.
- Use semantic HTML: <main>, <nav>, <header>, <section>, <article>.
- Add aria-labels to all interactive elements for accessibility.
- Use CSS variables from the design tokens above — never hardcode hex colors.
- Add smooth transitions on interactive elements.
- Wrap ALL event handlers in try-catch to prevent crashes.

DESIGN EXCELLENCE (this separates good from great):
- Use a cohesive color palette — pick 3-4 colors that work together, not random colors.
- Typography matters: use font-size hierarchy (32px > 24px > 18px > 14px > 12px).
- Add visual depth: use box-shadows (subtle, not harsh), border-radius (8-16px), and spacing.
- Use CSS Grid or Flexbox for layout — never use float or position:absolute for main layout.
- Add micro-interactions: hover effects (scale 1.05, brightness), active states (scale 0.98).
- Empty states: when a list is empty, show a helpful message with an icon, not just blank space.
- Loading states: when doing async work, show a spinner or progress indicator.
- Color coding: use green for success, red for errors, amber for warnings — consistently.
- Icons: use emoji or inline SVG for visual cues — they make the app feel polished.
- Responsive: the app MUST work on both desktop (1200px) and mobile (375px) widths.

EFFICIENCY: Be concise. Avoid redundant code. One function per responsibility. Don't over-engineer.

VERIFICATION: Before outputting, mentally trace through each button click and verify:
- The function exists
- The function changes something visible
- No undefined variables are referenced
- Math calculations are correct
- Modals can be closed
- Search filters actually filter

If a plan is provided, use it as inspiration, not a constraint.

Output the HTML now:`
  } else {
    // Generic code prompt — for Python, Node, SQL, config, scripts, etc.
    return `You are an elite software engineer. You write complete, production-quality code from a single prompt.

OUTPUT FORMAT:
- Output the code directly. No explanations, no markdown wrapping unless needed for multi-file.
- If the request is for a single file, output just the code.
- If the request is for multiple files, use this format:
  \`\`\`file:path/to/file.ext
  file content here
  \`\`\`
  Repeat for each file.
- If the request is for a web app that needs HTML, output a complete HTML file.

CRITICAL — CODE MUST BE IMMEDIATELY RUNNABLE:
- The user will click a "Run" button to execute your code in a sandbox.
- The code MUST produce visible output when run (print to stdout).
- The code MUST complete within 30 seconds — NO infinite loops, NO long sleeps, NO monitoring loops.
- For Python: include a \`if __name__ == "__main__":\` block that runs demo/test cases.
- For Node.js: include demo calls at the end that console.log results.
- For Bash: include echo statements showing what the script does. Run ONCE and exit.
- For monitoring scripts (disk usage, log watcher, etc.): do ONE check and print the result. Do NOT loop.
- Include at least 3-5 test cases that demonstrate the code works correctly.
- Example: if writing a prime checker, test with known primes (2, 3, 5, 7, 11) and composites (4, 6, 8, 9, 10).
- The sandbox has NO network access — don't call external APIs or pip install.
- The sandbox supports stdin — you can use input() for interactive programs, but also include hardcoded test cases.
- The sandbox has NO mail/cron/systemd — don't use system services.
- Execution timeout is 30 seconds — keep algorithms efficient.

QUALITY RULES:
- Write clean, idiomatic code following best practices for the language.
- Add comments for complex logic.
- Handle errors gracefully — wrap risky operations in try-catch (or language equivalent).
- Include input validation.
- Make the code complete and runnable — no placeholders, no TODOs, no "implement here".
- If writing a script, include a main entry point.
- If writing an API, include error responses.
- If writing a query, make it optimized and safe (parameterized).

LANGUAGE-SPECIFIC:
- Python: Use type hints, docstrings, follow PEP 8. Include a main() function with test cases.
- Node.js: Use modern ES modules or CommonJS appropriately. Include demo output at the end.
- SQL: Use proper indexing, parameterized queries, CTEs for readability. Include sample SELECT statements.
- Bash: Use set -e, proper quoting, error handling. Echo what the script is doing.
- Config files: Use proper syntax, add comments explaining each option.

VERIFICATION: Before outputting, mentally trace through the code and verify:
- All variables are defined before use
- All functions are called with correct arguments
- Error handling covers edge cases
- The code is complete and runnable
- Running the code will produce visible output (stdout)
- Test cases demonstrate the code works correctly

If a plan is provided, use it as inspiration, not a constraint.

Output the code now:`
  }
}

const codeLimiter = new RateLimiter(1000, 60 * 60 * 1000, 5 * 60 * 1000, 5000)
const MAX_BODY_BYTES = 500_000

const PROGRESS_STEPS = [
  'Analyzing request...',
  'Designing architecture...',
  'Building the application...',
  'Adding polish...',
  'Finalizing...',
]

interface CodeBody {
  mission?: unknown
  plan?: unknown
  theme?: unknown
  model?: unknown  // 'z-ai' (default), 'kimi', or 'qwen'
  quickMode?: unknown  // v15: reduced token budget for faster builds
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

  // v10.2: No templates — LLM builds everything from scratch, freely
  const planContext = plan
    ? `Plan:\n${JSON.stringify(plan, null, 2)}\n\nMission: ${mission}`
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

      // Safe close — wraps in try-catch, tracks closed state, and stops keepalive.
      const safeClose = (): void => {
        if (controllerClosed) return
        controllerClosed = true
        // v10.6: Stop keepalive when closing — ensures no orphan intervals
        if (keepAliveInterval) { clearInterval(keepAliveInterval); keepAliveInterval = null }
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

      // v29.43: Declare model flags before try block so they're accessible in catch
      // for correct circuit-breaker recording.
      const useKimi = body?.model === 'kimi' && isTokenRouterConfigured()
      const useQwen = body?.model === 'qwen' && isDashScopeConfigured()

      try {
        // Adaptive token budget
        // v29.61: Quick mode no longer reduces budget — all builds get full capacity.
        // Quick mode only skips the retry step (saves time, not quality).
        const isQuickMode = body?.quickMode === true
        const tokenBudget = estimateTokenBudget(plan)
        logger.info('code.budget', { ip, maxTokens: tokenBudget, hasPlan: !!plan, quickMode: isQuickMode })

        // ═══ REAL STREAMING ═══
        // Stream tokens from LLM → client in real-time via SSE
        // User sees HTML appearing character by character
        let fullText = ''
        let totalTokens = 0
        let llmMs = 0
        let streamError: string | null = null

        logger.info('code.model', { ip, model: useQwen ? 'qwen' : useKimi ? 'kimi' : 'z-ai', tokenBudget })

        const streamGenerator = useQwen
          ? dashscopeStream(buildPrompt(mission), planContext, {
              maxTokens: tokenBudget,
              temperature: 0.4,
              timeoutMs: 150_000,
              signal: request.signal,
            })
          : useKimi
            ? tokenRouterStream(buildPrompt(mission), planContext, {
                maxTokens: tokenBudget,
                temperature: 0.4,
                timeoutMs: 150_000,
                signal: request.signal,
              })
            : llmChatStream(buildPrompt(mission), planContext, {
                maxTokens: tokenBudget,
                temperature: 0.4,
                timeoutMs: 180_000,
                thinking: true, // v29.61: Enable deep reasoning for better code
                signal: request.signal,
              })

        for await (const chunk of streamGenerator) {
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

        // v10.6: DON'T stop keepalive yet — post-processing takes time (retry, analysis, validation)
        // The keepalive continues sending progress events so the client knows we're still alive.
        // It will be stopped after the result/error is sent.

        // v10.7: Automatic fallback chain: Z.AI → Qwen → Kimi
        // v17: Extended to 3-model chain for maximum reliability
        if (streamError && !useKimi && !useQwen && isDashScopeConfigured()) {
          logger.info('code.fallback_qwen', { ip, reason: streamError })
          safeEnqueue(`data: ${JSON.stringify({ type: 'progress', step: 'Retrying with Qwen AI...', elapsed: Math.floor((Date.now() - startTime) / 1000) })}\n\n`)

          // Reset state for retry
          fullText = ''
          totalTokens = 0
          llmMs = 0
          streamError = null

          for await (const chunk of dashscopeStream(buildPrompt(mission), planContext, {
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
            if (chunk.text) {
              fullText = chunk.fullText
              if (!safeEnqueue(`data: ${JSON.stringify({ type: 'token', text: chunk.text, length: fullText.length })}\n\n`)) {
                break
              }
            }
          }

          if (!streamError && fullText.trim()) {
            logger.info('code.fallback_qwen_success', { ip, tokens: totalTokens })
          }
        }

        // v17: Final fallback to Kimi K3 if Qwen also failed
        if (streamError && !useKimi && !fullText.trim() && isTokenRouterConfigured()) {
          logger.info('code.fallback_kimi', { ip, reason: streamError })
          safeEnqueue(`data: ${JSON.stringify({ type: 'progress', step: 'Retrying with Kimi K3 (reasoning model)...', elapsed: Math.floor((Date.now() - startTime) / 1000) })}\n\n`)

          // Reset state for retry
          fullText = ''
          totalTokens = 0
          llmMs = 0
          streamError = null

          for await (const chunk of tokenRouterStream(buildPrompt(mission), planContext, {
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
            if (chunk.text) {
              fullText = chunk.fullText
              if (!safeEnqueue(`data: ${JSON.stringify({ type: 'token', text: chunk.text, length: fullText.length })}\n\n`)) {
                break
              }
            }
          }

          if (!streamError && fullText.trim()) {
            logger.info('code.fallback_kimi_success', { ip, tokens: totalTokens })
          }
        }

        if (streamError) {
          logger.error('code.failed', { ip, error: streamError, ms: llmMs })
          safeEnqueue(`data: ${JSON.stringify({ type: 'error', error: streamError })}\n\n`)
          safeClose()
          return
        }

        let rawHtml = stripCodeFences(fullText)

        // v28: Check if this is HTML or other code type
        const isHtmlOutput = looksLikeHtml(rawHtml)

        if (!isHtmlOutput) {
          // v28: Non-HTML output (Python, Node, SQL, config, etc.)
          // v29: Use content-based language detection (more accurate than mission keywords)
          logger.info('code.non_html_output', { ip, ms: llmMs, tokens: totalTokens, outputLen: rawHtml.length })

          const language = detectLanguageFromContent(rawHtml)
          const fileName = defaultFileNameForLanguage(language)

          const totalMs = Date.now() - startTime
          const metrics = { summary: `${rawHtml.split('\n').length} lines · ${language}` }
          logger.info('code.completed', { ip, ms: totalMs, tokens: totalTokens, htmlBytes: rawHtml.length, score: 100, metrics: metrics.summary, language, fileName })

          const multiFileResult = parseOutput(rawHtml)
          let finalFiles = multiFileResult.files
          if (finalFiles.length === 1 && finalFiles[0] && finalFiles[0]!.path === 'output.txt') {
            finalFiles = [{ path: fileName, content: rawHtml, language }]
          }

          const resultData: Record<string, unknown> = {
            type: 'result',
            html: rawHtml,
            tokens: totalTokens,
            ms: totalMs,
            quality: 100,
            metrics: metrics.summary,
            outputType: multiFileResult.type === 'code'
              ? (language === 'python' ? 'python' : language === 'javascript' || language === 'typescript' ? 'node' : 'code')
              : multiFileResult.type,
            previewable: false,
            language,
            fileName,
          }
          if (finalFiles.length > 0) {
            resultData.files = finalFiles
          }

          storeResult(buildId, {
            html: rawHtml, tokens: totalTokens, ms: totalMs, quality: 100, metrics: metrics.summary,
            files: finalFiles,
            outputType: multiFileResult.type === 'code'
              ? (language === 'python' ? 'python' : language === 'javascript' || language === 'typescript' ? 'node' : 'code')
              : multiFileResult.type,
            previewable: false,
          })
          safeEnqueue(`data: ${JSON.stringify(resultData)}\n\n`)
          // v28: Wait a bit before closing to ensure client receives the result
          await new Promise(r => setTimeout(r, 200))
          safeClose()
          return
        }

        // Truncation detection + continuation retry (only for HTML)
        // v29.23: Skip truncation retry — it causes a second LLM call that doubles memory
        // and crashes the server. Accept truncated output instead.
        if (rawHtml.length > 100 && !rawHtml.toLowerCase().includes('</html>')) {
          logger.warn('code.truncated', { ip, ms: llmMs, tokens: totalTokens, previewLen: rawHtml.length })
          // v29.23: Don't retry — just close the HTML manually to make it valid
          rawHtml = rawHtml + '\n</body>\n</html>'
          logger.info('code.truncated_fixed', { ip, totalLen: rawHtml.length })
        }

        // v29.54: Check for unclosed <script> tags — the LLM can truncate
        // mid-function, leaving a <script> without a matching </script>.
        // This causes the static analysis to fail extracting the script
        // content, and the browser can't parse the HTML correctly.
        {
          const scriptOpens = (rawHtml.match(/<script/gi) || []).length
          const scriptCloses = (rawHtml.match(/<\/script>/gi) || []).length
          if (scriptOpens > scriptCloses) {
            logger.warn('code.unclosed_script', { ip, opens: scriptOpens, closes: scriptCloses })
            // Close the unclosed script tag before </body> or </html>
            const closeTag = '</script>\n'
            if (rawHtml.toLowerCase().includes('</body>')) {
              rawHtml = rawHtml.replace(/<\/body>/i, `${closeTag}</body>`)
            } else if (rawHtml.toLowerCase().includes('</html>')) {
              rawHtml = rawHtml.replace(/<\/html>/i, `${closeTag}</html>`)
            } else {
              rawHtml = rawHtml + closeTag + '</body>\n</html>'
            }
            logger.info('code.unclosed_script_fixed', { ip })
          }
        }

        // v28: looksLikeHtml already checked above — if we're here, it's HTML
        // (non-HTML outputs were handled and returned earlier)

        // v10.6: Send progress events for post-processing stages
        safeEnqueue(`data: ${JSON.stringify({ type: 'progress', step: 'Analyzing code...', elapsed: Math.floor((Date.now() - startTime) / 1000) })}\n\n`)

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
        // v26: Inject localStorage/sessionStorage polyfill (LLM uses them despite instructions)
        html = stripBlockedAPIs(html)
        // v27: Fix common math errors (e.g. meter→km multiply instead of divide)
        html = fixConversionMath(html)
        // v27: Fix form submit handlers (inject preventDefault + handler)
        html = fixForms(html)
        // v27: Fix CSS issues (modal positioning, search handlers, button overlays)
        html = fixCss(html)
        // Inject runtime error capture (before app's scripts)
        html = injectRuntimeErrorCapture(html)

        const totalMs = Date.now() - startTime

        // ═══ STATIC ANALYSIS — catch real bugs BEFORE the user sees them ═══
        // Runs in <1ms on the server. Catches:
        // - getElementById() referencing IDs that don't exist
        // - addEventListener() referencing undefined functions
        // - Function calls to undefined functions
        // - Variable assignments without declaration
        // v29.53: Strip the polyfill block before analysis — the polyfill's
        // comment ("for localStorage (") and getter ("get length() {")
        // trigger false positives in the undefined-function check.
        // v29.54: Include the <script> opening tag in the pattern to prevent
        // leaving an orphaned <script> that captures <style> content.
        const polyfillPattern = /<script[^>]*>\s*\/\/\s*v\d+:?\s*In-memory polyfill for localStorage[\s\S]*?<\/script>/gi
        const htmlForAnalysis = html.replace(polyfillPattern, '')
        const staticAnalysis = analyzeHtml(htmlForAnalysis)
        if (staticAnalysis.issues.length > 0) {
          logger.warn('code.static_analysis', { ip, issues: staticAnalysis.issues.length, errors: staticAnalysis.issues.filter(i => i.severity === 'error').length })
        } else {
          logger.info('code.static_analysis_passed', { ip })
        }

        // v10.6: Progress for validation stage
        safeEnqueue(`data: ${JSON.stringify({ type: 'progress', step: 'Validating quality...', elapsed: Math.floor((Date.now() - startTime) / 1000) })}\n\n`)

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

        // If ANY check found issues, try ONE retry with the combined hint.
        // v14 ROAST FIX: Skip retry if the build already took too long (>120s) —
        // retry adds 25s+ and rarely improves quality. Better to ship what we have.
        // v15: Also skip retry in Quick mode — Quick mode prioritizes speed over perfection.
        // v29.40: Retry only if score is very low (<50) and build was fast (<60s)
        // v29.23: Was disabled entirely — but some builds genuinely need retry
        const elapsedSoFar = Date.now() - startTime
        // v29.61: Allow retry regardless of time — quality is more important than speed
        // Was limited to 60s for the 4GB server, now uses full capacity
        const shouldRetry = (!staticAnalysis.passed || validation.score < 85) && combinedHint
        if (shouldRetry) {
          logger.warn('code.retry_needed', { ip, score: validation.score, staticIssues: staticAnalysis.issues.length, missingFeatures: planAdherence.missingFeatures.length, elapsedMs: elapsedSoFar, retrying: true })
          safeEnqueue(`data: ${JSON.stringify({ type: 'progress', step: 'Fixing bugs found by analysis...', elapsed: Math.floor(elapsedSoFar / 1000) })}\n\n`)

          const retryPrompt = `${planContext}\n\n${combinedHint}\n\nOutput the complete corrected HTML:`
          const retryResult = await llmChat(buildPrompt(mission), retryPrompt, {
            maxTokens: tokenBudget,
            temperature: 0.3,
            timeoutMs: 60_000,
            thinking: true, // v29.61: Enable deep reasoning for bug fixing
            signal: request.signal,
          })

          if (retryResult.ok) {
            const retryHtmlRaw = stripCodeFences(retryResult.text)
            if (looksLikeHtml(retryHtmlRaw)) {
              // Apply the same post-processing to retry HTML
              let retryHtml = retryHtmlRaw

              // v29.67: Check for unclosed <script> tags (same as main path)
              {
                const ro = (retryHtml.match(/<script/gi) || []).length
                const rc = (retryHtml.match(/<\/script>/gi) || []).length
                if (ro > rc) {
                  logger.warn('code.retry_unclosed_script', { ip, opens: ro, closes: rc })
                  const ct = '</script>\n'
                  if (retryHtml.toLowerCase().includes('</body>')) {
                    retryHtml = retryHtml.replace(/<\/body>/i, `${ct}</body>`)
                  } else if (retryHtml.toLowerCase().includes('</html>')) {
                    retryHtml = retryHtml.replace(/<\/html>/i, `${ct}</html>`)
                  } else {
                    retryHtml = retryHtml + ct + '</body>\n</html>'
                  }
                }
              }

              const retryHeadMatch = retryHtml.match(/<head[^>]*>/i)
              if (retryHeadMatch) {
                retryHtml = retryHtml.replace(/<head[^>]*>/i, `${retryHeadMatch[0]}\n${designTokens}`)
              }
              retryHtml = injectCsp(retryHtml)
              // v26: Inject polyfill for blocked APIs
              retryHtml = stripBlockedAPIs(retryHtml)
              // v27: Fix math errors in retry too
              retryHtml = fixConversionMath(retryHtml)
              // v27: Fix form submit handlers in retry too
              retryHtml = fixForms(retryHtml)
              // v27: Fix CSS issues in retry too
              retryHtml = fixCss(retryHtml)
              retryHtml = injectRuntimeErrorCapture(retryHtml)

              const retryValidation = validateOutput(retryHtml, mission)
              logger.info('code.retry_validated', { ip, score: retryValidation.score, improved: retryValidation.score > validation.score })
              if (retryValidation.score > validation.score) {
                // Use the improved version
                const metrics = analyzeQuality(retryHtml)
                // v16: Include quality breakdown in retry result too
                // v29.67: Strip polyfill before analysis (same fix as main path)
                const retryPolyfillPattern = /<script[^>]*>\s*\/\/\s*v\d+:?\s*In-memory polyfill for localStorage[\s\S]*?<\/script>/gi
                const retryHtmlForAnalysis = retryHtml.replace(retryPolyfillPattern, '')
                const retryStaticAnalysis = analyzeHtml(retryHtmlForAnalysis)
                const retryPlanAdherence = checkPlanAdherence(retryHtml, plan)
                // v26: Adjust score for static errors (same as main path)
                const retryStaticErrors = retryStaticAnalysis.issues.filter(i => i.severity === 'error').length
                const retryStaticWarnings = retryStaticAnalysis.issues.filter(i => i.severity === 'warning').length
                const retryStaticDeduction = Math.min(50, retryStaticErrors * 10 + retryStaticWarnings * 3)
                const retryAdjustedScore = Math.max(0, retryValidation.score - retryStaticDeduction)
                logger.info('code.completed', { ip, ms: Date.now() - startTime, tokens: totalTokens + retryResult.tokens, htmlBytes: retryHtml.length, score: retryAdjustedScore, rawScore: retryValidation.score, staticErrors: retryStaticErrors, metrics: metrics.summary })
                safeEnqueue(`data: ${JSON.stringify({
                  type: 'result', html: retryHtml, tokens: totalTokens + retryResult.tokens, ms: Date.now() - startTime, quality: retryAdjustedScore, metrics: metrics.summary,
                  checks: retryValidation.checks.map(c => ({ name: c.name, passed: c.passed, detail: c.detail })),
                  missingFeatures: retryPlanAdherence.missingFeatures.slice(0, 5),
                  staticIssues: retryStaticAnalysis.issues.slice(0, 5).map(i => ({ severity: i.severity, message: i.message })),
                  truncated: !retryHtml.toLowerCase().includes('</html>'),
                })}\n\n`)
                safeClose()
                return
              }
            }
          }
          // Retry didn't help — use original
        }

        // v10.6: Progress — almost done
        safeEnqueue(`data: ${JSON.stringify({ type: 'progress', step: 'Finalizing...', elapsed: Math.floor((Date.now() - startTime) / 1000) })}\n\n`)

        // ── INTELLIGENCE: Quality metrics ──
        const metrics = analyzeQuality(html)
        // v26: Adjust score based on static analysis — missing functions are critical bugs
        // Each static error deducts 10 points, each warning deducts 3
        const staticErrors = staticAnalysis.issues.filter(i => i.severity === 'error').length
        const staticWarnings = staticAnalysis.issues.filter(i => i.severity === 'warning').length
        const staticDeduction = Math.min(50, staticErrors * 10 + staticWarnings * 3)
        const adjustedScore = Math.max(0, validation.score - staticDeduction)
        logger.info('code.completed', { ip, ms: totalMs, tokens: totalTokens, htmlBytes: html.length, score: adjustedScore, rawScore: validation.score, staticErrors, staticWarnings, staticDeduction, metrics: metrics.summary })
        // v29.43: Record success for the model that actually served the request.
        // Qwen (DashScope) has no circuit breaker entry, so skip it.
        if (useKimi) {
          recordSuccess('tokenrouter')
        } else if (!useQwen) {
          recordSuccess('z-ai')
        }

        // v10: Multi-file support — parse output for files array
        const multiFileResult = parseOutput(html)
        const resultData: Record<string, unknown> = {
          type: 'result', html, tokens: totalTokens, ms: totalMs, quality: adjustedScore, metrics: metrics.summary,
          // v16: Quality breakdown — specific checks + missing features for the insights panel
          checks: validation.checks.map(c => ({ name: c.name, passed: c.passed, detail: c.detail })),
          missingFeatures: planAdherence.missingFeatures.slice(0, 5),
          staticIssues: staticAnalysis.issues.slice(0, 5).map(i => ({ severity: i.severity, message: i.message })),
          // v16: Truncation flag — true when HTML doesn't end with </html> (was cut short)
          truncated: !html.toLowerCase().includes('</html>'),
        }
        if (multiFileResult.files.length > 1 || multiFileResult.type !== 'html-app') {
          resultData.files = multiFileResult.files
          resultData.outputType = multiFileResult.type
          resultData.previewable = multiFileResult.previewable
        }

        // v10: Store result for polling fallback
        storeResult(buildId, { html, tokens: totalTokens, ms: totalMs, quality: adjustedScore, metrics: metrics.summary })

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
          // v29.43: Record failure for the model that was being used.
          // Qwen (DashScope) has no circuit breaker entry, so skip it.
          if (useKimi) {
            recordFailure('tokenrouter', errorMsg)
          } else if (!useQwen) {
            recordFailure('z-ai', errorMsg)
          }
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
