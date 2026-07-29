// Pure functions extracted from page.tsx for testing.
// These are duplicated here because page.tsx is a client component ('use client')
// and can't be imported in test files without a DOM environment.
// If page.tsx changes these functions, update here and the test will catch drift.

export interface BuildResult {
  id: string
  html: string
  tokens: number
  ms: number
  mission: string
}

export function newBuildId(): string {
  return `b_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`
}

// Sanitize a mission string into a safe filename.
// Rules: alphanumeric only, collapse consecutive non-alphanumeric to single dash,
// trim leading/trailing dashes, lowercase, max 30 chars, fallback to 'app'.
export function sanitizeFilename(mission: string): string {
  const rawName = mission
    .slice(0, 30)
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
  return `${rawName || 'app'}.html`
}

// Validate localStorage history items — defend against corrupted/partial data.
export function isValidHistoryItem(h: unknown): h is BuildResult {
  if (typeof h !== 'object' || h === null) return false
  const item = h as Record<string, unknown>
  return (
    typeof item.id === 'string' &&
    typeof item.html === 'string' &&
    typeof item.tokens === 'number' &&
    typeof item.ms === 'number' &&
    typeof item.mission === 'string'
  )
}

// Filter and validate a history array from localStorage.
export function validateHistory(stored: unknown): BuildResult[] {
  if (!Array.isArray(stored)) return []
  return stored.filter(isValidHistoryItem).slice(0, 10)
}
