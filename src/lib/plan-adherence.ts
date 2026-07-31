// Plan adherence check — verifies that the generated HTML implements all features
// from the architect's plan.
//
// After the coder returns HTML, this module checks each feature from the plan against
// the HTML. If a feature is missing, it generates a targeted retry hint — not a generic
// "improve quality" but "you're missing the 'filter tabs' feature from the plan."
//
// This addresses the problem that the architect's plan was decorative — NOVA never
// verified the coder actually implemented the listed features.

export interface PlanFeature {
  name: string
  found: boolean
  detail: string
}

export interface PlanAdherenceResult {
  adherent: boolean  // true if all features found
  features: PlanFeature[]
  missingFeatures: string[]
  hint: string | null  // retry hint if features are missing
}

/**
 * Check if the generated HTML implements all features from the architect's plan.
 *
 * @param html The generated HTML
 * @param plan The architect's plan (object with features array)
 * @returns PlanAdherenceResult with per-feature status and retry hint
 */
export function checkPlanAdherence(html: string, plan: unknown): PlanAdherenceResult {
  const features: PlanFeature[] = []

  if (!plan || typeof plan !== 'object') {
    return { adherent: true, features: [], missingFeatures: [], hint: null }
  }

  const p = plan as Record<string, unknown>
  const lower = html.toLowerCase()

  // Check features array
  if (Array.isArray(p.features)) {
    for (const feature of p.features) {
      if (typeof feature !== 'string') continue
      const featureLower = feature.toLowerCase()

      // Strategy: check if key words from the feature description appear in the HTML
      // Extract significant words (skip common words)
      const words = featureLower
        .split(/[\s,.-]+/)
        .filter(w => w.length > 3 && !COMMON_WORDS.has(w))

      // Feature is "found" if at least 50% of its significant words appear in the HTML
      const foundWords = words.filter(w => lower.includes(w))
      const ratio = words.length > 0 ? foundWords.length / words.length : 1
      const found = ratio >= 0.5

      features.push({
        name: feature,
        found,
        detail: found
          ? `Found (${foundWords.length}/${words.length} keywords)`
          : `Missing (${foundWords.length}/${words.length} keywords: ${words.slice(0, 5).join(', ')})`,
      })
    }
  }

  // Check keyFunctions
  if (Array.isArray(p.keyFunctions)) {
    for (const fn of p.keyFunctions) {
      if (typeof fn !== 'string') continue
      const fnLower = fn.toLowerCase()
      const words = fnLower.split(/[\s,.-]+/).filter(w => w.length > 3 && !COMMON_WORDS.has(w))
      const foundWords = words.filter(w => lower.includes(w))
      const ratio = words.length > 0 ? foundWords.length / words.length : 1
      const found = ratio >= 0.4 // Lower threshold for functions (names may differ)

      features.push({
        name: `Function: ${fn}`,
        found,
        detail: found
          ? `Found (${foundWords.length}/${words.length} keywords)`
          : `Missing (${foundWords.length}/${words.length} keywords)`,
      })
    }
  }

  // Check title
  if (typeof p.title === 'string' && p.title.length > 2) {
    const titleLower = p.title.toLowerCase()
    const found = lower.includes(titleLower) || lower.includes(titleLower.slice(0, 10))
    features.push({
      name: `Title: ${p.title}`,
      found,
      detail: found ? 'Title found in HTML' : 'Title not found in HTML',
    })
  }

  const missingFeatures = features.filter(f => !f.found).map(f => f.name)
  const adherent = missingFeatures.length === 0

  // Generate hint if features are missing
  let hint: string | null = null
  if (missingFeatures.length > 0) {
    hint = `The generated app is missing these features from the plan:\n${missingFeatures.map(f => `- ${f}`).join('\n')}\n\nAdd these features to the HTML.`
  }

  return { adherent, features, missingFeatures, hint }
}

const COMMON_WORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'have', 'will', 'your',
  'are', 'was', 'but', 'not', 'all', 'can', 'use', 'add', 'get', 'set',
  'with', 'when', 'what', 'how', 'why', 'who', 'into', 'than', 'then', 'them',
  'they', 'their', 'there', 'where', 'which', 'while', 'about', 'after',
  'before', 'between', 'through', 'during', 'should', 'would', 'could',
  'feature', 'function', 'button', 'display', 'show', 'input', 'output',
])
