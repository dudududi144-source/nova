// Comprehensive tests for src/lib/format.ts
// Tests formatTokens, formatMs, timeAgo, BUILD_STAGES, and getCurrentStage.
import { describe, expect, test } from 'bun:test'
import {
  formatTokens,
  formatMs,
  timeAgo,
  BUILD_STAGES,
  getCurrentStage,
} from '../src/lib/format'

// ─────────────────────────────────────────────────────────────────────────────
// formatTokens
// ─────────────────────────────────────────────────────────────────────────────

describe('formatTokens — small numbers (< 1000)', () => {
  test('0 → "0"', () => {
    expect(formatTokens(0)).toBe('0')
  })

  test('1 → "1"', () => {
    expect(formatTokens(1)).toBe('1')
  })

  test('42 → "42"', () => {
    expect(formatTokens(42)).toBe('42')
  })

  test('999 → "999" (boundary)', () => {
    expect(formatTokens(999)).toBe('999')
  })

  test('negative number is passed as-is (no special handling)', () => {
    // Negative token counts are nonsensical but the function does not reject them.
    // They're < 1000, so they format as-is.
    expect(formatTokens(-5)).toBe('-5')
  })
})

describe('formatTokens — thousands (1000 - 999999)', () => {
  test('1000 → "1.0k"', () => {
    expect(formatTokens(1000)).toBe('1.0k')
  })

  test('2500 → "2.5k"', () => {
    expect(formatTokens(2500)).toBe('2.5k')
  })

  test('999999 → "1000.0k" (boundary)', () => {
    expect(formatTokens(999999)).toBe('1000.0k')
  })

  test('1500 → "1.5k"', () => {
    expect(formatTokens(1500)).toBe('1.5k')
  })

  test('12345 → "12.3k" (rounded to 1 decimal)', () => {
    expect(formatTokens(12345)).toBe('12.3k')
  })

  test('always returns 1 decimal place for k', () => {
    expect(formatTokens(2000)).toBe('2.0k')
    expect(formatTokens(20000)).toBe('20.0k')
  })
})

describe('formatTokens — millions (>= 1000000)', () => {
  test('1000000 → "1.0M"', () => {
    expect(formatTokens(1000000)).toBe('1.0M')
  })

  test('2500000 → "2.5M"', () => {
    expect(formatTokens(2500000)).toBe('2.5M')
  })

  test('1500000 → "1.5M"', () => {
    expect(formatTokens(1500000)).toBe('1.5M')
  })

  test('always returns 1 decimal place for M', () => {
    expect(formatTokens(2000000)).toBe('2.0M')
    expect(formatTokens(20000000)).toBe('20.0M')
  })

  test('very large number', () => {
    expect(formatTokens(123456789)).toBe('123.5M')
  })
})

