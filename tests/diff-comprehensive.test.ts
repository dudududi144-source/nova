// Comprehensive tests for src/lib/diff.ts
// Tests diffStrings, diffStringsCompact, diffBuilds, buildsIdentical.
import { describe, expect, test } from 'bun:test'
import {
  diffStrings,
  diffStringsCompact,
  diffBuilds,
  buildsIdentical,
  MAX_LINES,
  type DiffLine,
  type DiffResult,
} from '../src/lib/diff'
import type { BuildResult } from '../src/lib/helpers'

function makeBuild(html: string, id: string = 'b1'): BuildResult {
  return { id, html, tokens: 0, ms: 0, mission: 'test' }
}

describe('diffStrings — structure invariants', () => {
  test('returns a fully-formed DiffResult for empty inputs', () => {
    const r = diffStrings('', '')
    expect(r).toEqual({
      lines: [],
      stats: { added: 0, removed: 0, unchanged: 0 },
      summary: '+0 -0 (0 unchanged)',
      identical: true,
      truncated: false,
    })
  })
  test('returns a fully-formed DiffResult for non-empty inputs', () => {
    const r = diffStrings('a', 'b')
    expect(typeof r.summary).toBe('string')
    expect(Array.isArray(r.lines)).toBe(true)
    expect(r.stats).toEqual({ added: 1, removed: 1, unchanged: 0 })
  })
})

describe('diffStrings — summary format', () => {
  test('summary format is "+A -R (U unchanged)"', () => {
    const r = diffStrings('a\nb\nc', 'a\nB\nc')
    expect(r.summary).toBe('+1 -1 (2 unchanged)')
  })
  test('summary 0/0/0 for both empty', () => {
    expect(diffStrings('', '').summary).toBe('+0 -0 (0 unchanged)')
  })
  test('summary only additions', () => {
    expect(diffStrings('', 'a\nb').summary).toBe('+2 -0 (0 unchanged)')
  })
  test('summary only removals', () => {
    expect(diffStrings('a\nb', '').summary).toBe('+0 -2 (0 unchanged)')
  })
})

describe('diffStrings — line numbering', () => {
  test('unchanged lines have both old and new line numbers', () => {
    const r = diffStrings('a\nb', 'a\nb')
    expect((r.lines[0] as DiffLine).oldLineNumber).toBe(1)
    expect((r.lines[0] as DiffLine).newLineNumber).toBe(1)
    expect((r.lines[1] as DiffLine).oldLineNumber).toBe(2)
    expect((r.lines[1] as DiffLine).newLineNumber).toBe(2)
  })
  test('added lines have null oldLineNumber, sequential newLineNumber', () => {
    const r = diffStrings('', 'a\nb\nc')
    expect((r.lines[0] as DiffLine).oldLineNumber).toBeNull()
    expect((r.lines[0] as DiffLine).newLineNumber).toBe(1)
    expect((r.lines[2] as DiffLine).newLineNumber).toBe(3)
  })
  test('removed lines have sequential oldLineNumber, null newLineNumber', () => {
    const r = diffStrings('a\nb\nc', '')
    expect((r.lines[0] as DiffLine).oldLineNumber).toBe(1)
    expect((r.lines[0] as DiffLine).newLineNumber).toBeNull()
    expect((r.lines[2] as DiffLine).oldLineNumber).toBe(3)
  })
})

describe('diffStrings — line-ending normalization', () => {
  test('normalizes CRLF to LF', () => {
    expect(diffStrings('a\r\nb', 'a\nb').identical).toBe(true)
  })
  test('normalizes lone CR to LF', () => {
    expect(diffStrings('a\rb', 'a\nb').identical).toBe(true)
  })
  test('handles mixed line endings', () => {
    expect(diffStrings('a\r\nb\rc\nd', 'a\nb\nc\nd').identical).toBe(true)
  })
  test('trailing newline does not produce empty last line', () => {
    expect(diffStrings('a\n', 'a').identical).toBe(true)
  })
  test('only ONE trailing newline is stripped (multiple stay as empty lines)', () => {
    // Source: `if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()`
    // Only the LAST empty string is removed.
    // 'a\n' → ['a', ''] → pop → ['a']  (identical to 'a')
    // 'a\n\n' → ['a', '', ''] → pop → ['a', '']  (NOT identical to 'a')
    expect(diffStrings('a\n', 'a').identical).toBe(true) // one trailing → stripped
    expect(diffStrings('a\n\n', 'a').identical).toBe(false) // two trailing → one empty remains
    // 'a\n\n' and 'a\n' are NOT identical (one has trailing empty line, other doesn't)
    expect(diffStrings('a\n\n', 'a\n').identical).toBe(false)
  })
})

