// Mission validation — pure function, no LLM dependencies.
//
// Separated from llm.ts so that mocking the LLM module (for route tests)
// does NOT break mission validation logic.

/**
 * Validate a mission string.
 * Checks: non-empty, length 3-5000, no control characters (including DEL and
 * extended control chars in the C1 set \x80-\x9F).
 * Returns { ok: true } or { ok: false, error: string }.
 */
export function validateMission(mission: string): { ok: boolean; error?: string } {
  if (!mission || !mission.trim()) return { ok: false, error: 'Mission is empty' }
  const trimmed = mission.trim()
  if (trimmed.length < 3) return { ok: false, error: 'Mission too short (min 3 chars)' }
  if (trimmed.length > 5000) return { ok: false, error: `Mission too long (max 5000 chars, got ${trimmed.length})` }
  // Block C0 control chars (except tab \x09, newline \x0A, carriage return \x0D),
  // DEL (\x7F), and C1 extended control chars (\x80-\x9F)
  if (/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F\x80-\x9F]/.test(trimmed)) {
    return { ok: false, error: 'Mission contains invalid characters' }
  }
  return { ok: true }
}
