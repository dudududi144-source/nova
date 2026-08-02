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
  /** Optional: multi-file output (when LLM emits multiple files instead of single HTML).
   *  Populated by the SSE result handler when the server returns evt.files. */
  files?: { path: string; content: string; language: string }[]
  /** Optional: detected output type (e.g. 'html-app', 'html-multi', 'react', 'python'). */
  outputType?: string
  /** Optional: whether this build can be previewed in NOVA's sandboxed iframe.
   *  false for non-HTML outputs (React/Python/Node) — show FileViewer instead. */
  previewable?: boolean
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
// Dedupes by id (in case localStorage was hand-edited or two tabs raced).
export function validateHistory(stored: unknown): BuildResult[] {
  if (!Array.isArray(stored)) return []
  const seen = new Set<string>()
  return stored
    .filter(isValidHistoryItem)
    .filter(h => {
      if (seen.has(h.id)) return false
      seen.add(h.id)
      return true
    })
    .slice(0, 10)
}
