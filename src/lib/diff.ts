// Line-based diff engine — LCS (Longest Common Subsequence) algorithm.
//
// Used by NOVA to show users what changed between two builds (e.g. before/after
// a refine), or to detect whether a retry actually improved the output.
//
// The algorithm is the classic LCS dynamic-programming approach, restricted to
// line-level granularity (fast and good enough for HTML/JS comparison).
//
// To prevent pathological inputs (e.g. a 50,000-line minified bundle) from
// hanging the server, MAX_LINES caps the comparison. Beyond the cap, we fall
// back to a naive line-by-line diff (no LCS) so the function always returns.

import type { BuildResult } from './helpers'

// ── Types ──

export type DiffLineType = 'added' | 'removed' | 'unchanged' | 'context'

/** A single line in a diff. */
export interface DiffLine {
  type: DiffLineType
  /** Line number in the OLD text (1-based), or null if the line was added. */
  oldLineNumber: number | null
  /** Line number in the NEW text (1-based), or null if the line was removed. */
  newLineNumber: number | null
  /** The line content (without trailing newline). */
  content: string
}

/** Result of a diff operation. */
export interface DiffResult {
  lines: DiffLine[]
  stats: { added: number; removed: number; unchanged: number }
  /** One-line summary, e.g. "+12 -5 (3 unchanged)". */
  summary: string
  /** True if the two texts are identical (no added/removed lines). */
  identical: boolean
  /** True if the diff was truncated due to MAX_LINES. */
  truncated: boolean
}

// ── Constants ──

/** Maximum number of lines to compare with LCS. Beyond this, naive diff is used. */
export const MAX_LINES = 1000

// ── Core diff function ──

/**
 * Compute a line-based diff between two strings using LCS.
 *
 * The LCS table is O(n*m) in memory. For MAX_LINES=1000, that's 1M cells (4MB
 * as Uint32Array) — manageable. Beyond that, we fall back to a naive line-by-line
 * comparison (which is O(n) but doesn't catch reordering).
 *
 * Returns a DiffResult with all lines (added, removed, unchanged).
 */
export function diffStrings(oldText: string, newText: string): DiffResult {
  const oldLines = splitLines(oldText)
  const newLines = splitLines(newText)

  const empty: DiffResult = {
    lines: [],
    stats: { added: 0, removed: 0, unchanged: 0 },
    summary: '+0 -0 (0 unchanged)',
    identical: oldLines.length === 0 && newLines.length === 0,
    truncated: false,
  }

  if (oldLines.length === 0 && newLines.length === 0) return empty

  // Pathological case: both sides are too long → naive diff
  if (oldLines.length > MAX_LINES || newLines.length > MAX_LINES) {
    return naiveDiff(oldLines, newLines, true)
  }

  // Identical fast path
  if (oldLines.length === newLines.length && oldLines.every((l, i) => l === newLines[i])) {
    const lines: DiffLine[] = oldLines.map((content, i) => ({
      type: 'unchanged' as const,
      oldLineNumber: i + 1,
      newLineNumber: i + 1,
      content,
    }))
    return {
      lines,
      stats: { added: 0, removed: 0, unchanged: oldLines.length },
      summary: `+0 -0 (${oldLines.length} unchanged)`,
      identical: true,
      truncated: false,
    }
  }

  // LCS dynamic programming
  const m = oldLines.length
  const n = newLines.length
  // dp[i][j] = length of LCS of oldLines[0..i-1] and newLines[0..j-1]
  // Use Uint32Array for compactness (4 bytes per cell vs 8 for number[])
  const dp = new Uint32Array((m + 1) * (n + 1))
  const stride = n + 1
  for (let i = 1; i <= m; i++) {
    const oi = oldLines[i - 1]
    for (let j = 1; j <= n; j++) {
      if (oi === newLines[j - 1]) {
        dp[i * stride + j] = dp[(i - 1) * stride + (j - 1)] + 1
      } else {
        const up = dp[(i - 1) * stride + j]
        const left = dp[i * stride + (j - 1)]
        dp[i * stride + j] = up >= left ? up : left
      }
    }
  }

  // Backtrack to build the diff
  const lines: DiffLine[] = []
  let i = m, j = n
  while (i > 0 && j > 0) {
    if (oldLines[i - 1] === newLines[j - 1]) {
      lines.unshift({
        type: 'unchanged',
        oldLineNumber: i,
        newLineNumber: j,
        content: oldLines[i - 1]!,
      })
      i--; j--
    } else if (dp[(i - 1) * stride + j] >= dp[i * stride + (j - 1)]) {
      lines.unshift({
        type: 'removed',
        oldLineNumber: i,
        newLineNumber: null,
        content: oldLines[i - 1]!,
      })
      i--
    } else {
      lines.unshift({
        type: 'added',
        oldLineNumber: null,
        newLineNumber: j,
        content: newLines[j - 1]!,
      })
      j--
    }
  }
  while (i > 0) {
    lines.unshift({
      type: 'removed',
      oldLineNumber: i,
      newLineNumber: null,
      content: oldLines[i - 1]!,
    })
    i--
  }
  while (j > 0) {
    lines.unshift({
      type: 'added',
      oldLineNumber: null,
      newLineNumber: j,
      content: newLines[j - 1]!,
    })
    j--
  }

  return buildResult(lines, false)
}

