// Pure functions for extracting build steps from architect plans and missions.
// These are testable without a DOM environment.

export interface BuildPlan {
  type?: string
  title?: string
  features?: string[]
  /** v26: architect returns key_features (with underscore) */
  key_features?: string[]
  approach?: string
  colors?: { bg?: string; primary?: string; accent?: string }
  layout?: string
  keyFunctions?: string[]
  /** v26: architect returns key_functions (with underscore) */
  key_functions?: string[]
}

/**
 * Extract human-readable build steps from a mission string.
 * This is used BEFORE the architect returns — gives immediate feedback.
 *
 * Analyzes the mission text to infer what steps are needed:
 * - "game" → game loop, scoring, collision
 * - "todo" → add, complete, delete
 * - "calculator" → buttons, display, operations
 * - etc.
 */
export function extractStepsFromMission(mission: string): string[] {
  const steps: string[] = ['Analyzing your request...']
  const lower = mission.toLowerCase()

  // Detect app type and add relevant steps
  if (lower.includes('snake') || lower.includes('game')) {
    steps.push('Planning game mechanics...')
    steps.push('Designing the game board...')
    steps.push('Building the game loop...')
    steps.push('Adding snake movement & collision...')
    steps.push('Implementing scoring system...')
    steps.push('Adding game-over & restart...')
    steps.push('Styling the game UI...')
  } else if (lower.includes('todo') || lower.includes('task')) {
    steps.push('Planning the task structure...')
    steps.push('Building the input form...')
    steps.push('Adding task list display...')
    steps.push('Implementing add/complete/delete...')
    steps.push('Adding filters (all/active/completed)...')
    steps.push('Styling the todo UI...')
  } else if (/\bcalc(ulator)?\b/.test(lower)) {
    steps.push('Planning the calculator logic...')
    steps.push('Building the display & buttons...')
    steps.push('Implementing arithmetic operations...')
    steps.push('Adding keyboard support...')
    steps.push('Styling the calculator UI...')
  } else if (lower.includes('color') || lower.includes('palette')) {
    steps.push('Planning the color system...')
    steps.push('Building the color generator...')
    steps.push('Adding copy-to-clipboard...')
    steps.push('Implementing color display...')
    steps.push('Styling the palette UI...')
  } else if (lower.includes('markdown') || lower.includes('editor') || lower.includes('text')) {
    steps.push('Planning the editor layout...')
    steps.push('Building the text input area...')
    steps.push('Implementing markdown parsing...')
    steps.push('Adding live preview...')
    steps.push('Styling the editor UI...')
  } else if (lower.includes('clock') || lower.includes('timer') || lower.includes('stopwatch')) {
    steps.push('Planning the time logic...')
    steps.push('Building the display...')
    steps.push('Implementing start/stop/reset...')
    steps.push('Adding time formatting...')
    steps.push('Styling the timer UI...')
  } else if (lower.includes('weather')) {
    steps.push('Planning the weather display...')
    steps.push('Building the layout...')
    steps.push('Adding mock weather data...')
    steps.push('Styling the weather UI...')
  } else if (lower.includes('music') || lower.includes('player')) {
    steps.push('Planning the music player...')
    steps.push('Building the playback controls...')
    steps.push('Adding playlist display...')
    steps.push('Styling the music UI...')
  } else {
    // Generic steps
    steps.push('Planning the architecture...')
    steps.push('Designing the UI layout...')
    steps.push('Building HTML structure...')
    steps.push('Styling with CSS...')
    steps.push('Adding JavaScript logic...')
    steps.push('Implementing interactivity...')
  }

  steps.push('Finalizing the code...')

  return steps
}

/**
 * Extract steps from an architect plan (if available).
 * Falls back to mission-based steps if plan is missing.
 */
export function extractStepsFromPlan(plan: unknown, mission: string): string[] {
  const missionSteps = extractStepsFromMission(mission)

  if (!plan || typeof plan !== 'object') {
    return missionSteps
  }

  const p = plan as BuildPlan
  const steps: string[] = ['Analyzing your request...']

  // Show the architect's decision
  if (p.title) {
    steps.push(`Architect decided: ${p.title}`)
  } else {
    steps.push('Planning the architecture...')
  }

  if (p.layout) {
    const layoutStr = String(p.layout)
    const truncated = layoutStr.slice(0, 60)
    steps.push(`Layout: ${truncated}${layoutStr.length > 60 ? '...' : ''}`)
  }

  // Add feature-based steps (with type guard — features could contain non-strings)
  // v26: Handle both 'features' and 'key_features' (architect returns key_features)
  // v29.37: Features can be objects with 'name' property — extract name instead of String(object)
  const features = p.features || p.key_features
  if (features && Array.isArray(features) && features.length > 0) {
    for (const f of features.slice(0, 5)) {
      let featureName: string
      if (typeof f === 'string') {
        featureName = f
      } else if (f && typeof f === 'object' && typeof (f as Record<string, unknown>).name === 'string') {
        featureName = (f as Record<string, unknown>).name as string
      } else {
        featureName = String(f)
      }
      steps.push(`Building: ${featureName}...`)
    }
  } else {
    // Fall back to mission-based feature steps
    for (let i = 2; i < missionSteps.length - 1; i++) {
      steps.push(missionSteps[i])
    }
  }

  // Key functions (with type guard)
  if (p.keyFunctions && Array.isArray(p.keyFunctions) && p.keyFunctions.length > 0) {
    for (const f of p.keyFunctions.slice(0, 3)) {
      steps.push(`Implementing: ${typeof f === 'string' ? f : String(f)}...`)
    }
  }

  steps.push('Finalizing the code...')

  return steps
}

/**
 * Get a summary of the plan for display.
 * Returns a short string like "Snake Game · game · 3 features"
 */
export function getPlanSummary(plan: unknown): string | null {
  if (!plan || typeof plan !== 'object') return null
  const p = plan as BuildPlan
  const parts: string[] = []
  if (p.title) parts.push(p.title)
  if (p.type) parts.push(p.type)
  if (p.features && Array.isArray(p.features)) parts.push(`${p.features.length} features`)
  return parts.length > 0 ? parts.join(' · ') : null
}
