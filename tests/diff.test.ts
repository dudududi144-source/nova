// Tests for diff.ts — diffStrings, diffStringsCompact, diffBuilds, buildsIdentical.
import { describe, it, expect } from 'bun:test'
import {
  diffStrings,
  diffStringsCompact,
  diffBuilds,
  buildsIdentical,
  MAX_LINES,
  type DiffLine,
} from '../src/lib/diff'
import type { BuildResult } from '../src/lib/helpers'

function makeBuild(html: string, id: string = 'b1'): BuildResult {
  return { id, html, tokens: 0, ms: 0, mission: 'test' }
}

describe('diffStrings', () => {
  it('returns identical=true for equal texts', () => {
    const result = diffStrings('hello\nworld', 'hello\nworld')
    expect(result.identical).toBe(true)
    expect(result.stats.added).toBe(0)
    expect(result.stats.removed).toBe(0)
  })

  it('returns identical=true for two empty strings', () => {
    const result = diffStrings('', '')
    expect(result.identical).toBe(true)
    expect(result.lines).toHaveLength(0)
  })

  it('marks all lines as added when old is empty', () => {
    const result = diffStrings('', 'a\nb\nc')
    expect(result.stats.added).toBe(3)
    expect(result.stats.removed).toBe(0)
    expect(result.identical).toBe(false)
  })

  it('marks all lines as removed when new is empty', () => {
    const result = diffStrings('a\nb\nc', '')
    expect(result.stats.added).toBe(0)
    expect(result.stats.removed).toBe(3)
  })

  it('detects additions at the end', () => {
    const result = diffStrings('a\nb', 'a\nb\nc')
    expect(result.stats.added).toBe(1)
    expect(result.stats.removed).toBe(0)
    expect(result.lines.some(l => l.type === 'added' && l.content === 'c')).toBe(true)
  })

  it('detects removals at the end', () => {
    const result = diffStrings('a\nb\nc', 'a\nb')
    expect(result.stats.removed).toBe(1)
    expect(result.lines.some(l => l.type === 'removed' && l.content === 'c')).toBe(true)
  })

  it('detects modifications in the middle', () => {
    const result = diffStrings('a\nb\nc', 'a\nB\nc')
    expect(result.stats.added).toBe(1)
    expect(result.stats.removed).toBe(1)
  })

  it('preserves line numbers for unchanged lines', () => {
    const result = diffStrings('a\nb\nc', 'a\nb\nc')
    const first = result.lines[0] as DiffLine
    expect(first.oldLineNumber).toBe(1)
    expect(first.newLineNumber).toBe(1)
  })

  it('null line numbers for added lines', () => {
    const result = diffStrings('a', 'a\nb')
    const added = result.lines.find(l => l.type === 'added') as DiffLine
    expect(added.oldLineNumber).toBeNull()
    expect(added.newLineNumber).toBe(2)
  })

  it('null line numbers for removed lines', () => {
    const result = diffStrings('a\nb', 'a')
    const removed = result.lines.find(l => l.type === 'removed') as DiffLine
    expect(removed.oldLineNumber).toBe(2)
    expect(removed.newLineNumber).toBeNull()
  })

  it('includes a summary string', () => {
    const result = diffStrings('a', 'b')
    expect(result.summary).toMatch(/\+\d+ -\d+ \(\d+ unchanged\)/)
  })

  it('normalizes \\r\\n line endings', () => {
    const result = diffStrings('a\r\nb\r\nc', 'a\nb\nc')
    expect(result.identical).toBe(true)
  })

  it('normalizes \\r line endings', () => {
    const result = diffStrings('a\rb\rc', 'a\nb\nc')
    expect(result.identical).toBe(true)
  })

  it('handles trailing newline (no empty last line)', () => {
    const result = diffStrings('a\nb\n', 'a\nb')
    expect(result.identical).toBe(true)
  })

  it('falls back to naive diff beyond MAX_LINES', () => {
    const oldText = Array.from({ length: MAX_LINES + 10 }, (_, i) => `old${i}`).join('\n')
    const newText = Array.from({ length: MAX_LINES + 10 }, (_, i) => `new${i}`).join('\n')
    const result = diffStrings(oldText, newText)
    expect(result.truncated).toBe(true)
    // Naive diff still produces a result
    expect(result.lines.length).toBeGreaterThan(0)
  })

  it('fast-paths identical long inputs without computing LCS', () => {
    const text = Array.from({ length: 500 }, (_, i) => `line${i}`).join('\n')
    const result = diffStrings(text, text)
    expect(result.identical).toBe(true)
    expect(result.stats.unchanged).toBe(500)
  })

  it('detects reordering (line moved)', () => {
    // LCS should detect that 'a' and 'b' are common, just reordered
    const result = diffStrings('a\nb\nc', 'c\na\nb')
    expect(result.stats.unchanged).toBeGreaterThan(0)
  })
})

