// Model Circuit Breaker — tracks LLM failures and enables fallback.
// When a model fails consecutively, it's temporarily disabled.

export type ModelId = 'z-ai'

interface ModelHealth {
  consecutiveFailures: number
  lastFailureTime: number
  lastError: string
  totalRequests: number
  totalFailures: number
  disabledUntil: number
}

const THRESHOLD = 5
const RESET_MS = 2 * 60 * 1000

const health: Record<ModelId, ModelHealth> = {
  'z-ai': { consecutiveFailures: 0, lastFailureTime: 0, lastError: '', totalRequests: 0, totalFailures: 0, disabledUntil: 0 },
}

export function isModelAvailable(model: ModelId): boolean {
  const h = health[model]
  if (h.disabledUntil > Date.now()) return false
  if (h.disabledUntil > 0 && h.disabledUntil <= Date.now()) {
    h.consecutiveFailures = 0
    h.disabledUntil = 0
  }
  return true
}

export function recordSuccess(model: ModelId): void {
  health[model].consecutiveFailures = 0
  health[model].totalRequests++
}

export function recordFailure(model: ModelId, error: string): void {
  const h = health[model]
  h.consecutiveFailures++
  h.totalFailures++
  h.totalRequests++
  h.lastFailureTime = Date.now()
  h.lastError = error
  if (h.consecutiveFailures >= THRESHOLD) {
    h.disabledUntil = Date.now() + RESET_MS
    console.warn(`[CircuitBreaker] ${model} disabled for ${RESET_MS / 1000}s after ${h.consecutiveFailures} failures: ${error}`)
  }
}

export function getHealthStats() {
  return { 'z-ai': { ...health['z-ai'], available: isModelAvailable('z-ai') } }
}
