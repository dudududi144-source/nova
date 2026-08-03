// v16: Smart mission analysis — runs client-side BEFORE building.
// Analyzes the mission text to provide instant feedback:
// - Complexity level (simple/medium/complex) with reasoning
// - Vagueness detection (too short, too generic)
// - Over-scope detection (too many features for a single-file app)
// - Estimated build time and token cost
// - Model recommendation (Z.AI for complex, Qwen for simple)
// - Actionable suggestions to improve the prompt

export type Complexity = 'simple' | 'medium' | 'complex'
export type VaguenessLevel = 'none' | 'vague' | 'too-vague'

export interface MissionAnalysis {
  complexity: Complexity
  complexityReason: string
  vagueness: VaguenessLevel
  vaguenessReason: string
  isTooComplex: boolean
  tooComplexReason: string
  estimatedTime: number // seconds
  estimatedTokens: number
  recommendedModel: 'z-ai' | 'qwen' | 'kimi'
  modelReason: string
  suggestions: string[]
  featureCount: number
  wordCount: number
}

// Keywords that indicate complexity
const COMPLEX_KEYWORDS = [
  'real-time', 'live', 'streaming', 'collaborative', 'multiplayer', 'authentication',
  'database', 'backend', 'api', 'integration', 'websocket', '3d', 'webgl', 'canvas',
  'physics', 'simulation', 'ai', 'ml', 'machine learning', 'neural',
  'multi-track', 'sequencer', 'compiler', 'interpreter', 'terminal',
]

const MEDIUM_KEYWORDS = [
  'dashboard', 'editor', 'studio', 'game', 'timer', 'tracker', 'calculator',
  'converter', 'generator', 'viewer', 'browser', 'simulator', 'analyzer',
  'planner', 'scheduler', 'manager',
]

const SIMPLE_KEYWORDS = [
  'counter', 'clock', 'timer', 'list', 'todo', 'note', 'card', 'button',
  'form', 'page', 'landing', 'banner', 'badge', 'label',
]

// Keywords that suggest the request is too complex for a single-file app
const OVERSCOPE_KEYWORDS = [
  'operating system', 'full os', 'database server', 'backend server',
  'authentication system', 'user management', 'payment processing',
  'real backend', 'server-side', 'multi-user', 'concurrent users',
  'machine learning model', 'train ai', 'neural network training',
]

// Vague prompts — too short or too generic
const VAGUE_PATTERNS = [
  /^(todo|app|game|tool|site|page|dashboard|calculator)$/i,
  /^(a |an |some )?(app|game|tool|site|page)$/i,
  /^(build|make|create) (a |an )?(app|game|tool|site|page)$/i,
]

/**
 * Analyze a mission string and return structured feedback.
 * Pure function — no side effects, no network calls. Runs instantly client-side.
 */