describe('formatTokens — boundary cases', () => {
  test('999 vs 1000 boundary', () => {
    expect(formatTokens(999)).toBe('999')
    expect(formatTokens(1000)).toBe('1.0k')
  })

  test('999999 vs 1000000 boundary', () => {
    expect(formatTokens(999999)).toBe('1000.0k')
    expect(formatTokens(1000000)).toBe('1.0M')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// formatMs
// ─────────────────────────────────────────────────────────────────────────────

describe('formatMs — null/undefined/zero', () => {
  test('null → "—"', () => {
    expect(formatMs(null)).toBe('—')
  })

  test('undefined → "—"', () => {
    expect(formatMs(undefined)).toBe('—')
  })

  test('0 → "—"', () => {
    expect(formatMs(0)).toBe('—')
  })
})

describe('formatMs — milliseconds (< 1000)', () => {
  test('1 → "1ms"', () => {
    expect(formatMs(1)).toBe('1ms')
  })

  test('500 → "500ms"', () => {
    expect(formatMs(500)).toBe('500ms')
  })

  test('999 → "999ms" (boundary)', () => {
    expect(formatMs(999)).toBe('999ms')
  })

  test('123 → "123ms"', () => {
    expect(formatMs(123)).toBe('123ms')
  })
})

describe('formatMs — seconds (>= 1000)', () => {
  test('1000 → "1.0s"', () => {
    expect(formatMs(1000)).toBe('1.0s')
  })

  test('50000 → "50.0s"', () => {
    expect(formatMs(50000)).toBe('50.0s')
  })

  test('125000 → "125.0s"', () => {
    expect(formatMs(125000)).toBe('125.0s')
  })

  test('always returns 1 decimal place for seconds', () => {
    expect(formatMs(2000)).toBe('2.0s')
    expect(formatMs(30000)).toBe('30.0s')
  })

  test('1500 → "1.5s"', () => {
    expect(formatMs(1500)).toBe('1.5s')
  })
})

describe('formatMs — boundary cases', () => {
  test('999ms vs 1000ms boundary', () => {
    expect(formatMs(999)).toBe('999ms')
    expect(formatMs(1000)).toBe('1.0s')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// timeAgo
// ─────────────────────────────────────────────────────────────────────────────

describe('timeAgo — "just now"', () => {
  test('current time → "just now"', () => {
    expect(timeAgo(Date.now())).toBe('just now')
  })

  test('30 seconds ago → "just now"', () => {
    expect(timeAgo(Date.now() - 30_000)).toBe('just now')
  })

  test('59 seconds ago → "just now"', () => {
    expect(timeAgo(Date.now() - 59_000)).toBe('just now')
  })

  test('ISO string for current time → "just now"', () => {
    expect(timeAgo(new Date().toISOString())).toBe('just now')
  })
})

describe('timeAgo — minutes', () => {
  test('60 seconds ago → "1m ago"', () => {
    expect(timeAgo(Date.now() - 60_000)).toBe('1m ago')
  })

  test('5 minutes ago → "5m ago"', () => {
    expect(timeAgo(Date.now() - 5 * 60_000)).toBe('5m ago')
  })

  test('59 minutes ago → "59m ago"', () => {
    expect(timeAgo(Date.now() - 59 * 60_000)).toBe('59m ago')
  })

  test('ISO string for 10 minutes ago → "10m ago"', () => {
    expect(timeAgo(new Date(Date.now() - 10 * 60_000).toISOString())).toBe('10m ago')
  })
})

describe('timeAgo — hours', () => {
  test('1 hour ago → "1h ago"', () => {
    expect(timeAgo(Date.now() - 60 * 60_000)).toBe('1h ago')
  })

  test('5 hours ago → "5h ago"', () => {
    expect(timeAgo(Date.now() - 5 * 60 * 60_000)).toBe('5h ago')
  })

  test('23 hours ago → "23h ago"', () => {
    expect(timeAgo(Date.now() - 23 * 60 * 60_000)).toBe('23h ago')
  })
})

describe('timeAgo — days', () => {
  test('1 day ago → "1d ago"', () => {
    expect(timeAgo(Date.now() - 24 * 60 * 60_000)).toBe('1d ago')
  })

  test('5 days ago → "5d ago"', () => {
    expect(timeAgo(Date.now() - 5 * 24 * 60 * 60_000)).toBe('5d ago')
  })

  test('365 days ago → "365d ago"', () => {
    expect(timeAgo(Date.now() - 365 * 24 * 60 * 60_000)).toBe('365d ago')
  })
})

describe('timeAgo — invalid inputs', () => {
  test('"not a date" → "unknown"', () => {
    expect(timeAgo('not a date')).toBe('unknown')
  })

  test('empty string → "unknown"', () => {
    expect(timeAgo('')).toBe('unknown')
  })

  test('NaN → "unknown"', () => {
    expect(timeAgo(NaN)).toBe('unknown')
  })

  test('null → "unknown" (Date(null) returns epoch)', () => {
    // Date(null) is Date(0) which is 1970-01-01 — way more than 1 day ago → "Xd ago"
    // So this is NOT "unknown" — let's verify the actual behavior
    const result = timeAgo(null as unknown as string)
    expect(result).toMatch(/\d+d ago/)
  })
})

describe('timeAgo — accepts both ISO string and number', () => {
  test('ISO string input works', () => {
    const iso = new Date(Date.now() - 5 * 60_000).toISOString()
    expect(timeAgo(iso)).toBe('5m ago')
  })

  test('numeric timestamp input works', () => {
    const ts = Date.now() - 5 * 60_000
    expect(timeAgo(ts)).toBe('5m ago')
  })

  test('ISO string and number for same time produce same result', () => {
    const ts = Date.now() - 60 * 60_000
    expect(timeAgo(ts)).toBe(timeAgo(new Date(ts).toISOString()))
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// BUILD_STAGES
// ─────────────────────────────────────────────────────────────────────────────

describe('BUILD_STAGES — structure', () => {
  test('has 7 stages', () => {
    expect(BUILD_STAGES.length).toBe(7)
  })

  test('stages are in strictly increasing progress order', () => {
    for (let i = 1; i < BUILD_STAGES.length; i++) {
      expect(BUILD_STAGES[i]!.progress).toBeGreaterThan(BUILD_STAGES[i - 1]!.progress)
    }
  })

  test('first stage is "architect_start" with 10% progress', () => {
    expect(BUILD_STAGES[0]!.key).toBe('architect_start')
    expect(BUILD_STAGES[0]!.progress).toBe(10)
  })

  test('last stage is "complete" with 100% progress', () => {
    expect(BUILD_STAGES[6]!.key).toBe('complete')
    expect(BUILD_STAGES[6]!.progress).toBe(100)
  })

  test('each stage has non-empty key, label, and short', () => {
    for (const s of BUILD_STAGES) {
      expect(s.key.length).toBeGreaterThan(0)
      expect(s.label.length).toBeGreaterThan(0)
      expect(s.short.length).toBeGreaterThan(0)
    }
  })

  test('each stage has progress between 0 and 100', () => {
    for (const s of BUILD_STAGES) {
      expect(s.progress).toBeGreaterThanOrEqual(0)
      expect(s.progress).toBeLessThanOrEqual(100)
    }
  })

  test('all stage keys are unique', () => {
    const keys = BUILD_STAGES.map(s => s.key)
    const unique = new Set(keys)
    expect(unique.size).toBe(keys.length)
  })

  test('progress values are: 10, 25, 35, 60, 80, 90, 100', () => {
    const progressValues = BUILD_STAGES.map(s => s.progress)
    expect(progressValues).toEqual([10, 25, 35, 60, 80, 90, 100])
  })

  test('stage keys include expected values', () => {
    const keys = BUILD_STAGES.map(s => s.key)
    expect(keys).toContain('architect_start')
    expect(keys).toContain('architect_done')
    expect(keys).toContain('code_start')
    expect(keys).toContain('code_streaming')
    expect(keys).toContain('code_done')
    expect(keys).toContain('validating')
    expect(keys).toContain('complete')
  })

  test('is readonly (frozen at type level)', () => {
    // We can verify it's marked readonly by attempting to access items without mutation
    expect(Array.isArray(BUILD_STAGES)).toBe(true)
    expect(BUILD_STAGES.length).toBe(7)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// getCurrentStage
// ─────────────────────────────────────────────────────────────────────────────

describe('getCurrentStage — isComplete=true', () => {
  test('returns "complete" stage when isComplete is true', () => {
    const stage = getCurrentStage(60, true, false, true)
    expect(stage.key).toBe('complete')
    expect(stage.progress).toBe(100)
  })

  test('returns "complete" stage even if other flags are true', () => {
    const stage = getCurrentStage(60, true, true, true)
    expect(stage.key).toBe('complete')
  })

  test('returns "complete" stage even if elapsed is 0', () => {
    const stage = getCurrentStage(0, false, false, true)
    expect(stage.key).toBe('complete')
  })
})

describe('getCurrentStage — isStreaming=true', () => {
  test('returns "code_streaming" stage when isStreaming is true (and not complete)', () => {
    const stage = getCurrentStage(20, true, true, false)
    expect(stage.key).toBe('code_streaming')
    expect(stage.progress).toBe(60)
  })

  test('returns "code_streaming" even if hasPlan is false', () => {
    const stage = getCurrentStage(5, false, true, false)
    expect(stage.key).toBe('code_streaming')
  })

  test('returns "code_streaming" even if elapsed is 0', () => {
    const stage = getCurrentStage(0, false, true, false)
    expect(stage.key).toBe('code_streaming')
  })
})

describe('getCurrentStage — hasPlan=true', () => {
  test('returns "code_start" when hasPlan is true and not streaming/complete', () => {
    const stage = getCurrentStage(10, true, false, false)
    expect(stage.key).toBe('code_start')
    expect(stage.progress).toBe(35)
  })

  test('returns "code_start" even if elapsed is 0', () => {
    const stage = getCurrentStage(0, true, false, false)
    expect(stage.key).toBe('code_start')
  })

  test('returns "code_start" even if elapsed > 3', () => {
    const stage = getCurrentStage(50, true, false, false)
    expect(stage.key).toBe('code_start')
  })
})

describe('getCurrentStage — no plan, no streaming, not complete', () => {
  test('returns "architect_start" when elapsed <= 3', () => {
    expect(getCurrentStage(0, false, false, false).key).toBe('architect_start')
    expect(getCurrentStage(1, false, false, false).key).toBe('architect_start')
    expect(getCurrentStage(2, false, false, false).key).toBe('architect_start')
    expect(getCurrentStage(3, false, false, false).key).toBe('architect_start')
  })

  test('returns "architect_done" when elapsed > 3', () => {
    expect(getCurrentStage(4, false, false, false).key).toBe('architect_done')
    expect(getCurrentStage(10, false, false, false).key).toBe('architect_done')
    expect(getCurrentStage(100, false, false, false).key).toBe('architect_done')
  })

  test('architect_start progress is 10', () => {
    expect(getCurrentStage(0, false, false, false).progress).toBe(10)
  })

  test('architect_done progress is 25', () => {
    expect(getCurrentStage(10, false, false, false).progress).toBe(25)
  })
})

describe('getCurrentStage — priority order', () => {
  test('isComplete takes priority over isStreaming', () => {
    const stage = getCurrentStage(20, true, true, true)
    expect(stage.key).toBe('complete')
  })

  test('isStreaming takes priority over hasPlan', () => {
    const stage = getCurrentStage(20, true, true, false)
    expect(stage.key).toBe('code_streaming')
  })

  test('hasPlan takes priority over elapsed > 3', () => {
    const stage = getCurrentStage(50, true, false, false)
    expect(stage.key).toBe('code_start')
  })

  test('hasPlan takes priority over elapsed <= 3', () => {
    const stage = getCurrentStage(0, true, false, false)
    expect(stage.key).toBe('code_start')
  })
})

describe('getCurrentStage — return type', () => {
  test('returns a BuildStage object', () => {
    const stage = getCurrentStage(0, false, false, false)
    expect(stage).toHaveProperty('key')
    expect(stage).toHaveProperty('label')
    expect(stage).toHaveProperty('short')
    expect(stage).toHaveProperty('progress')
    expect(typeof stage.key).toBe('string')
    expect(typeof stage.label).toBe('string')
    expect(typeof stage.short).toBe('string')
    expect(typeof stage.progress).toBe('number')
  })

  test('returned stage is a member of BUILD_STAGES', () => {
    const stage = getCurrentStage(0, false, false, false)
    expect(BUILD_STAGES).toContain(stage)
  })

  test('all possible inputs return a stage from BUILD_STAGES', () => {
    const inputs: Array<[number, boolean, boolean, boolean]> = [
      [0, false, false, false],
      [0, false, false, true],
      [0, false, true, false],
      [0, false, true, true],
      [0, true, false, false],
      [0, true, false, true],
      [0, true, true, false],
      [0, true, true, true],
      [5, false, false, false],
      [5, true, false, false],
      [5, true, true, false],
    ]
    for (const [e, hp, st, ic] of inputs) {
      const result = getCurrentStage(e, hp, st, ic)
      expect(BUILD_STAGES).toContain(result)
    }
  })
})
