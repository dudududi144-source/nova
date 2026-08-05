// Comprehensive tests for src/lib/build-comparison.ts
// Covers compareBuilds edge cases, summary formatting, and all field computations.
import { describe, expect, test } from 'bun:test'
import { compareBuilds } from '../src/lib/build-comparison'
import type { ComparisonSummary } from '../src/lib/build-comparison'

type Build = { html: string; quality?: number; ms?: number; mission: string }

const mkBuild = (html: string, quality = 80, ms = 60000, mission = 'test'): Build => ({ html, quality, ms, mission })

// Helper: assert a fully-formed ComparisonSummary object
function assertSummary(s: ComparisonSummary): void {
  expect(typeof s.addedLines).toBe('number')
  expect(typeof s.removedLines).toBe('number')
  expect(typeof s.sizeChange).toBe('number')
  expect(typeof s.sizeChangePercent).toBe('number')
  expect(typeof s.qualityChange).toBe('number')
  expect(typeof s.timeChange).toBe('number')
  expect(typeof s.isImprovement).toBe('boolean')
  expect(typeof s.summary).toBe('string')
  expect(s.summary.length).toBeGreaterThan(0)
}

describe('compareBuilds — structure invariants', () => {
  test('returns a fully-formed ComparisonSummary', () => {
    assertSummary(compareBuilds(mkBuild('<html></html>'), mkBuild('<html></html>')))
  })
  test('returns a fully-formed ComparisonSummary for empty HTML', () => {
    assertSummary(compareBuilds(mkBuild(''), mkBuild('')))
  })
  test('returns a fully-formed ComparisonSummary when adding content', () => {
    assertSummary(compareBuilds(mkBuild(''), mkBuild('<html></html>')))
  })
})

describe('compareBuilds — qualityChange', () => {
  test('positive change when new quality > old quality', () => {
    expect(compareBuilds(mkBuild('', 70), mkBuild('', 85)).qualityChange).toBe(15)
  })
  test('negative change when new quality < old quality', () => {
    expect(compareBuilds(mkBuild('', 85), mkBuild('', 70)).qualityChange).toBe(-15)
  })
  test('zero change when qualities equal', () => {
    expect(compareBuilds(mkBuild('', 80), mkBuild('', 80)).qualityChange).toBe(0)
  })
  test('old quality undefined defaults to 0', () => {
    const old: Build = { html: '', mission: 'test' }
    expect(compareBuilds(old, mkBuild('', 50)).qualityChange).toBe(50)
  })
  test('new quality undefined defaults to 0', () => {
    const next: Build = { html: '', mission: 'test' }
    expect(compareBuilds(mkBuild('', 50), next).qualityChange).toBe(-50)
  })
  test('both quality undefined defaults to 0/0', () => {
    const old: Build = { html: '', mission: 'test' }
    const next: Build = { html: '', mission: 'test' }
    expect(compareBuilds(old, next).qualityChange).toBe(0)
  })
})

describe('compareBuilds — timeChange', () => {
  test('positive time change', () => {
    expect(compareBuilds(mkBuild('', 80, 60000), mkBuild('', 80, 90000)).timeChange).toBe(30000)
  })
  test('negative time change', () => {
    expect(compareBuilds(mkBuild('', 80, 90000), mkBuild('', 80, 60000)).timeChange).toBe(-30000)
  })
  test('zero time change', () => {
    expect(compareBuilds(mkBuild('', 80, 60000), mkBuild('', 80, 60000)).timeChange).toBe(0)
  })
  test('old ms undefined defaults to 0', () => {
    const old: Build = { html: '', quality: 80, mission: 'test' }
    expect(compareBuilds(old, mkBuild('', 80, 60000)).timeChange).toBe(60000)
  })
  test('new ms undefined defaults to 0', () => {
    const next: Build = { html: '', quality: 80, mission: 'test' }
    expect(compareBuilds(mkBuild('', 80, 60000), next).timeChange).toBe(-60000)
  })
})

describe('compareBuilds — sizeChange', () => {
  test('positive size change', () => {
    expect(compareBuilds(mkBuild('a'), mkBuild('abc')).sizeChange).toBe(2)
  })
  test('negative size change', () => {
    expect(compareBuilds(mkBuild('abc'), mkBuild('a')).sizeChange).toBe(-2)
  })
  test('zero size change for same length but different content', () => {
    expect(compareBuilds(mkBuild('abc'), mkBuild('xyz')).sizeChange).toBe(0)
  })
  test('sizeChangePercent = 0 when oldSize is 0', () => {
    // Division by zero guard — should return 0, not NaN/Infinity
    expect(compareBuilds(mkBuild(''), mkBuild('abc')).sizeChangePercent).toBe(0)
  })
  test('sizeChangePercent is rounded integer', () => {
    const cmp = compareBuilds(mkBuild('aaaaaaaaaa'), mkBuild('aaaaaaaaaaa')) // +10%
    expect(cmp.sizeChangePercent).toBe(10)
    expect(Number.isInteger(cmp.sizeChangePercent)).toBe(true)
  })
  test('sizeChangePercent negative for shrink', () => {
    const cmp = compareBuilds(mkBuild('aaaaaaaaaaa'), mkBuild('aaaaaaaaaa')) // -9%
    expect(cmp.sizeChangePercent).toBeLessThanOrEqual(0)
  })
})