export function analyzeMission(mission: string): MissionAnalysis {
  const trimmed = mission.trim()
  const lower = trimmed.toLowerCase()
  const words = trimmed.split(/\s+/).filter(Boolean)
  const wordCount = words.length

  // Count features — rough heuristic: count commas, "and", "with", "plus"
  const featureIndicators = (lower.match(/,| and | with | plus | including /g) || []).length
  const featureCount = Math.max(1, featureIndicators + 1)

  // ── Complexity detection ──
  let complexity: Complexity = 'simple'
  let complexityReason = 'Simple app with basic functionality'

  const complexHits = COMPLEX_KEYWORDS.filter(kw => lower.includes(kw))
  const mediumHits = MEDIUM_KEYWORDS.filter(kw => lower.includes(kw))
  const simpleHits = SIMPLE_KEYWORDS.filter(kw => lower.includes(kw))

  if (complexHits.length >= 2 || (complexHits.length >= 1 && featureCount >= 3)) {
    complexity = 'complex'
    complexityReason = `Complex features detected: ${complexHits.slice(0, 3).join(', ')}`
  } else if (complexHits.length >= 1 || mediumHits.length >= 1 || featureCount >= 3) {
    complexity = 'medium'
    complexityReason = mediumHits.length > 0
      ? `Medium complexity: ${mediumHits.slice(0, 2).join(', ')}`
      : `Multiple features (${featureCount})`
  } else if (simpleHits.length >= 1) {
    complexity = 'simple'
    complexityReason = `Simple app: ${simpleHits[0]}`
  } else if (wordCount > 20) {
    complexity = 'medium'
    complexityReason = `Detailed prompt (${wordCount} words)`
  }

  // ── Vagueness detection ──
  let vagueness: VaguenessLevel = 'none'
  let vaguenessReason = ''

  if (VAGUE_PATTERNS.some(p => p.test(trimmed))) {
    vagueness = 'too-vague'
    vaguenessReason = 'Prompt is too generic — add specific features'
  } else if (wordCount < 5) {
    vagueness = 'vague'
    vaguenessReason = `Only ${wordCount} words — add features, interactions, or style details`
  } else if (featureCount === 1 && wordCount < 10) {
    vagueness = 'vague'
    vaguenessReason = 'Single feature, short description — consider adding more detail'
  }

  // ── Over-scope detection ──
  const overscopeHits = OVERSCOPE_KEYWORDS.filter(kw => lower.includes(kw))
  const isTooComplex = overscopeHits.length > 0
  const tooComplexReason = isTooComplex
    ? `Request may be too complex for single-file app: ${overscopeHits.join(', ')}`
    : ''

  // ── Time/token estimation ──
  // Based on empirical data from v14 builds:
  // - simple: ~2-3 min (Quick), ~4-5 min (normal)
  // - medium: ~3-4 min (Quick), ~5-7 min (normal)
  // - complex: ~4-5 min (Quick), ~7-10 min (normal)
  const baseTime = complexity === 'simple' ? 150 : complexity === 'medium' ? 240 : 360
  const featureMultiplier = 1 + (featureCount - 1) * 0.1
  const estimatedTime = Math.round(baseTime * featureMultiplier)

  const baseTokens = complexity === 'simple' ? 5000 : complexity === 'medium' ? 7000 : 10000
  const estimatedTokens = Math.round(baseTokens * featureMultiplier)

  // ── Model recommendation ──
  let recommendedModel: 'z-ai' | 'qwen' | 'kimi' = 'z-ai'
  let modelReason = 'Z.AI — best balance of speed and quality'

  if (complexity === 'simple') {
    recommendedModel = 'qwen'
    modelReason = 'Qwen — fast and free, sufficient for simple apps'
  } else if (complexity === 'complex') {
    recommendedModel = 'kimi'
    modelReason = 'Kimi K3 — reasoning model, better for complex logic'
  }

  // ── Suggestions ──
  const suggestions: string[] = []

  if (vagueness === 'too-vague') {
    suggestions.push('Add specific features: "with add, delete, and filter by status"')
    suggestions.push('Mention interactions: "drag-and-drop", "keyboard shortcuts"')
    suggestions.push('Describe the visual style: "minimalist dark UI"')
  } else if (vagueness === 'vague') {
    suggestions.push('Add 2-3 concrete features the app should have')
    suggestions.push('Mention key interactions or visual style')
  }

  if (isTooComplex) {
    suggestions.push('Simplify: NOVA builds single-file apps — no backend/database/server')
    suggestions.push('Focus on the UI/UX, use in-memory data instead of a database')
  }

  if (featureCount > 7) {
    suggestions.push(`Many features (${featureCount}) — consider splitting into separate builds`)
  }

  if (suggestions.length === 0 && vagueness === 'none' && !isTooComplex) {
    suggestions.push('Prompt looks good — ready to build!')
  }

  return {
    complexity,
    complexityReason,
    vagueness,
    vaguenessReason,
    isTooComplex,
    tooComplexReason,
    estimatedTime,
    estimatedTokens,
    recommendedModel,
    modelReason,
    suggestions,
    featureCount,
    wordCount,
  }
}
