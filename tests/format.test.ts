// Tests for format utilities (stolen from TFA Evolution Studio, improved)
import { describe, it, expect } from 'bun:test'
import { formatTokens, formatMs, timeAgo, BUILD_STAGES, getCurrentStage } from '../src/lib/format'

describe('formatTokens', () => {
  it('formats small numbers as-is', () => {
    expect(formatTokens(0)).toBe('0')
    expect(formatTokens(42)).toBe('42')
    expect(formatTokens(999)).toBe('999')
  })

  it('formats thousands with k suffix', () => {
    expect(formatTokens(1000)).toBe('1.0k')
    expect(formatTokens(2500)).toBe('2.5k')
    expect(formatTokens(999999)).toBe('1000.0k')
  })

  it('formats millions with M suffix', () => {
    expect(formatTokens(1000000)).toBe('1.0M')
    expect(formatTokens(2500000)).toBe('2.5M')
  })
})

describe('formatMs', () => {
  it('handles null and 0', () => {
    expect(formatMs(null)).toBe('—')
    expect(formatMs(0)).toBe('—')
    expect(formatMs(undefined)).toBe('—')
  })

  it('formats milliseconds', () => {
    expect(formatMs(1)).toBe('1ms')
    expect(formatMs(500)).toBe('500ms')
    expect(formatMs(999)).toBe('999ms')
  })

  it('formats seconds', () => {
    expect(formatMs(1000)).toBe('1.0s')
    expect(formatMs(50000)).toBe('50.0s')
    expect(formatMs(125000)).toBe('125.0s')
  })
})

describe('timeAgo', () => {
  it('returns "just now" for recent times', () => {
    const now = Date.now()
    expect(timeAgo(now)).toBe('just now')
    expect(timeAgo(new Date(now - 30000).toISOString())).toBe('just now')
  })

  it('returns minutes', () => {
    const now = Date.now()
    expect(timeAgo(new Date(now - 60000).toISOString())).toBe('1m ago')
    expect(timeAgo(new Date(now - 300000).toISOString())).toBe('5m ago')
  })

  it('returns hours', () => {
    const now = Date.now()
    expect(timeAgo(new Date(now - 3600000).toISOString())).toBe('1h ago')
    expect(timeAgo(new Date(now - 7200000).toISOString())).toBe('2h ago')
  })

  it('returns days', () => {
    const now = Date.now()
    expect(timeAgo(new Date(now - 86400000).toISOString())).toBe('1d ago')
    expect(timeAgo(new Date(now - 172800000).toISOString())).toBe('2d ago')
  })

  it('returns "unknown" for invalid dates (roast #7 fix)', () => {
    expect(timeAgo('not a date')).toBe('unknown')
    expect(timeAgo('')).toBe('unknown')
  })
})

describe('BUILD_STAGES', () => {
  it('has 7 stages', () => {
    expect(BUILD_STAGES.length).toBe(7)
  })

  it('stages are in progress order', () => {
    for (let i = 1; i < BUILD_STAGES.length; i++) {
      expect(BUILD_STAGES[i].progress).toBeGreaterThan(BUILD_STAGES[i - 1].progress)
    }
  })

  it('first stage is architect_start', () => {
    expect(BUILD_STAGES[0].key).toBe('architect_start')
  })

  it('last stage is complete with 100%', () => {
    expect(BUILD_STAGES[6].key).toBe('complete')
    expect(BUILD_STAGES[6].progress).toBe(100)
  })

  it('each stage has label and short', () => {
    for (const s of BUILD_STAGES) {
      expect(s.label.length).toBeGreaterThan(0)
      expect(s.short.length).toBeGreaterThan(0)
    }
  })
})

describe('getCurrentStage', () => {
  it('returns complete stage when isComplete', () => {
    const stage = getCurrentStage(60, true, false, true)
    expect(stage.key).toBe('complete')
    expect(stage.progress).toBe(100)
  })

  it('returns streaming stage when isStreaming', () => {
    const stage = getCurrentStage(20, true, true, false)
    expect(stage.key).toBe('code_streaming')
  })

  it('returns architect_start for early builds', () => {
    const stage = getCurrentStage(1, false, false, false)
    expect(stage.key).toBe('architect_start')
  })

  it('returns architect_done after 3s', () => {
    const stage = getCurrentStage(5, false, false, false)
    expect(stage.key).toBe('architect_done')
  })

  it('returns code_start when has plan but not streaming (waiting for first token)', () => {
    const stage = getCurrentStage(10, true, false, false)
    expect(stage.key).toBe('code_start')
  })
})
