// Error Recovery — smart error analysis and mission triage.
//
// When a build fails, NOVA needs to:
// 1. Categorize the error (timeout? rate limit? invalid output? vague mission?)
// 2. Decide whether to retry, and if so, after how long
// 3. Give the user actionable suggestions (not raw stack traces)
// 4. Detect when the MISSION itself is the problem (too vague, too complex)
//
// This module is pure (no I/O, no LLM calls) — it just analyzes strings and
// returns structured recommendations. The caller decides what to do with them.

// ── Types ──

export type ErrorCategory =
  | 'timeout'
  | 'network'
  | 'rate-limit'
  | 'invalid-output'
  | 'empty'
  | 'mission-vague'
  | 'mission-complex'
  | 'cancelled'
  | 'unknown'

export type ErrorSeverity = 'low' | 'medium' | 'high' | 'critical'

/** Structured analysis of a build error. */
export interface ErrorAnalysis {
  category: ErrorCategory
  severity: ErrorSeverity
  /** Short human-readable title, e.g. "Build timed out". */
  title: string
  /** Longer explanation of what went wrong. */
  message: string
  /** Actionable next steps the user can take. */
  suggestions: string[]
  /** Whether retrying the same mission might succeed. */
  canRetry: boolean
  /** Suggested delay before retry, in ms. 0 = retry immediately. */
  retryDelayMs: number
}

// ── Error analysis ──

/**
 * Analyze an error from the build pipeline.
 *
 * Accepts either an Error object or a string message. The function categorizes
 * the error by pattern-matching against known error signatures (timeout, 429,
 * network, abort, empty output, invalid HTML, etc.).
 *
 * The mission string is included in case the error suggests a mission-level
 * problem (e.g. "output too short" might indicate a vague mission).
 */
export function analyzeError(error: string | Error, mission: string): ErrorAnalysis {
  const msg = error instanceof Error ? error.message : String(error ?? '')
  const lower = msg.toLowerCase()
  const missionLen = (mission ?? '').trim().length

  // ── Cancelled (client disconnect) ──
  if (lower.includes('abort') || lower.includes('cancel')) {
    return {
      category: 'cancelled',
      severity: 'low',
      title: 'Build cancelled',
      message: 'The build was cancelled before it finished.',
      suggestions: ['Try again — your mission is still in the input box.'],
      canRetry: true,
      retryDelayMs: 0,
    }
  }

  // ── Rate limit (429) ──
  if (lower.includes('429') || lower.includes('rate limit') || lower.includes('too many requests') || lower.includes('service is busy')) {
    return {
      category: 'rate-limit',
      severity: 'medium',
      title: 'AI service is busy',
      message: 'The AI provider is rate-limiting requests. This is temporary.',
      suggestions: [
        'Wait 60 seconds, then try again.',
        'If it persists, simplify your mission — shorter requests use less quota.',
      ],
      canRetry: true,
      retryDelayMs: 60_000,
    }
  }

  // ── Timeout ──
  if (lower.includes('timed out') || lower.includes('timeout') || lower.includes('timeoutms')) {
    // If the mission is very long, the timeout is likely complexity-related
    if (missionLen > 500) {
      return {
        category: 'timeout',
        severity: 'high',
        title: 'Build timed out',
        message: `The build took too long. Your mission is ${missionLen} chars — the AI may be trying to do too much.`,
        suggestions: [
          'Simplify your request — focus on the core feature first.',
          'Split a complex app into multiple smaller builds.',
          'Try the "simplify" suggestion below.',
        ],
        canRetry: true,
        retryDelayMs: 5_000,
      }
    }
    return {
      category: 'timeout',
      severity: 'medium',
      title: 'Build timed out',
      message: 'The AI took too long to respond. This is usually transient.',
      suggestions: [
        'Try again — most timeouts don\'t recur.',
        'If it keeps timing out, simplify your mission.',
      ],
      canRetry: true,
      retryDelayMs: 5_000,
    }
  }

  // ── Network ──
  if (lower.includes('network') || lower.includes('fetch') || lower.includes('econnrefused') ||
      lower.includes('enotfound') || lower.includes('etimedout') || lower.includes('socket hang up') ||
      lower.includes('connection refused') || lower.includes('connection reset')) {
    return {
      category: 'network',
      severity: 'high',
      title: 'Network error',
      message: 'NOVA couldn\'t reach the AI service. Check your internet connection.',
      suggestions: [
        'Verify you\'re online (try opening a website).',
        'If you\'re on a corporate network, the AI endpoint may be blocked.',
        'Try again in a few seconds.',
      ],
      canRetry: true,
      retryDelayMs: 10_000,
    }
  }

  // ── Empty output ──
  if (lower.includes('empty') || lower.includes('no content') || lower.includes('returned an empty')) {
    // Could be a vague mission causing the model to give up
    const vagueness = assessMissionVagueness(mission)
    if (vagueness) {
      return {
        ...vagueness,
        message: 'The AI returned an empty response. Your mission may be too vague.',
      }
    }
    return {
      category: 'empty',
      severity: 'medium',
      title: 'Empty response',
      message: 'The AI returned no content. This is usually transient.',
      suggestions: ['Try again.', 'Rephrase your mission more specifically.'],
      canRetry: true,
      retryDelayMs: 3_000,
    }
  }

  // ── Invalid output ──
  if (lower.includes('invalid') || lower.includes('doesn\'t look like html') || lower.includes('not html') ||
      lower.includes('malformed') || lower.includes('parse error')) {
    return {
      category: 'invalid-output',
      severity: 'medium',
      title: 'Invalid output',
      message: 'The AI returned output that doesn\'t look like a valid HTML app.',
      suggestions: [
        'Try again — the AI sometimes produces malformed output on the first try.',
        'Rephrase your mission more concretely.',
        'Avoid mixing languages (e.g. "build a React Python app") in one mission.',
      ],
      canRetry: true,
      retryDelayMs: 2_000,
    }
  }

  // ── Generic fallback ──
  return {
    category: 'unknown',
    severity: 'medium',
    title: 'Build failed',
    message: msg || 'The build failed for an unknown reason.',
    suggestions: [
      'Try again.',
      'If the error persists, simplify your mission.',
      'Check the browser console for more details.',
    ],
    canRetry: true,
    retryDelayMs: 3_000,
  }
}

