// v20: Build stats tracking — persists build statistics across sessions in localStorage.
// Tracks: total builds, average quality, best/worst builds, model usage, time stats.

export interface BuildStats {
  totalBuilds: number
  totalRefines: number
  avgQuality: number
  bestQuality: number
  worstQuality: number
  bestMission: string | null
  worstMission: string | null
  totalTimeMs: number
  avgTimeMs: number
  totalTokens: number
  modelUsage: { 'z-ai': number; qwen: number; kimi: number }
  lastBuildAt: number | null
  firstBuildAt: number | null
}

const STORAGE_KEY = 'nova_build_stats'

const EMPTY_STATS: BuildStats = {
  totalBuilds: 0,
  totalRefines: 0,
  avgQuality: 0,
  bestQuality: 0,
  worstQuality: 0,
  bestMission: null,
  worstMission: null,
  totalTimeMs: 0,
  avgTimeMs: 0,
  totalTokens: 0,
  modelUsage: { 'z-ai': 0, qwen: 0, kimi: 0 },
  lastBuildAt: null,
  firstBuildAt: null,
}

export function loadBuildStats(): BuildStats {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (!stored) return { ...EMPTY_STATS }
    const parsed = JSON.parse(stored)
    // Merge with defaults to handle new fields added in future versions
    return { ...EMPTY_STATS, ...parsed, modelUsage: { ...EMPTY_STATS.modelUsage, ...(parsed.modelUsage || {}) } }
  } catch {
    return { ...EMPTY_STATS }
  }
}

export function saveBuildStats(stats: BuildStats): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stats))
  } catch {
    // localStorage might be full or unavailable — silently ignore
  }
}

export function recordBuildInStats(
  current: BuildStats,
  build: {
    quality?: number
    ms?: number
    tokens?: number
    mission: string
    model?: 'z-ai' | 'qwen' | 'kimi'
  },
): BuildStats {
  const quality = build.quality ?? 0
  const ms = build.ms ?? 0
  const tokens = build.tokens ?? 0
  const model = build.model ?? 'z-ai'
  const now = Date.now()

  const totalBuilds = current.totalBuilds + 1
  const totalQuality = current.avgQuality * current.totalBuilds + quality
  const totalTimeMs = current.totalTimeMs + ms
  const totalTokens = current.totalTokens + tokens

  const isNewBest = quality > current.bestQuality
  const isNewWorst = current.totalBuilds === 0 || quality < current.worstQuality

  return {
    totalBuilds,
    totalRefines: current.totalRefines,
    avgQuality: Math.round(totalQuality / totalBuilds),
    bestQuality: isNewBest ? quality : current.bestQuality,
    worstQuality: isNewWorst ? quality : current.worstQuality,
    bestMission: isNewBest ? build.mission : current.bestMission,
    worstMission: isNewWorst ? build.mission : current.worstMission,
    totalTimeMs,
    avgTimeMs: Math.round(totalTimeMs / totalBuilds),
    totalTokens,
    modelUsage: {
      ...current.modelUsage,
      [model]: (current.modelUsage[model] || 0) + 1,
    },
    lastBuildAt: now,
    firstBuildAt: current.firstBuildAt ?? now,
  }
}

export function recordRefineInStats(current: BuildStats): BuildStats {
  return {
    ...current,
    totalRefines: current.totalRefines + 1,
  }
}

export function resetBuildStats(): BuildStats {
  saveBuildStats({ ...EMPTY_STATS })
  return { ...EMPTY_STATS }
}

// Format stats for display
export function formatStats(stats: BuildStats): {
  summary: string
  details: { label: string; value: string }[]
} {
  const details: { label: string; value: string }[] = []

  details.push({ label: 'Total builds', value: String(stats.totalBuilds) })
  if (stats.totalRefines > 0) {
    details.push({ label: 'Total refines', value: String(stats.totalRefines) })
  }
  details.push({ label: 'Avg quality', value: `Q:${stats.avgQuality}` })
  if (stats.bestQuality > 0) {
    details.push({ label: 'Best quality', value: `Q:${stats.bestQuality}` })
  }
  if (stats.worstQuality > 0 && stats.worstQuality < 100) {
    details.push({ label: 'Worst quality', value: `Q:${stats.worstQuality}` })
  }
  if (stats.avgTimeMs > 0) {
    details.push({ label: 'Avg build time', value: `${(stats.avgTimeMs / 1000).toFixed(0)}s` })
  }
  if (stats.totalTokens > 0) {
    details.push({ label: 'Total tokens', value: formatTokens(stats.totalTokens) })
  }

  // Model usage
  const models = Object.entries(stats.modelUsage)
    .filter(([, count]) => count > 0)
    .map(([model, count]) => `${model === 'z-ai' ? 'Z.AI' : model === 'qwen' ? 'Qwen' : 'Kimi'}: ${count}`)
  if (models.length > 0) {
    details.push({ label: 'Model usage', value: models.join(', ') })
  }

  // Session duration
  if (stats.firstBuildAt && stats.lastBuildAt) {
    const spanMs = stats.lastBuildAt - stats.firstBuildAt
    const spanMin = Math.round(spanMs / 60000)
    if (spanMin > 0) {
      details.push({ label: 'Active span', value: `${spanMin}min` })
    }
  }

  const summary = `${stats.totalBuilds} builds · avg Q:${stats.avgQuality}`
  return { summary, details }
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(n)
}
