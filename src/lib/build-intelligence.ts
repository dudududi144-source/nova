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

  if (lower.includes('game') || lower.includes('play')) {
    // v10 fix: Don't prescribe snake-specific hints for all games.
    // Let the LLM decide the best approach based on the actual game type.
    detectedType = 'game'
    hints.push('Choose the best rendering method (Canvas, DOM, or SVG) based on the game type')
    hints.push('Implement smooth gameplay with appropriate input methods')
    hints.push('Show score/status clearly')
    hints.push('Include start and game-over states')
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

  // Always include the general hints (previously: only included if hints.length > 3,
  // which meant when no specific hints matched, the 3 general hints were silently dropped).
  const enriched = `${mission}\n\nImplementation hints:\n${hints.map(h => `- ${h}`).join('\n')}`

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

// ── Weighted check type ──
// Each check has a weight (points). The score is the sum of passed weights
// divided by the total possible weight, times 100. This gives more meaningful
// scores than flat counting — a missing DOCTYPE (weight 20) hurts more than
// a missing aria-label (weight 2).
interface WeightedCheck {
  name: string
  passed: boolean
  detail: string
  weight: number
  category: 'structure' | 'javascript' | 'css' | 'a11y' | 'security' | 'mission'
}

export function validateOutput(html: string, mission: string): ValidationResult {
  const checks: WeightedCheck[] = []
  const lower = html.toLowerCase()
  const lowerMission = mission.toLowerCase()

  // ═══ STRUCTURE CHECKS (weight: 35) ═══
  checks.push({
    name: 'DOCTYPE',
    passed: lower.includes('<!doctype'),
    detail: 'HTML must start with <!DOCTYPE html>',
    weight: 15,
    category: 'structure',
  })
  checks.push({
    name: 'Closing tags',
    passed: lower.includes('</html>') && lower.includes('</body>'),
    detail: 'HTML must have </body> and </html> closing tags',
    weight: 15,
    category: 'structure',
  })
  checks.push({
    name: 'Size',
    passed: html.length > 2000,
    detail: `HTML is ${html.length} bytes (minimum 2000 for a decent app)`,
    weight: 5,
    category: 'structure',
  })

  // ═══ JAVASCRIPT CHECKS (weight: 15) ═══
  const scriptCount = (html.match(/<script/gi) || []).length
  checks.push({
    name: 'JavaScript',
    passed: scriptCount > 0,
    detail: `Found ${scriptCount} <script> tag(s)`,
    weight: 10,
    category: 'javascript',
  })
  // Check for error handling — try-catch around game/app logic
  const hasTryCatch = /try\s*\{/.test(lower)
  checks.push({
    name: 'Error handling',
    passed: hasTryCatch,
    detail: hasTryCatch ? 'Has try-catch error handling' : 'Missing try-catch (app may crash on edge cases)',
    weight: 5,
    category: 'javascript',
  })

  // ═══ CSS CHECKS (weight: 15) ═══
  const styleCount = (html.match(/<style/gi) || []).length
  checks.push({
    name: 'CSS',
    passed: styleCount > 0,
    detail: `Found ${styleCount} <style> tag(s)`,
    weight: 10,
    category: 'css',
  })
  // Check for transitions/animations (polish indicator)
  const hasTransitions = /transition\s*:/.test(lower) || /animation\s*:/.test(lower)
  checks.push({
    name: 'Transitions/Animations',
    passed: hasTransitions,
    detail: hasTransitions ? 'Has CSS transitions or animations (polish)' : 'Missing CSS transitions (feels static)',
    weight: 5,
    category: 'css',
  })

  // ═══ SECURITY CHECKS (weight: 10) ═══
  const hasBlockedApi = /localstorage|sessionstorage|document\.cookie/.test(lower)
  checks.push({
    name: 'No blocked storage',
    passed: !hasBlockedApi,
    detail: hasBlockedApi ? 'Uses localStorage/sessionStorage/cookie (blocked in sandbox)' : 'No blocked storage APIs',
    weight: 10,
    category: 'security',
  })

  // ═══ ACCESSIBILITY CHECKS (weight: 10) ═══
  // Check for aria-labels on interactive elements
  const ariaLabelCount = (html.match(/aria-label\s*=/gi) || []).length
  const interactiveCount = (html.match(/<button|<input|<a\s|role=["']button/gi) || []).length
  const hasAriaLabels = interactiveCount === 0 || ariaLabelCount >= Math.floor(interactiveCount / 3)
  checks.push({
    name: 'ARIA labels',
    passed: hasAriaLabels,
    detail: `${ariaLabelCount} aria-label(s) for ${interactiveCount} interactive element(s)`,
    weight: 4,
    category: 'a11y',
  })
  // Check for semantic HTML (main, nav, header, section, article)
  const semanticTags = (html.match(/<(main|nav|header|section|article|footer|aside)\b/gi) || []).length
  checks.push({
    name: 'Semantic HTML',
    passed: semanticTags >= 2,
    detail: `Found ${semanticTags} semantic tag(s) (main, nav, header, section, article)`,
    weight: 3,
    category: 'a11y',
  })
  // Check for lang attribute on <html>
  const hasLangAttr = /<html\s+[^>]*\blang\s*=/.test(lower)
  checks.push({
    name: 'Language attribute',
    passed: hasLangAttr,
    detail: hasLangAttr ? 'Has lang attribute on <html>' : 'Missing lang attribute on <html> (screen readers need it)',
    weight: 3,
    category: 'a11y',
  })

  // ═══ MISSION-SPECIFIC CHECKS (weight: 15) ═══
  if (lowerMission.includes('snake') || lowerMission.includes('game')) {
    const hasCanvas = lower.includes('<canvas')
    const hasRAF = lower.includes('requestanimationframe')
    const hasSetInterval = /setinterval\s*\(/.test(lower)
    const hasEventListener = lower.includes('addeventlistener')
    const hasScore = lower.includes('score')

    checks.push({ name: 'Canvas', passed: hasCanvas, detail: hasCanvas ? 'Has <canvas>' : 'Missing <canvas> for game rendering', weight: 4, category: 'mission' })
    checks.push({ name: 'Game loop', passed: hasRAF || hasSetInterval, detail: (hasRAF || hasSetInterval) ? 'Has game loop (rAF or setInterval)' : 'Missing game loop', weight: 4, category: 'mission' })
    checks.push({ name: 'Event listeners', passed: hasEventListener, detail: hasEventListener ? 'Has event listeners' : 'Missing event listeners', weight: 4, category: 'mission' })
    checks.push({ name: 'Score', passed: hasScore, detail: hasScore ? 'Has score' : 'Missing score display', weight: 3, category: 'mission' })
  } else if (lowerMission.includes('todo') || lowerMission.includes('task')) {
    const hasInput = lower.includes('<input') || lower.includes('<textarea')
    const hasButton = lower.includes('<button')
    checks.push({ name: 'Input', passed: hasInput, detail: hasInput ? 'Has input' : 'Missing input field', weight: 8, category: 'mission' })
    checks.push({ name: 'Buttons', passed: hasButton, detail: hasButton ? 'Has buttons' : 'Missing buttons', weight: 7, category: 'mission' })
  } else if (/\bcalc(ulator)?\b/.test(lowerMission)) {
    const hasButtons = (html.match(/<button/gi) || []).length
    checks.push({ name: 'Calculator buttons', passed: hasButtons >= 10, detail: `Found ${hasButtons} buttons (need 10+)`, weight: 15, category: 'mission' })
  } else {
    // Generic mission — check for basic interactivity
    const hasInteractivity = lower.includes('addeventlistener') || lower.includes('onclick')
    checks.push({ name: 'Interactivity', passed: hasInteractivity, detail: hasInteractivity ? 'Has event handlers' : 'Missing event handlers (static page)', weight: 15, category: 'mission' })
  }

  // ═══ CALCULATE WEIGHTED SCORE ═══
  const totalWeight = checks.reduce((sum, c) => sum + c.weight, 0)
  const passedWeight = checks.filter(c => c.passed).reduce((sum, c) => sum + c.weight, 0)
  const score = Math.round((passedWeight / totalWeight) * 100)

  // Generate retry hint if score < 70
  const failedChecks = checks.filter(c => !c.passed)
  let retryHint: string | undefined
  if (score < 70 && failedChecks.length > 0) {
    // Sort by weight descending — fix the most impactful issues first
    const sorted = [...failedChecks].sort((a, b) => b.weight - a.weight)
    retryHint = `The previous output was incomplete. Fix these issues (highest impact first):\n${sorted.map(c => `- ${c.name} (${c.weight}pts): ${c.detail}`).join('\n')}`
  }

  return {
    passed: score >= 70,
    score,
    checks: checks.map(c => ({ name: c.name, passed: c.passed, detail: c.detail })),
    retryHint,
  }
}

// ── 3. Adaptive Token Budget ──
// Instead of fixed maxTokens, estimate based on plan complexity.

export function estimateTokenBudget(plan: unknown): number {
  // v14 ROAST FIX: Reduced defaults for faster, more reliable builds.
  // Was 12000 default → caused 5+ min builds and truncation.
  // Now 6000 default with tighter clamps.
  if (!plan || typeof plan !== 'object') return 6000

  const p = plan as Record<string, unknown>
  const features = Array.isArray(p.features) ? p.features.length : 3
  const keyFunctions = Array.isArray(p.keyFunctions) ? p.keyFunctions.length : 2

  // Base: 1500 tokens per feature + 800 per function + 1000 overhead
  // Tighter budget forces the LLM to be concise and focused.
  const estimated = 1500 * features + 800 * keyFunctions + 1000

  // Clamp: 5000 minimum, 16000 maximum (was 8000-32000 — too slow)
  return Math.max(5000, Math.min(16000, estimated))
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