// ── Mission assessment ──

/**
 * Detect missions that are too vague to produce a useful app.
 * Returns an ErrorAnalysis if the mission is too vague, or null if it's fine.
 *
 * Heuristics:
 * - Too short (< 12 chars after trim): "hello", "a game", "app"
 * - Too few significant words (< 2 words longer than 3 chars)
 * - Contains filler-only phrases: "make something", "build a thing"
 */
export function assessMissionVagueness(mission: string): ErrorAnalysis | null {
  const trimmed = (mission ?? '').trim()
  if (!trimmed) return null // empty is a validation error, not vagueness

  if (trimmed.length < 12) {
    return {
      category: 'mission-vague',
      severity: 'medium',
      title: 'Mission too vague',
      message: `"${trimmed}" is too short — the AI doesn't have enough to go on.`,
      suggestions: [
        'Describe what the app should DO, not just what it is.',
        'Example: "build a snake game with score and pause" instead of "snake".',
      ],
      canRetry: false,
      retryDelayMs: 0,
    }
  }

  // Count significant words (length > 3, not common filler)
  const words = trimmed.toLowerCase().split(/[\s,.-]+/).filter(w => w.length > 3 && !FILLER_WORDS.has(w))
  if (words.length < 2) {
    return {
      category: 'mission-vague',
      severity: 'medium',
      title: 'Mission too vague',
      message: 'The mission doesn\'t specify enough details. Try naming the app type AND a feature.',
      suggestions: [
        'Example: "todo app with filters" instead of "todo".',
        'Example: "calculator with history" instead of "calc".',
      ],
      canRetry: false,
      retryDelayMs: 0,
    }
  }

  // Filler-only missions
  const lower = trimmed.toLowerCase()
  if (FILLER_PHRASES.some(p => lower === p || lower.startsWith(p + ' '))) {
    return {
      category: 'mission-vague',
      severity: 'medium',
      title: 'Mission too vague',
      message: 'The mission uses generic phrasing — specify what to build.',
      suggestions: [
        'Example: "build a pomodoro timer with start/pause/reset".',
        'Example: "build a color palette generator with copy-to-clipboard".',
      ],
      canRetry: false,
      retryDelayMs: 0,
    }
  }

  return null
}

/**
 * Detect missions that are too complex for a single build.
 * Returns an ErrorAnalysis if the mission is too complex, or null if it's fine.
 *
 * Heuristics:
 * - Very long mission (> 600 chars): likely trying to build too much
 * - Mentions 4+ distinct app types ("and a chat and a forum and a store")
 * - Lists many features (count of "with", "and", commas)
 */
