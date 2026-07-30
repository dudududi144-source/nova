// Utility functions stolen from TFA Evolution Studio and improved.
// These are pure functions for formatting and stage management.

// ── Formatting ──

export function formatTokens(n: number): string {
  if (n < 1000) return String(n)
  if (n < 1000000) return `${(n / 1000).toFixed(1)}k`
  return `${(n / 1000000).toFixed(1)}M`
}

export function formatMs(ms: number | null | undefined): string {
  if (!ms || ms === 0) return '—'
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`
}

export function formatBytes(b: number): string {
  if (b < 1024) return `${b}B`
  if (b < 1048576) return `${(b / 1024).toFixed(1)}KB`
  return `${(b / 1048576).toFixed(1)}MB`
}

export function timeAgo(iso: string | number): string {
  const diff = Date.now() - new Date(iso).getTime()
  const s = Math.floor(diff / 1000)
  if (s < 60) return 'just now'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

// ── Build Stage System ──
// Stolen from TFA's stageProgress concept, adapted for NOVA's 2-stage pipeline.
// Each stage has: label, short label, progress percentage, color.

export interface BuildStage {
  key: string
  label: string
  short: string
  progress: number  // 0-100
}

export const BUILD_STAGES: readonly BuildStage[] = [
  { key: 'architect_start', label: 'Architect analyzing', short: 'Plan', progress: 10 },
  { key: 'architect_done', label: 'Plan ready', short: 'Plan', progress: 25 },
  { key: 'code_start', label: 'Generating code', short: 'Code', progress: 35 },
  { key: 'code_streaming', label: 'Streaming tokens', short: 'Stream', progress: 60 },
  { key: 'code_done', label: 'Code complete', short: 'Code', progress: 80 },
  { key: 'validating', label: 'Validating quality', short: 'QA', progress: 90 },
  { key: 'complete', label: 'Build complete', short: 'Done', progress: 100 },
]

export function getCurrentStage(elapsed: number, hasPlan: boolean, isStreaming: boolean, isComplete: boolean): BuildStage {
  if (isComplete) return BUILD_STAGES[6]
  if (isStreaming) return BUILD_STAGES[3]
  if (hasPlan) return BUILD_STAGES[4] // plan done, code started but not streaming yet
  if (elapsed > 3) return BUILD_STAGES[1] // architect probably done
  return BUILD_STAGES[0]
}

export function getStageProgress(elapsed: number, hasPlan: boolean, isStreaming: boolean, isComplete: boolean): number {
  return getCurrentStage(elapsed, hasPlan, isStreaming, isComplete).progress
}
