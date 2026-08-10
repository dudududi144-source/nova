// Model Circuit Breaker — tracks LLM failures and enables fallback.
// When a model fails consecutively, it's temporarily disabled.
//
// Supports multiple models: 'z-ai' (primary, via z-ai-web-dev-sdk) and
// 'tokenrouter' (secondary, via TokenRouter/Kimi K3). The fallback executor
// (llm-fallback.ts) checks availability before each call.

export type ModelId = 'z-ai' | 'tokenrouter'

interface ModelHealth {
  consecutiveFailures: number
  lastFailureTime: number
  lastError: string
  totalRequests: number
  totalFailures: number
  disabledUntil: number
}

const THRESHOLD = 3 // v29.79: Lowered from 5 — 3 failures is enough to trip
const RESET_MS = 2 * 60 * 1000

function freshHealth(): ModelHealth {
  return { consecutiveFailures: 0, lastFailureTime: 0, lastError: '', totalRequests: 0, totalFailures: 0, disabledUntil: 0 }
}

const health: Record<ModelId, ModelHealth> = {
  'z-ai': freshHealth(),
  'tokenrouter': freshHealth(),
}

export function isModelAvailable(model: ModelId): boolean {
  const h = health[model]
  if (!h) return true
  if (h.disabledUntil > Date.now()) return false
  if (h.disabledUntil > 0 && h.disabledUntil <= Date.now()) {
    h.consecutiveFailures = 0
    h.disabledUntil = 0
  }
  return true
}

export function recordSuccess(model: ModelId): void {
  const h = health[model]
  if (!h) return
  h.consecutiveFailures = 0
  h.totalRequests++
}

export function recordFailure(model: ModelId, error: string): void {
  const h = health[model]
  if (!h) return
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
  return {
    'z-ai': { ...health['z-ai'], available: isModelAvailable('z-ai') },
    'tokenrouter': { ...health['tokenrouter'], available: isModelAvailable('tokenrouter') },
  }
}