export function assessMissionComplexity(mission: string): ErrorAnalysis | null {
  const trimmed = (mission ?? '').trim()
  if (!trimmed) return null

  if (trimmed.length > 600) {
    return {
      category: 'mission-complex',
      severity: 'high',
      title: 'Mission too complex',
      message: `The mission is ${trimmed.length} chars long — that's a lot for one build. The AI may time out or produce incomplete output.`,
      suggestions: [
        'Split this into multiple smaller builds.',
        'Focus on the core feature first, then refine to add more.',
        'Try the simplified version below:',
        simplifyMission(trimmed),
      ],
      canRetry: false,
      retryDelayMs: 0,
    }
  }

  // Count distinct app-type mentions
  const lower = trimmed.toLowerCase()
  const appTypes = ['game', 'todo', 'calculator', 'clock', 'timer', 'editor', 'player',
    'chat', 'forum', 'store', 'blog', 'dashboard', 'calendar', 'weather', 'map',
    'gallery', 'portfolio', 'landing', 'form', 'table', 'chart']
  const matchedTypes = appTypes.filter(t => new RegExp('\\b' + t + '\\b').test(lower))
  if (matchedTypes.length >= 4) {
    return {
      category: 'mission-complex',
      severity: 'high',
      title: 'Mission too complex',
      message: `The mission mentions ${matchedTypes.length} different app types (${matchedTypes.slice(0, 4).join(', ')}...). One build can\'t do all of them well.`,
      suggestions: [
        'Pick ONE app type and build it well.',
        'Build the others in separate missions.',
      ],
      canRetry: false,
      retryDelayMs: 0,
    }
  }

  return null
}

// ── Mission simplification ──

/**
 * Simplify a mission for retry by stripping out feature requests.
 * Tries to keep the core app type and one or two key features.
 *
 * Strategy:
 * 1. Take the first sentence (everything up to . ; or newline)
 * 2. Take the part before the first "with" / "and" / "including" / "plus"
 * 3. Truncate to 200 chars max
 */
export function simplifyMission(mission: string): string {
  const trimmed = (mission ?? '').trim()
  if (!trimmed) return trimmed

  // Take the first sentence/clause
  const firstClause = trimmed.split(/[.;\n]/)[0] ?? trimmed

  // Cut at the first feature-list separator
  const cut = firstClause.split(/\s+(?:with|and|including|plus|also|that has|that have|featuring)\s+/i)[0] ?? firstClause

  // Truncate to 200 chars (at word boundary)
  let result = cut.trim()
  if (result.length > 200) {
    const slice = result.slice(0, 200)
    const lastSpace = slice.lastIndexOf(' ')
    result = (lastSpace > 100 ? slice.slice(0, lastSpace) : slice).trim() + '...'
  }

  return result || trimmed
}

// ── Related missions ──

/**
 * Suggest 3 alternative missions related to the given mission.
 * Used when a build fails repeatedly — give the user a different direction.
 *
 * Strategy:
 * - Detect the app type (game, todo, calculator, etc.)
 * - Suggest 3 missions of the same type but with different specific features
 */
export function suggestRelatedMissions(mission: string): string[] {
  const lower = (mission ?? '').toLowerCase()

  if (lower.includes('snake') || lower.includes('game')) {
    return [
      'Build a Pong game with two paddles and a bouncing ball',
      'Build a memory matching game with a 4x4 card grid',
      'Build a Tetris-style block game with line clearing',
    ]
  }
  if (lower.includes('todo') || lower.includes('task')) {
    return [
      'Build a sticky notes app with colorful draggable notes',
      'Build a habit tracker with weekly streaks',
      'Build a Kanban board with three columns (To Do, Doing, Done)',
    ]
  }
  if (lower.includes('calc')) {
    return [
      'Build a tip calculator with bill split and percentage slider',
      'Build a unit converter for length, weight, and temperature',
      'Build a BMI calculator with metric and imperial units',
    ]
  }
  if (lower.includes('clock') || lower.includes('timer') || lower.includes('stopwatch')) {
    return [
      'Build a pomodoro timer with 25/5 minute cycles and a start/pause button',
      'Build a world clock showing 4 different timezones',
      'Build a countdown timer to a specific date',
    ]
  }
  if (lower.includes('color') || lower.includes('palette')) {
    return [
      'Build a random color generator with hex display and copy button',
      'Build a gradient maker with two color pickers',
      'Build a color picker that shows complementary colors',
    ]
  }
  if (lower.includes('markdown') || lower.includes('editor') || lower.includes('text')) {
    return [
      'Build a markdown editor with live preview',
      'Build a rich text editor with bold, italic, and heading buttons',
      'Build a code snippet editor with syntax highlighting',
    ]
  }
  // Generic fallback
  return [
    'Build a snake game with score and game-over screen',
    'Build a todo app with add, complete, and delete',
    'Build a calculator with keyboard support',
  ]
}

// ── Internal constants ──

const FILLER_WORDS = new Set([
  'build', 'make', 'create', 'please', 'want', 'need', 'something', 'thing',
  'app', 'application', 'simple', 'basic', 'nice', 'good', 'cool', 'awesome',
])

const FILLER_PHRASES = [
  'build something',
  'make something',
  'build a thing',
  'make a thing',
  'build an app',
  'make an app',
  'build a cool app',
  'make a cool app',
]
