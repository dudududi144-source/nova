// Build Intelligence — wraps the LLM with analysis, validation, and adaptation.
// This is what makes NOVA "intelligent" instead of just calling the LLM blindly.
//
// 5 capabilities:
// 1. MISSION ENRICHMENT: Analyzes mission text, adds specific implementation hints
// 2. OUTPUT VALIDATION: Checks generated HTML for completeness and quality
// 3. ADAPTIVE TOKEN BUDGET: Estimates needed tokens from plan complexity
// 4. QUALITY METRICS: Analyzes HTML and reports stats to user
// 5. RETRY GUIDANCE: If validation fails, generates a targeted retry prompt

// ── 1. Mission Enrichment ──
// Before sending to the architect, we enrich the mission with specific hints.
// This helps the architect produce a better, more actionable plan.

export interface EnrichedMission {
  original: string
  enriched: string
  detectedType: string
  hints: string[]
}

export function enrichMission(mission: string): EnrichedMission {
  const lower = mission.toLowerCase()
  const hints: string[] = []
  let detectedType = 'app'

  if (lower.includes('snake') || lower.includes('game')) {
    // Note: card games, word games, text adventures also match 'game' — that's fine.
    // The snake-specific hints (canvas, grid movement) may not apply to all games,
    // but the architect LLM adapts based on the mission text.
    detectedType = 'game'
    hints.push('Use HTML5 Canvas for rendering')
    hints.push('Game loop with requestAnimationFrame at 10-15 FPS')
    hints.push('Grid-based movement (e.g., 20x20 cells)')
    hints.push('Arrow keys for direction, prevent reverse')
    hints.push('Score display, food collision, growing mechanic')
    hints.push('Game-over screen with restart button')
  } else if (lower.includes('todo') || lower.includes('task')) {
    detectedType = 'app'
    hints.push('Input field with add button')
    hints.push('Task list with checkbox for completion')
    hints.push('Delete button per task')
    hints.push('Filter tabs: All / Active / Completed')
    hints.push('Empty state message when no tasks')
  } else if (/\bcalc(ulator)?\b/.test(lower)) {
    detectedType = 'tool'
    hints.push('Display at top, button grid below (4 columns)')
    hints.push('Buttons: 0-9, +, -, *, /, =, C, .')
    hints.push('Keyboard support for digits and operators')
    hints.push('Handle division by zero')
    hints.push('Chain operations (2+3*4=14)')
  } else if (lower.includes('color') || lower.includes('palette')) {
    detectedType = 'tool'
    hints.push('Generate random color on click')
    hints.push('Show hex code with copy-to-clipboard')
    hints.push('Display color preview as large swatch')
    hints.push('Save colors to in-memory list')
    hints.push('Show complementary color')
  } else if (lower.includes('clock') || lower.includes('timer') || lower.includes('stopwatch')) {
    detectedType = 'tool'
    hints.push('Display time in MM:SS or HH:MM:SS format')
    hints.push('Start/Stop/Reset buttons')
    hints.push('Update every 100ms with setInterval')
    hints.push('Lap times for stopwatch')
  } else if (lower.includes('markdown') || lower.includes('editor') || lower.includes('text')) {
    detectedType = 'app'
    hints.push('Split view: input on left, preview on right')
    hints.push('Real-time markdown parsing (headings, bold, links, lists, code)')
    hints.push('Simple regex-based parser, no external libraries')
    hints.push('Dark theme code blocks')
  } else if (lower.includes('music') || lower.includes('player')) {
    detectedType = 'app'
    hints.push('Play/Pause/Next/Previous controls')
    hints.push('Progress bar with current time')
    hints.push('Playlist display with active track highlight')
    hints.push('Use Web Audio API or simple HTML5 audio')
  }

  // Add general quality hints
  hints.push('Dark theme: #0f172a background, #1e293b cards, #e2e8f0 text')
  hints.push('Responsive layout with CSS Flexbox or Grid')
  hints.push('Add CSS transitions on interactive elements')

  const enriched = hints.length > 3
    ? `${mission}\n\nImplementation hints:\n${hints.map(h => `- ${h}`).join('\n')}`
    : mission

  return { original: mission, enriched, detectedType, hints }
}

// ── 2. Output Validation ──
// After the coder returns HTML, we validate it for completeness.

export interface ValidationResult {
  passed: boolean
  score: number // 0-100
  checks: { name: string; passed: boolean; detail: string }[]
  retryHint?: string // If failed, what to tell the LLM on retry
}