describe('compareBuilds — addedLines / removedLines', () => {
  test('addedLines counts new lines not present in old', () => {
    const cmp = compareBuilds(mkBuild('a\nb'), mkBuild('a\nb\nc'))
    expect(cmp.addedLines).toBe(1)
  })
  test('removedLines counts old lines not present in new', () => {
    const cmp = compareBuilds(mkBuild('a\nb\nc'), mkBuild('a\nb'))
    expect(cmp.removedLines).toBe(1)
  })
  test('identical HTML → 0 added, 0 removed', () => {
    const cmp = compareBuilds(mkBuild('a\nb\nc'), mkBuild('a\nb\nc'))
    expect(cmp.addedLines).toBe(0)
    expect(cmp.removedLines).toBe(0)
  })
  test('reordering is NOT detected (set-based diff)', () => {
    // Set-based diff doesn't catch reordering — 'a','b','c' vs 'c','b','a' looks identical
    const cmp = compareBuilds(mkBuild('a\nb\nc'), mkBuild('c\nb\na'))
    expect(cmp.addedLines).toBe(0)
    expect(cmp.removedLines).toBe(0)
  })
  test('duplicate lines are NOT double-counted in addedLines (set dedupes)', () => {
    // 'x' is already in old set → not "added" even if duplicated in new
    const cmp = compareBuilds(mkBuild('x\na'), mkBuild('x\nx\nb'))
    // New unique lines not in old: 'b' (x already in old, a removed)
    expect(cmp.addedLines).toBe(1)
    expect(cmp.removedLines).toBe(1)
  })
})

describe('compareBuilds — isImprovement', () => {
  test('true when qualityChange > 0', () => {
    expect(compareBuilds(mkBuild('', 70), mkBuild('', 85)).isImprovement).toBe(true)
  })
  test('false when qualityChange < 0', () => {
    expect(compareBuilds(mkBuild('', 85), mkBuild('', 70)).isImprovement).toBe(false)
  })
  test('true when quality unchanged AND size grew', () => {
    expect(compareBuilds(mkBuild('a', 80), mkBuild('abc', 80)).isImprovement).toBe(true)
  })
  test('false when quality unchanged AND size shrank', () => {
    expect(compareBuilds(mkBuild('abc', 80), mkBuild('a', 80)).isImprovement).toBe(false)
  })
  test('false when quality unchanged AND size unchanged (different content same length)', () => {
    expect(compareBuilds(mkBuild('abc', 80), mkBuild('xyz', 80)).isImprovement).toBe(false)
  })
})

describe('compareBuilds — summary: quality', () => {
  test('summary mentions "improved by N points" when quality up', () => {
    expect(compareBuilds(mkBuild('', 70), mkBuild('', 85)).summary).toContain('improved by 15')
  })
  test('summary mentions "dropped by N points" when quality down', () => {
    expect(compareBuilds(mkBuild('', 85), mkBuild('', 70)).summary).toContain('dropped by 15')
  })
  test('summary mentions "unchanged" when quality same', () => {
    expect(compareBuilds(mkBuild('', 80), mkBuild('', 80)).summary).toContain('unchanged')
  })
  test('summary includes old→new quality arrow', () => {
    const summary = compareBuilds(mkBuild('', 70), mkBuild('', 85)).summary
    expect(summary).toContain('Q:70')
    expect(summary).toContain('Q:85')
  })
})

describe('compareBuilds — summary: lines', () => {
  test('summary mentions "N lines added" when only additions', () => {
    expect(compareBuilds(mkBuild('a'), mkBuild('a\nb')).summary).toContain('1 lines added')
  })
  test('summary mentions "N lines removed" when only removals', () => {
    expect(compareBuilds(mkBuild('a\nb'), mkBuild('a')).summary).toContain('1 lines removed')
  })
  test('summary mentions both when additions and removals', () => {
    const summary = compareBuilds(mkBuild('a\nb\nc'), mkBuild('a\nx\ny')).summary
    // Format: "N lines added, M removed"
    expect(summary).toMatch(/\d+ lines added, \d+ removed/)
  })
  test('summary omits lines section when 0 added and 0 removed', () => {
    const summary = compareBuilds(mkBuild('a\nb'), mkBuild('a\nb')).summary
    expect(summary).not.toContain('lines added')
    expect(summary).not.toContain('lines removed')
  })
})

