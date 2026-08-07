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

  // Check features array (v26: handle both 'features' and 'key_features')
  // v29.36: Features can be strings OR objects with 'name' property
  const featuresList = Array.isArray(p.features) ? p.features : (Array.isArray(p.key_features) ? p.key_features : [])
  if (featuresList.length > 0) {
    for (const feature of featuresList) {
      // v29.36: Handle both string and object features
      let featureName: string
      if (typeof feature === 'string') {
        featureName = feature
      } else if (feature && typeof feature === 'object' && typeof (feature as Record<string, unknown>).name === 'string') {
        featureName = (feature as Record<string, unknown>).name as string
      } else {
        continue
      }
      const featureLower = featureName.toLowerCase()

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
        name: featureName,
        found,
        detail: found
          ? `Found (${foundWords.length}/${words.length} keywords)`
          : `Missing (${foundWords.length}/${words.length} keywords: ${words.slice(0, 5).join(', ')})`,
      })
    }
  }

  // Check keyFunctions (v29.36: handle objects too)
  if (Array.isArray(p.keyFunctions) || Array.isArray(p.key_functions)) {
    const fnList = (Array.isArray(p.keyFunctions) ? p.keyFunctions : p.key_functions) as unknown[]
    for (const fn of fnList) {
      let fnName: string
      if (typeof fn === 'string') {
        fnName = fn
      } else if (fn && typeof fn === 'object' && typeof (fn as Record<string, unknown>).name === 'string') {
        fnName = (fn as Record<string, unknown>).name as string
      } else {
        continue
      }
      const fnLower = fnName.toLowerCase()
      const words = fnLower.split(/[\s,.-]+/).filter(w => w.length > 3 && !COMMON_WORDS.has(w))
      const foundWords = words.filter(w => lower.includes(w))
      const ratio = words.length > 0 ? foundWords.length / words.length : 1
      const found = ratio >= 0.4 // Lower threshold for functions (names may differ)

      features.push({
        name: `Function: ${fnName}`,
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