export function validateOutput(html: string, mission: string): ValidationResult {
  const checks: { name: string; passed: boolean; detail: string }[] = []
  const lower = html.toLowerCase()
  const lowerMission = mission.toLowerCase()

  // Check 1: Has DOCTYPE
  checks.push({
    name: 'DOCTYPE',
    passed: lower.includes('<!doctype'),
    detail: 'HTML must start with <!DOCTYPE html>',
  })

  // Check 2: Has closing tags
  checks.push({
    name: 'Closing tags',
    passed: lower.includes('</html>') && lower.includes('</body>'),
    detail: 'HTML must have </body> and </html> closing tags',
  })

  // Check 3: Has <script> tag (JavaScript)
  const scriptCount = (html.match(/<script/gi) || []).length
  checks.push({
    name: 'JavaScript',
    passed: scriptCount > 0,
    detail: `Found ${scriptCount} <script> tag(s)`,
  })

  // Check 4: Has <style> tag (CSS)
  const styleCount = (html.match(/<style/gi) || []).length
  checks.push({
    name: 'CSS',
    passed: styleCount > 0,
    detail: `Found ${styleCount} <style> tag(s)`,
  })

  // Check 5: Minimum size (500 bytes = very basic, 2000 = decent)
  checks.push({
    name: 'Size',
    passed: html.length > 2000,
    detail: `HTML is ${html.length} bytes (minimum 2000)`,
  })

  // Check 5b: No blocked storage APIs (localStorage/sessionStorage/cookie are blocked in sandbox)
  // The CODER_PROMPT says don't use them, but LLMs sometimes ignore it. When they do,
  // the app crashes on first interaction. Catch it here so we can retry.
  const hasBlockedApi = /localstorage|sessionstorage|document\.cookie/.test(lower)
  checks.push({
    name: 'No blocked storage',
    passed: !hasBlockedApi,
    detail: hasBlockedApi ? 'Uses localStorage/sessionStorage/cookie (blocked in sandbox)' : 'No blocked storage APIs',
  })

  // Check 6: Game-specific checks
  if (lowerMission.includes('snake') || lowerMission.includes('game')) {
    const hasCanvas = lower.includes('<canvas')
    const hasRAF = lower.includes('requestanimationframe')
    const hasSetInterval = /setinterval\s*\(/.test(lower)
    const hasEventListener = lower.includes('addeventlistener')
    const hasScore = lower.includes('score')

    checks.push({ name: 'Canvas', passed: hasCanvas, detail: hasCanvas ? 'Has <canvas>' : 'Missing <canvas> for game rendering' })
    checks.push({ name: 'Game loop', passed: hasRAF || hasSetInterval, detail: (hasRAF || hasSetInterval) ? 'Has game loop (rAF or setInterval)' : 'Missing game loop' })
    checks.push({ name: 'Event listeners', passed: hasEventListener, detail: hasEventListener ? 'Has event listeners' : 'Missing event listeners' })
    checks.push({ name: 'Score', passed: hasScore, detail: hasScore ? 'Has score' : 'Missing score display' })
  }

  // Check 7: Todo-specific checks
  if (lowerMission.includes('todo') || lowerMission.includes('task')) {
    const hasInput = lower.includes('<input') || lower.includes('<textarea')
    const hasButton = lower.includes('<button')
    checks.push({ name: 'Input', passed: hasInput, detail: hasInput ? 'Has input' : 'Missing input field' })
    checks.push({ name: 'Buttons', passed: hasButton, detail: hasButton ? 'Has buttons' : 'Missing buttons' })
  }

  // Check 8: Calculator-specific checks
  if (/\bcalc(ulator)?\b/.test(lowerMission)) {
    const hasButtons = (html.match(/<button/gi) || []).length
    checks.push({ name: 'Calculator buttons', passed: hasButtons >= 10, detail: `Found ${hasButtons} buttons (need 10+)` })
  }

  // Calculate score
  const passedCount = checks.filter(c => c.passed).length
  const score = Math.round((passedCount / checks.length) * 100)

  // Generate retry hint if score < 70
  const failedChecks = checks.filter(c => !c.passed)
  let retryHint: string | undefined
  if (score < 70 && failedChecks.length > 0) {
    retryHint = `The previous output was incomplete. Fix these issues:\n${failedChecks.map(c => `- ${c.name}: ${c.detail}`).join('\n')}`
  }

  return {
    passed: score >= 70,
    score,
    checks,
    retryHint,
  }
}

// ── 3. Adaptive Token Budget ──
// Instead of fixed maxTokens, estimate based on plan complexity.

export function estimateTokenBudget(plan: unknown): number {
  if (!plan || typeof plan !== 'object') return 16000 // default

  const p = plan as Record<string, unknown>
  const features = Array.isArray(p.features) ? p.features.length : 3
  const keyFunctions = Array.isArray(p.keyFunctions) ? p.keyFunctions.length : 2

  // Base: 4000 tokens per feature + 2000 per function + 2000 overhead
  const estimated = 4000 * features + 2000 * keyFunctions + 2000

  // Clamp: 8000 minimum, 32000 maximum
  return Math.max(8000, Math.min(32000, estimated))
}

// ── 4. Quality Metrics ──
// Analyze the generated HTML and report stats.

export interface QualityMetrics {
  lines: number
  bytes: number
  functions: number
  eventListeners: number
  cssRules: number
  domElements: number
  hasCanvas: boolean
  hasAnimations: boolean
  summary: string
}

export function analyzeQuality(html: string): QualityMetrics {
  const lower = html.toLowerCase()

  const lines = html.split('\n').length
  const bytes = html.length
  const functions = (html.match(/function\s+\w+|const\s+\w+\s*=\s*\(|=>\s*{/gi) || []).length
  const eventListeners = (lower.match(/addeventlistener/g) || []).length
  // CSS rules: only count {...} blocks INSIDE <style>...</style> tags.
  // The old regex /\{[^}]*\}/g matched JS object literals, template interpolations, etc.
  const styleBlocks = html.match(/<style[^>]*>([\s\S]*?)<\/style>/gi) || []
  const cssRules = styleBlocks.reduce((sum, block) => sum + (block.match(/\{[^}]*\}/g) || []).length, 0)
  const domElements = (html.match(/<\w+/g) || []).length
  const hasCanvas = lower.includes('<canvas')
  const hasAnimations = lower.includes('requestanimationframe') || lower.includes('transition') || lower.includes('animation')

  const summary = `${lines} lines · ${functions} functions · ${eventListeners} listeners · ${cssRules} CSS rules`

  return { lines, bytes, functions, eventListeners, cssRules, domElements, hasCanvas, hasAnimations, summary }
}