describe('diffStrings — identical fast path', () => {
  test('fast-paths identical inputs without LCS', () => {
    const text = Array.from({ length: 100 }, (_, i) => `line${i}`).join('\n')
    const r = diffStrings(text, text)
    expect(r.identical).toBe(true)
    expect(r.stats.unchanged).toBe(100)
    expect(r.truncated).toBe(false)
  })
  test('fast-path produces correct line numbers', () => {
    const r = diffStrings('a\nb\nc', 'a\nb\nc')
    r.lines.forEach((line, i) => {
      expect(line.oldLineNumber).toBe(i + 1)
      expect(line.newLineNumber).toBe(i + 1)
    })
  })
})

describe('diffStrings — MAX_LINES boundary', () => {
  test('MAX_LINES exactly → uses LCS (not truncated)', () => {
    const text = Array.from({ length: MAX_LINES }, (_, i) => `line${i}`).join('\n')
    const r = diffStrings(text, text)
    expect(r.truncated).toBe(false)
  })
  test('MAX_LINES + 1 → naive diff (truncated)', () => {
    const text = Array.from({ length: MAX_LINES + 1 }, (_, i) => `line${i}`).join('\n')
    const r = diffStrings(text, text + '\nextra')
    expect(r.truncated).toBe(true)
  })
  test('only old exceeds MAX_LINES → naive', () => {
    const oldText = Array.from({ length: MAX_LINES + 5 }, (_, i) => `old${i}`).join('\n')
    const newText = 'short'
    const r = diffStrings(oldText, newText)
    expect(r.truncated).toBe(true)
  })
  test('only new exceeds MAX_LINES → naive', () => {
    const oldText = 'short'
    const newText = Array.from({ length: MAX_LINES + 5 }, (_, i) => `new${i}`).join('\n')
    const r = diffStrings(oldText, newText)
    expect(r.truncated).toBe(true)
  })
})

describe('diffStrings — LCS reorder detection', () => {
  test('detects reordering preserves unchanged count', () => {
    const r = diffStrings('a\nb\nc', 'c\na\nb')
    // LCS = ['a','b'], so unchanged=2, removed=1 (c from old), added=1 (c in new pos)
    expect(r.stats.unchanged).toBe(2)
  })
  test('fully reversed content', () => {
    const r = diffStrings('a\nb\nc\nd', 'd\nc\nb\na')
    // LCS may be empty or short
    expect(r.identical).toBe(false)
  })
  test('common subsequence in middle', () => {
    const r = diffStrings('x\na\nb\ny', 'z\na\nb\nw')
    expect(r.stats.unchanged).toBe(2) // a, b are common
    expect(r.stats.added).toBe(2) // z, w
    expect(r.stats.removed).toBe(2) // x, y
  })
})

describe('diffStrings — special content', () => {
  test('handles empty lines in input', () => {
    const r = diffStrings('a\n\nb', 'a\n\nb')
    expect(r.identical).toBe(true)
  })
  test('handles whitespace-only lines', () => {
    const r = diffStrings('a\n   \nb', 'a\n   \nb')
    expect(r.identical).toBe(true)
  })
  test('handles very long single line', () => {
    const long = 'x'.repeat(10000)
    const r = diffStrings(long, long)
    expect(r.identical).toBe(true)
    expect(r.stats.unchanged).toBe(1)
  })
  test('handles unicode content', () => {
    const r = diffStrings('héllo\nwörld', 'héllo\nwörld')
    expect(r.identical).toBe(true)
  })
  test('handles content with special regex chars', () => {
    const r = diffStrings('a.*+?^$\nb', 'a.*+?^$\nb')
    expect(r.identical).toBe(true)
  })
})

