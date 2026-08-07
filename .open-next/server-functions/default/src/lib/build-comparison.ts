// v19: Build comparison summary — plain-text stats comparing two builds
// Shows what changed between versions in a human-readable format

export interface ComparisonSummary {
  addedLines: number
  removedLines: number
  sizeChange: number // bytes
  sizeChangePercent: number
  qualityChange: number // quality score delta
  timeChange: number // ms delta
  isImprovement: boolean
  summary: string
}

export function compareBuilds(
  oldBuild: { html: string; quality?: number; ms?: number; mission: string },
  newBuild: { html: string; quality?: number; ms?: number; mission: string },
): ComparisonSummary {
  const oldLines = oldBuild.html.split('\n')
  const newLines = newBuild.html.split('\n')

  // Simple line-based diff count
  const oldSet = new Set(oldLines)
  const newSet = new Set(newLines)
  const addedLines = newLines.filter(l => !oldSet.has(l)).length
  const removedLines = oldLines.filter(l => !newSet.has(l)).length

  const oldSize = oldBuild.html.length
  const newSize = newBuild.html.length
  const sizeChange = newSize - oldSize
  const sizeChangePercent = oldSize > 0 ? Math.round((sizeChange / oldSize) * 100) : 0

  const oldQuality = oldBuild.quality ?? 0
  const newQuality = newBuild.quality ?? 0
  const qualityChange = newQuality - oldQuality

  const oldMs = oldBuild.ms ?? 0
  const newMs = newBuild.ms ?? 0
  const timeChange = newMs - oldMs

  const isImprovement = qualityChange > 0 || (qualityChange === 0 && sizeChange > 0)

  // Build human-readable summary
  const parts: string[] = []
  if (qualityChange > 0) parts.push(`Quality improved by ${qualityChange} points (Q:${oldQuality} → Q:${newQuality})`)
  else if (qualityChange < 0) parts.push(`Quality dropped by ${Math.abs(qualityChange)} points (Q:${oldQuality} → Q:${newQuality})`)
  else parts.push(`Quality unchanged (Q:${newQuality})`)

  if (addedLines > 0 && removedLines > 0) parts.push(`${addedLines} lines added, ${removedLines} removed`)
  else if (addedLines > 0) parts.push(`${addedLines} lines added`)
  else if (removedLines > 0) parts.push(`${removedLines} lines removed`)

  if (sizeChange !== 0) {
    const sign = sizeChange > 0 ? '+' : ''
    parts.push(`Size ${sign}${(sizeChange / 1024).toFixed(1)}KB (${sizeChangePercent > 0 ? '+' : ''}${sizeChangePercent}%)`)
  }

  if (timeChange !== 0) {
    const sign = timeChange > 0 ? '+' : ''
    parts.push(`Build time ${sign}${(timeChange / 1000).toFixed(1)}s`)
  }

  return {
    addedLines,
    removedLines,
    sizeChange,
    sizeChangePercent,
    qualityChange,
    timeChange,
    isImprovement,
    summary: parts.join(' · '),
  }
}