describe('diffStringsCompact', () => {
  it('returns identical result unchanged', () => {
    const result = diffStringsCompact('a\nb', 'a\nb')
    expect(result.identical).toBe(true)
  })

  it('includes only changed regions + context', () => {
    const old = '1\n2\n3\n4\n5\n6\n7\n8\n9\n10'
    const neo = '1\n2\n3\n4\nCHANGED\n6\n7\n8\n9\n10'
    const result = diffStringsCompact(old, neo, 1)
    // Should be much shorter than the full 10 lines
    expect(result.lines.length).toBeLessThan(10)
    expect(result.lines.some(l => l.type === 'added' && l.content === 'CHANGED')).toBe(true)
  })

  it('includes context lines around changes', () => {
    const old = '1\n2\n3\n4\n5'
    const neo = '1\n2\nX\n4\n5'
    const result = diffStringsCompact(old, neo, 1)
    // Should include 1 line of context before & after
    expect(result.lines.some(l => l.type === 'context' && l.content === '2')).toBe(true)
    expect(result.lines.some(l => l.type === 'context' && l.content === '4')).toBe(true)
  })

  it('inserts "..." separator between non-adjacent change regions', () => {
    const old = '1\n2\n3\n4\n5\n6\n7\n8\n9\n10'
    const neo = 'X\n2\n3\n4\n5\n6\n7\n8\n9\nY'
    const result = diffStringsCompact(old, neo, 0)
    // With 0 context, two non-adjacent changes should be separated by '...'
    const separators = result.lines.filter(l => l.type === 'context' && l.content === '...')
    expect(separators.length).toBeGreaterThanOrEqual(1)
  })

  it('respects the contextLines parameter', () => {
    const old = '1\n2\n3\n4\n5\n6\n7\n8\n9'
    const neo = '1\n2\n3\n4\n5\n6\n7\n8\nX'
    const r1 = diffStringsCompact(old, neo, 1)
    const r3 = diffStringsCompact(old, neo, 3)
    expect(r3.lines.length).toBeGreaterThan(r1.lines.length)
  })

  it('caps context at 50 lines', () => {
    const old = '1\n2\n3\n4\n5'
    const neo = '1\n2\n3\n4\nX'
    // 1000 context lines should be capped to 50 — function should not crash
    const result = diffStringsCompact(old, neo, 1000)
    expect(result.lines.length).toBeLessThanOrEqual(7) // small enough
  })

  it('does not modify the stats from the full diff', () => {
    const old = '1\n2\n3\n4\n5'
    const neo = '1\n2\n3\n4\nX'
    const full = diffStrings(old, neo)
    const compact = diffStringsCompact(old, neo, 1)
    expect(compact.stats).toEqual(full.stats)
  })
})

describe('diffBuilds', () => {
  it('diffs the HTML of two builds', () => {
    const a = makeBuild('<html>\n<body>old</body>\n</html>')
    const b = makeBuild('<html>\n<body>new</body>\n</html>')
    const result = diffBuilds(a, b)
    expect(result.stats.added).toBe(1)
    expect(result.stats.removed).toBe(1)
  })

  it('returns identical=true for identical builds', () => {
    const a = makeBuild('<html></html>')
    const b = makeBuild('<html></html>')
    expect(diffBuilds(a, b).identical).toBe(true)
  })
})

describe('buildsIdentical', () => {
  it('returns true for identical HTML', () => {
    const a = makeBuild('<html></html>')
    const b = makeBuild('<html></html>')
    expect(buildsIdentical(a, b)).toBe(true)
  })

  it('returns false for different HTML lengths (fast path)', () => {
    const a = makeBuild('<html></html>')
    const b = makeBuild('<html>longer</html>')
    expect(buildsIdentical(a, b)).toBe(false)
  })

  it('returns false for same-length different HTML', () => {
    const a = makeBuild('<html>aaaa</html>')
    const b = makeBuild('<html>bbbb</html>')
    expect(buildsIdentical(a, b)).toBe(false)
  })

  it('returns false for null/undefined builds', () => {
    expect(buildsIdentical(null as unknown as BuildResult, makeBuild(''))).toBe(false)
    expect(buildsIdentical(undefined as unknown as BuildResult, makeBuild(''))).toBe(false)
  })

  it('short-circuits on length difference (does not compute full diff)', () => {
    const a = makeBuild('a')
    const b = makeBuild('ab')
    // Should return false without needing LCS
    expect(buildsIdentical(a, b)).toBe(false)
  })
})
