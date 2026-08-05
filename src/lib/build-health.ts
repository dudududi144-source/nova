// v17: Build health grade — combines quality, completeness, and time into a single rating.
// A = excellent (Q≥85, no missing features, <3min)
// B = good (Q≥70, ≤2 missing features, <5min)
// C = acceptable (Q≥50, ≤4 missing features, <8min)
// D = poor (Q<50, or >5 missing features, or >8min)

export type HealthGrade = 'A' | 'B' | 'C' | 'D'

export interface BuildHealth {
  grade: HealthGrade
  label: string
  color: string // tailwind text color class
  bgColor: string // tailwind bg color class
  reasons: string[]
}

export function calculateBuildHealth(params: {
  quality: number
  missingFeatures: number
  staticErrors: number
  buildTimeMs: number
  truncated: boolean
}): BuildHealth {
  const { quality, missingFeatures, staticErrors, buildTimeMs, truncated } = params
  const buildTimeMin = buildTimeMs / 1000 / 60
  const reasons: string[] = []

  // Truncation is an automatic D
  if (truncated) {
    reasons.push('Output was truncated')
    return { grade: 'D', label: 'Poor', color: 'text-red-400', bgColor: 'bg-red-500/20', reasons }
  }

  // Calculate score components
  let score = 0
  score += quality // 0-100
  score -= missingFeatures * 10 // each missing feature deducts 10
  score -= staticErrors * 15 // each static error deducts 15
  if (buildTimeMin > 5) score -= (buildTimeMin - 5) * 5 // slow builds lose points

  if (quality >= 85 && missingFeatures === 0 && staticErrors === 0 && buildTimeMin <= 3) {
    if (quality >= 85) reasons.push(`High quality (Q:${quality})`)
    if (missingFeatures === 0) reasons.push('All planned features present')
    if (buildTimeMin <= 3) reasons.push(`Fast build (${buildTimeMin.toFixed(1)}min)`)
    return { grade: 'A', label: 'Excellent', color: 'text-emerald-400', bgColor: 'bg-emerald-500/20', reasons }
  }

  if (quality >= 70 && missingFeatures <= 2 && staticErrors <= 1 && buildTimeMin <= 5) {
    if (quality >= 70) reasons.push(`Good quality (Q:${quality})`)
    if (missingFeatures > 0) reasons.push(`${missingFeatures} feature(s) missing`)
    if (staticErrors > 0) reasons.push(`${staticErrors} static error(s)`)
    return { grade: 'B', label: 'Good', color: 'text-blue-400', bgColor: 'bg-blue-500/20', reasons }
  }

  if (quality >= 50 && missingFeatures <= 4 && staticErrors <= 3 && buildTimeMin <= 8) {
    if (quality < 70) reasons.push(`Fair quality (Q:${quality})`)
    if (missingFeatures > 2) reasons.push(`${missingFeatures} features missing`)
    if (staticErrors > 1) reasons.push(`${staticErrors} static errors`)
    if (buildTimeMin > 5) reasons.push(`Slow build (${buildTimeMin.toFixed(1)}min)`)
    return { grade: 'C', label: 'Acceptable', color: 'text-amber-400', bgColor: 'bg-amber-500/20', reasons }
  }

  // D grade
  if (quality < 50) reasons.push(`Low quality (Q:${quality})`)
  if (missingFeatures > 4) reasons.push(`${missingFeatures} features missing`)
  if (staticErrors > 2) reasons.push(`${staticErrors} static errors`)
  if (buildTimeMin > 8) reasons.push(`Very slow build (${buildTimeMin.toFixed(1)}min)`)
  if (reasons.length === 0) reasons.push('Multiple issues detected')

  return { grade: 'D', label: 'Poor', color: 'text-red-400', bgColor: 'bg-red-500/20', reasons }
}