/**
 * Naive line-by-line diff (no LCS).
 * Used as a fallback when inputs exceed MAX_LINES. Pairs lines by index —
 * doesn't catch reordering, but always terminates in O(n).
 */
function naiveDiff(oldLines: string[], newLines: string[], truncated: boolean): DiffResult {
  const lines: DiffLine[] = []
  const maxLen = Math.max(oldLines.length, newLines.length)
  for (let i = 0; i < maxLen; i++) {
    const oldLine = i < oldLines.length ? oldLines[i] : undefined
    const newLine = i < newLines.length ? newLines[i] : undefined
    if (oldLine === newLine && oldLine !== undefined) {
      lines.push({ type: 'unchanged', oldLineNumber: i + 1, newLineNumber: i + 1, content: oldLine })
    } else {
      if (oldLine !== undefined) {
        lines.push({ type: 'removed', oldLineNumber: i + 1, newLineNumber: null, content: oldLine })
      }
      if (newLine !== undefined) {
        lines.push({ type: 'added', oldLineNumber: null, newLineNumber: i + 1, content: newLine })
      }
    }
  }
  return buildResult(lines, truncated)
}

// ── Compact diff (with context) ──

/**
 * Compute a compact diff — only changed regions, plus N lines of context
 * around each change. This is what `git diff` shows by default.
 *
 * @param contextLines Number of unchanged lines to show around each change. Default 3.
 */
export function diffStringsCompact(oldText: string, newText: string, contextLines: number = 3): DiffResult {
  const full = diffStrings(oldText, newText)
  if (full.identical) return full

  const ctx = Math.max(0, Math.min(contextLines, 50)) // cap context at 50 lines

  // Find indices of all changed lines (added or removed)
  const changedIdx = new Set<number>()
  full.lines.forEach((line, idx) => {
    if (line.type === 'added' || line.type === 'removed') changedIdx.add(idx)
  })

  if (changedIdx.size === 0) return full

  // Expand each changed index by `ctx` lines on both sides
  const keep = new Set<number>()
  for (const idx of changedIdx) {
    const start = Math.max(0, idx - ctx)
    const end = Math.min(full.lines.length - 1, idx + ctx)
    for (let k = start; k <= end; k++) keep.add(k)
  }

  // Build the compact diff, marking context boundaries
  const compact: DiffLine[] = []
  const sorted = [...keep].sort((a, b) => a - b)
  let prevIdx = -2
  for (const idx of sorted) {
    if (idx > prevIdx + 1 && prevIdx >= -1) {
      // Gap — insert a separator marker (an "unchanged" line with no line numbers)
      compact.push({ type: 'context', oldLineNumber: null, newLineNumber: null, content: '...' })
    }
    const line = full.lines[idx]!
    // Re-classify pure unchanged context lines as 'context' for rendering
    if (line.type === 'unchanged') {
      compact.push({ ...line, type: 'context' })
    } else {
      compact.push(line)
    }
    prevIdx = idx
  }

  return {
    lines: compact,
    stats: full.stats,
    summary: full.summary,
    identical: full.identical,
    truncated: full.truncated,
  }
}

// ── Multi-file diff ──

/**
 * Compare two builds (BuildResult objects) by diffing their HTML.
 * Returns a DiffResult for the HTML content.
 */
export function diffBuilds(oldBuild: BuildResult, newBuild: BuildResult): DiffResult {
  return diffStrings(oldBuild.html, newBuild.html)
}

/**
 * Fast equality check — returns true if two builds have identical HTML.
 * Short-circuits on length difference before computing the full diff.
 */
export function buildsIdentical(oldBuild: BuildResult, newBuild: BuildResult): boolean {
  if (!oldBuild || !newBuild) return false
  if (oldBuild.html.length !== newBuild.html.length) return false
  if (oldBuild.html === newBuild.html) return true
  // Same length, different content — fall back to full diff
  return diffStrings(oldBuild.html, newBuild.html).identical
}

// ── Helpers ──

/**
 * Split text into lines. Trailing newline doesn't produce an empty last line.
 * Handles \n, \r\n, and \r line endings.
 */
function splitLines(text: string): string[] {
  if (!text) return []
  // Normalize \r\n and \r to \n
  const normalized = text.replace(/\r\n?/g, '\n')
  // split('\n') produces an empty string for a trailing newline — strip it.
  const lines = normalized.split('\n')
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  return lines
}

/** Build a DiffResult from a list of diff lines. */
function buildResult(lines: DiffLine[], truncated: boolean): DiffResult {
  let added = 0, removed = 0, unchanged = 0
  for (const line of lines) {
    if (line.type === 'added') added++
    else if (line.type === 'removed') removed++
    else if (line.type === 'unchanged') unchanged++
    // 'context' lines (the '...' separators) aren't counted
  }
  const identical = added === 0 && removed === 0
  return {
    lines,
    stats: { added, removed, unchanged },
    summary: `+${added} -${removed} (${unchanged} unchanged)`,
    identical,
    truncated,
  }
}