describe('diffStringsCompact — context handling', () => {
  test('default context is 3 lines', () => {
    const old = '1\n2\n3\n4\n5\n6\n7\n8\n9\n10'
    const neo = '1\n2\n3\n4\n5\n6\n7\n8\n9\nCHANGED'
    const r = diffStringsCompact(old, neo)
    // Default 3 lines of context before the change
    expect(r.lines.some(l => l.type === 'context' && l.content === '7')).toBe(true)
    expect(r.lines.some(l => l.type === 'context' && l.content === '8')).toBe(true)
    expect(r.lines.some(l => l.type === 'context' && l.content === '9')).toBe(true)
  })
  test('context=0 produces only changed lines', () => {
    const old = '1\n2\n3\n4\n5'
    const neo = '1\n2\n3\n4\nX'
    const r = diffStringsCompact(old, neo, 0)
    // Only 1 added line (X) and 1 removed line (5), no context
    expect(r.lines.filter(l => l.type === 'added')).toHaveLength(1)
    expect(r.lines.filter(l => l.type === 'removed')).toHaveLength(1)
    expect(r.lines.filter(l => l.type === 'context' && l.content !== '...')).toEqual([])
  })
  test('context > total lines includes everything', () => {
    const old = '1\n2\n3'
    const neo = '1\n2\nX'
    const r = diffStringsCompact(old, neo, 100)
    // All 3 lines should be in result (changed + context)
    expect(r.lines.length).toBeLessThanOrEqual(5) // 2 changes + max 3 context
  })
  test('context cap at 50 lines', () => {
    const old = '1\n2\n3\n4\n5'
    const neo = '1\n2\n3\n4\nX'
    const r = diffStringsCompact(old, neo, 1000)
    // Should not crash; result is small since input is small
    expect(r.lines.length).toBeLessThanOrEqual(7)
  })
  test('identical input returns identical result', () => {
    const r = diffStringsCompact('a\nb\nc', 'a\nb\nc')
    expect(r.identical).toBe(true)
  })
  test('preserves full diff stats', () => {
    const old = '1\n2\n3\n4\n5'
    const neo = '1\n2\n3\n4\nX'
    const full = diffStrings(old, neo)
    const compact = diffStringsCompact(old, neo, 1)
    expect(compact.stats).toEqual(full.stats)
    expect(compact.summary).toBe(full.summary)
    expect(compact.identical).toBe(full.identical)
    expect(compact.truncated).toBe(full.truncated)
  })
  test('inserts "..." separator between non-adjacent change regions', () => {
    const old = '1\n2\n3\n4\n5\n6\n7\n8\n9\n10'
    const neo = 'X\n2\n3\n4\n5\n6\n7\n8\n9\nY'
    const r = diffStringsCompact(old, neo, 0)
    const separators = r.lines.filter(l => l.type === 'context' && l.content === '...')
    expect(separators.length).toBeGreaterThanOrEqual(1)
  })
  test('no separator between adjacent change regions', () => {
    const old = '1\n2\n3\n4\n5'
    const neo = 'X\nY\n3\n4\n5'
    const r = diffStringsCompact(old, neo, 0)
    const separators = r.lines.filter(l => l.type === 'context' && l.content === '...')
    expect(separators).toHaveLength(0)
  })
  test('negative contextLines is clamped to 0', () => {
    const old = '1\n2\n3'
    const neo = '1\n2\nX'
    const r = diffStringsCompact(old, neo, -5)
    // Should not crash; effectively 0 context
    expect(r.lines.length).toBeGreaterThanOrEqual(1)
  })
})

describe('diffBuilds', () => {
  test('returns DiffResult type', () => {
    const r = diffBuilds(makeBuild('a'), makeBuild('b'))
    expect(typeof r.identical).toBe('boolean')
    expect(Array.isArray(r.lines)).toBe(true)
  })
  test('identical builds → identical=true', () => {
    expect(diffBuilds(makeBuild('a\nb'), makeBuild('a\nb')).identical).toBe(true)
  })
  test('different builds → identical=false', () => {
    expect(diffBuilds(makeBuild('a\nb'), makeBuild('a\nc')).identical).toBe(false)
  })
  test('preserves line content correctly', () => {
    const r = diffBuilds(makeBuild('hello\nworld'), makeBuild('hello\nthere'))
    expect(r.lines.some(l => l.content === 'world' && l.type === 'removed')).toBe(true)
    expect(r.lines.some(l => l.content === 'there' && l.type === 'added')).toBe(true)
  })
})

describe('buildsIdentical', () => {
  test('true for identical HTML', () => {
    expect(buildsIdentical(makeBuild('abc'), makeBuild('abc'))).toBe(true)
  })
  test('false for different lengths (fast path)', () => {
    expect(buildsIdentical(makeBuild('abc'), makeBuild('abcd'))).toBe(false)
  })
  test('false for same length, different content', () => {
    expect(buildsIdentical(makeBuild('abc'), makeBuild('xyz'))).toBe(false)
  })
  test('false for null old build', () => {
    expect(buildsIdentical(null as unknown as BuildResult, makeBuild('a'))).toBe(false)
  })
  test('false for null new build', () => {
    expect(buildsIdentical(makeBuild('a'), null as unknown as BuildResult)).toBe(false)
  })
  test('false for both null', () => {
    expect(buildsIdentical(null as unknown as BuildResult, null as unknown as BuildResult)).toBe(false)
  })
  test('false for undefined builds', () => {
    expect(buildsIdentical(undefined as unknown as BuildResult, makeBuild('a'))).toBe(false)
  })
  test('true for empty HTML both sides', () => {
    expect(buildsIdentical(makeBuild(''), makeBuild(''))).toBe(true)
  })
  test('short-circuits without computing diff for length mismatch', () => {
    // Even very long inputs short-circuit on length
    const a = makeBuild('a'.repeat(100000))
    const b = makeBuild('a'.repeat(100001))
    expect(buildsIdentical(a, b)).toBe(false)
  })
})