describe('compareBuilds — summary: size', () => {
  test('summary mentions "Size +X.XKB" when grew', () => {
    const summary = compareBuilds(mkBuild('a'), mkBuild('a' + 'b'.repeat(1024))).summary
    expect(summary).toMatch(/Size \+\d+\.\dKB/)
  })
  test('summary mentions "Size -X.XKB" when shrank', () => {
    const summary = compareBuilds(mkBuild('a' + 'b'.repeat(1024)), mkBuild('a')).summary
    expect(summary).toMatch(/Size -\d+\.\dKB/)
  })
  test('summary includes positive percent sign when grew', () => {
    const summary = compareBuilds(mkBuild('aa'), mkBuild('aaaa')).summary
    expect(summary).toMatch(/%\)/)
  })
  test('summary omits size when sizeChange is 0', () => {
    const summary = compareBuilds(mkBuild('abc'), mkBuild('xyz')).summary
    expect(summary).not.toContain('Size')
  })
})

describe('compareBuilds — summary: build time', () => {
  test('summary mentions "Build time +X.Xs" when slower', () => {
    const summary = compareBuilds(mkBuild('', 80, 60000), mkBuild('', 80, 90000)).summary
    expect(summary).toMatch(/Build time \+\d+\.\ds/)
  })
  test('summary mentions "Build time -X.Xs" when faster', () => {
    const summary = compareBuilds(mkBuild('', 80, 90000), mkBuild('', 80, 60000)).summary
    expect(summary).toMatch(/Build time -\d+\.\ds/)
  })
  test('summary omits build time when timeChange is 0', () => {
    const summary = compareBuilds(mkBuild('', 80, 60000), mkBuild('', 80, 60000)).summary
    expect(summary).not.toContain('Build time')
  })
})

describe('compareBuilds — separators', () => {
  test('summary uses " · " separator between parts', () => {
    const summary = compareBuilds(mkBuild('a', 70, 60000), mkBuild('a\nb', 85, 90000)).summary
    expect(summary).toContain(' · ')
  })
})

describe('compareBuilds — empty HTML edge cases', () => {
  test('both HTML empty → empty summary parts except "Quality unchanged"', () => {
    const summary = compareBuilds(mkBuild(''), mkBuild('')).summary
    expect(summary).toContain('unchanged')
    expect(summary).not.toContain('lines')
    expect(summary).not.toContain('Size')
    expect(summary).not.toContain('Build time')
  })
  test('old empty, new has content → 100% size growth (but percent guard = 0)', () => {
    const cmp = compareBuilds(mkBuild(''), mkBuild('abc'))
    expect(cmp.addedLines).toBe(1)
    expect(cmp.sizeChange).toBe(3)
    expect(cmp.sizeChangePercent).toBe(0) // division-by-zero guard
  })
})

describe('compareBuilds — mission field', () => {
  test('accepts arbitrary mission strings', () => {
    const cmp = compareBuilds(
      { html: '', quality: 80, ms: 1000, mission: 'snake game with score' },
      { html: '', quality: 90, ms: 2000, mission: 'snake game with pause' },
    )
    expect(cmp.qualityChange).toBe(10)
  })
  test('mission field is not used in any computation', () => {
    // Same HTML/quality/ms but different missions should give identical comparison
    const a = compareBuilds(
      { html: 'x', quality: 80, ms: 1000, mission: 'aaa' },
      { html: 'y', quality: 80, ms: 1000, mission: 'bbb' },
    )
    const b = compareBuilds(
      { html: 'x', quality: 80, ms: 1000, mission: 'ccc' },
      { html: 'y', quality: 80, ms: 1000, mission: 'ddd' },
    )
    expect(a).toEqual(b)
  })
})

describe('compareBuilds — boundary values', () => {
  test('quality boundary 0 → 100', () => {
    expect(compareBuilds(mkBuild('', 0), mkBuild('', 100)).qualityChange).toBe(100)
  })
  test('quality boundary 100 → 0', () => {
    expect(compareBuilds(mkBuild('', 100), mkBuild('', 0)).qualityChange).toBe(-100)
  })
  test('size boundary 1 byte vs 2 bytes', () => {
    expect(compareBuilds(mkBuild('a'), mkBuild('ab')).sizeChange).toBe(1)
    expect(compareBuilds(mkBuild('a'), mkBuild('ab')).sizeChangePercent).toBe(100)
  })
  test('time boundary 0ms vs 1ms', () => {
    expect(compareBuilds(mkBuild('', 80, 0), mkBuild('', 80, 1)).timeChange).toBe(1)
  })
})
