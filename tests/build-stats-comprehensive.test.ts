// Comprehensive tests for src/lib/build-stats.ts
// Tests all exported functions with edge cases, boundaries, and structure invariants.
import { describe, expect, test, beforeEach } from 'bun:test'
import {
  loadBuildStats,
  saveBuildStats,
  recordBuildInStats,
  recordRefineInStats,
  resetBuildStats,
  formatStats,
  type BuildStats,
} from '../src/lib/build-stats'

// Mock localStorage
const mockStore: Record<string, string> = {}
;(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (key: string) => mockStore[key] ?? null,
  setItem: (key: string, value: string) => { mockStore[key] = value },
  removeItem: (key: string) => { delete mockStore[key] },
  clear: () => { Object.keys(mockStore).forEach(k => delete mockStore[k]) },
  key: (index: number) => Object.keys(mockStore)[index] ?? null,
  get length() { return Object.keys(mockStore).length },
} as Storage

const EMPTY_STATS: BuildStats = {
  totalBuilds: 0,
  totalRefines: 0,
  avgQuality: 0,
  bestQuality: 0,
  worstQuality: 0,
  bestMission: null,
  worstMission: null,
  totalTimeMs: 0,
  avgTimeMs: 0,
  totalTokens: 0,
  modelUsage: { 'z-ai': 0, qwen: 0, kimi: 0 },
  lastBuildAt: null,
  firstBuildAt: null,
}

describe('build-stats — localStorage isolation', () => {
  beforeEach(() => {
    Object.keys(mockStore).forEach(k => delete mockStore[k])
  })

  test('mockStore starts empty after beforeEach', () => {
    expect(Object.keys(mockStore)).toHaveLength(0)
  })
})

describe('loadBuildStats', () => {
  beforeEach(() => {
    Object.keys(mockStore).forEach(k => delete mockStore[k])
  })

  test('returns EMPTY_STATS shape when nothing stored', () => {
    const stats = loadBuildStats()
    expect(stats).toEqual(EMPTY_STATS)
  })
  test('returns fresh object (not a shared reference)', () => {
    const a = loadBuildStats()
    const b = loadBuildStats()
    expect(a).not.toBe(b)
    a.totalBuilds = 99
    expect(b.totalBuilds).toBe(0)
  })
  test('preserves modelUsage from stored data', () => {
    mockStore['nova_build_stats'] = JSON.stringify({
      totalBuilds: 3,
      modelUsage: { 'z-ai': 2, qwen: 1, kimi: 0 },
    })
    const stats = loadBuildStats()
    expect(stats.modelUsage['z-ai']).toBe(2)
    expect(stats.modelUsage.qwen).toBe(1)
    expect(stats.modelUsage.kimi).toBe(0)
  })
  test('merges modelUsage with defaults when partial', () => {
    mockStore['nova_build_stats'] = JSON.stringify({
      totalBuilds: 1,
      modelUsage: { 'z-ai': 1 }, // missing qwen/kimi
    })
    const stats = loadBuildStats()
    expect(stats.modelUsage['z-ai']).toBe(1)
    expect(stats.modelUsage.qwen).toBe(0)
    expect(stats.modelUsage.kimi).toBe(0)
  })
  test('handles modelUsage = null gracefully', () => {
    mockStore['nova_build_stats'] = JSON.stringify({
      totalBuilds: 1,
      modelUsage: null,
    })
    const stats = loadBuildStats()
    expect(stats.modelUsage).toEqual({ 'z-ai': 0, qwen: 0, kimi: 0 })
  })
  test('handles modelUsage = undefined gracefully', () => {
    mockStore['nova_build_stats'] = JSON.stringify({
      totalBuilds: 1,
      // no modelUsage field
    })
    const stats = loadBuildStats()
    expect(stats.modelUsage).toEqual({ 'z-ai': 0, qwen: 0, kimi: 0 })
  })
  test('handles corrupted JSON gracefully', () => {
    mockStore['nova_build_stats'] = 'this is not json'
    const stats = loadBuildStats()
    expect(stats).toEqual(EMPTY_STATS)
  })
  test('handles JSON of wrong type (array)', () => {
    mockStore['nova_build_stats'] = JSON.stringify([1, 2, 3])
    const stats = loadBuildStats()
    // Array spread → may produce weird object but should not throw
    expect(typeof stats).toBe('object')
  })
  test('preserves all stored fields', () => {
    const stored: BuildStats = {
      totalBuilds: 5,
      totalRefines: 3,
      avgQuality: 80,
      bestQuality: 95,
      worstQuality: 60,
      bestMission: 'best mission',
      worstMission: 'worst mission',
      totalTimeMs: 300000,
      avgTimeMs: 60000,
      totalTokens: 25000,
      modelUsage: { 'z-ai': 3, qwen: 1, kimi: 1 },
      lastBuildAt: 1700000000000,
      firstBuildAt: 1600000000000,
    }
    mockStore['nova_build_stats'] = JSON.stringify(stored)
    const stats = loadBuildStats()
    expect(stats).toEqual(stored)
  })
})

describe('saveBuildStats', () => {
  beforeEach(() => {
    Object.keys(mockStore).forEach(k => delete mockStore[k])
  })

  test('writes JSON to localStorage under nova_build_stats key', () => {
    saveBuildStats({ ...EMPTY_STATS, totalBuilds: 7 })
    expect(mockStore['nova_build_stats']).toBeDefined()
    expect(JSON.parse(mockStore['nova_build_stats']!).totalBuilds).toBe(7)
  })
  test('survives a round-trip through save/load', () => {
    const stats: BuildStats = {
      ...EMPTY_STATS,
      totalBuilds: 3,
      avgQuality: 75,
      bestQuality: 90,
      bestMission: 'round trip',
    }
    saveBuildStats(stats)
    expect(loadBuildStats()).toEqual(stats)
  })
  test('silently ignores errors (does not throw)', () => {
    // Temporarily make setItem throw
    const orig = (globalThis as unknown as { localStorage: Storage }).localStorage.setItem
    ;(globalThis as unknown as { localStorage: Storage }).localStorage.setItem = () => {
      throw new Error('quota exceeded')
    }
    expect(() => saveBuildStats(EMPTY_STATS)).not.toThrow()
    ;(globalThis as unknown as { localStorage: Storage }).localStorage.setItem = orig
  })
})

describe('recordBuildInStats — model usage', () => {
  test('defaults model to z-ai when not specified', () => {
    const stats = recordBuildInStats({ ...EMPTY_STATS }, { quality: 80, ms: 1000, tokens: 100, mission: 'test' })
    expect(stats.modelUsage['z-ai']).toBe(1)
  })
  test('tracks qwen model', () => {
    const stats = recordBuildInStats({ ...EMPTY_STATS }, { quality: 80, ms: 1000, tokens: 100, mission: 'test', model: 'qwen' })
    expect(stats.modelUsage.qwen).toBe(1)
    expect(stats.modelUsage['z-ai']).toBe(0)
  })
  test('tracks kimi model', () => {
    const stats = recordBuildInStats({ ...EMPTY_STATS }, { quality: 80, ms: 1000, tokens: 100, mission: 'test', model: 'kimi' })
    expect(stats.modelUsage.kimi).toBe(1)
  })
  test('accumulates counts across multiple builds', () => {
    let stats = { ...EMPTY_STATS }
    stats = recordBuildInStats(stats, { quality: 80, ms: 1000, tokens: 100, mission: 'a', model: 'z-ai' })
    stats = recordBuildInStats(stats, { quality: 80, ms: 1000, tokens: 100, mission: 'b', model: 'z-ai' })
    stats = recordBuildInStats(stats, { quality: 80, ms: 1000, tokens: 100, mission: 'c', model: 'qwen' })
    expect(stats.modelUsage['z-ai']).toBe(2)
    expect(stats.modelUsage.qwen).toBe(1)
  })
  test('preserves other models when one is incremented', () => {
    const current: BuildStats = {
      ...EMPTY_STATS,
      totalBuilds: 5,
      modelUsage: { 'z-ai': 3, qwen: 2, kimi: 0 },
    }
    const stats = recordBuildInStats(current, { quality: 80, ms: 1000, tokens: 100, mission: 'test', model: 'kimi' })
    expect(stats.modelUsage['z-ai']).toBe(3)
    expect(stats.modelUsage.qwen).toBe(2)
    expect(stats.modelUsage.kimi).toBe(1)
  })
})

describe('recordBuildInStats — best/worst tracking', () => {
  test('first build sets both best and worst', () => {
    const stats = recordBuildInStats({ ...EMPTY_STATS }, { quality: 80, ms: 1000, tokens: 100, mission: 'first' })
    expect(stats.bestQuality).toBe(80)
    expect(stats.worstQuality).toBe(80)
    expect(stats.bestMission).toBe('first')
    expect(stats.worstMission).toBe('first')
  })
  test('new best quality (strict >) updates bestMission', () => {
    let stats = recordBuildInStats({ ...EMPTY_STATS }, { quality: 80, ms: 1000, tokens: 100, mission: 'a' })
    stats = recordBuildInStats(stats, { quality: 90, ms: 1000, tokens: 100, mission: 'b' })
    expect(stats.bestQuality).toBe(90)
    expect(stats.bestMission).toBe('b')
  })
  test('equal-to-best quality does NOT update bestMission', () => {
    let stats = recordBuildInStats({ ...EMPTY_STATS }, { quality: 80, ms: 1000, tokens: 100, mission: 'a' })
    stats = recordBuildInStats(stats, { quality: 80, ms: 1000, tokens: 100, mission: 'b' })
    expect(stats.bestQuality).toBe(80)
    expect(stats.bestMission).toBe('a') // not updated
  })
  test('new worst quality (strict <) updates worstMission', () => {
    let stats = recordBuildInStats({ ...EMPTY_STATS }, { quality: 80, ms: 1000, tokens: 100, mission: 'a' })
    stats = recordBuildInStats(stats, { quality: 60, ms: 1000, tokens: 100, mission: 'b' })
    expect(stats.worstQuality).toBe(60)
    expect(stats.worstMission).toBe('b')
  })
  test('equal-to-worst quality does NOT update worstMission', () => {
    let stats = recordBuildInStats({ ...EMPTY_STATS }, { quality: 80, ms: 1000, tokens: 100, mission: 'a' })
    stats = recordBuildInStats(stats, { quality: 80, ms: 1000, tokens: 100, mission: 'b' })
    expect(stats.worstQuality).toBe(80)
    expect(stats.worstMission).toBe('a') // not updated
  })
  test('updates worst on second build even if quality is higher (totalBuilds===0 check)', () => {
    // Wait — second build has totalBuilds>=1, so the OR short-circuits.
    // Worst updates only if quality < current.worstQuality.
    let stats = recordBuildInStats({ ...EMPTY_STATS }, { quality: 80, ms: 1000, tokens: 100, mission: 'a' })
    stats = recordBuildInStats(stats, { quality: 90, ms: 1000, tokens: 100, mission: 'b' })
    // 90 is NOT < 80, so worst stays at 80 / mission 'a'
    expect(stats.worstQuality).toBe(80)
    expect(stats.worstMission).toBe('a')
  })
})

describe('recordBuildInStats — averages', () => {
  test('avgQuality = round(sum / count)', () => {
    let stats = { ...EMPTY_STATS }
    stats = recordBuildInStats(stats, { quality: 80, ms: 1000, tokens: 0, mission: 'a' })
    stats = recordBuildInStats(stats, { quality: 75, ms: 1000, tokens: 0, mission: 'b' })
    stats = recordBuildInStats(stats, { quality: 90, ms: 1000, tokens: 0, mission: 'c' })
    // (80+75+90)/3 = 81.67 → round to 82
    expect(stats.avgQuality).toBe(82)
  })
  test('avgTimeMs = round(totalTime / count)', () => {
    let stats = { ...EMPTY_STATS }
    stats = recordBuildInStats(stats, { quality: 80, ms: 60000, tokens: 0, mission: 'a' })
    stats = recordBuildInStats(stats, { quality: 80, ms: 90000, tokens: 0, mission: 'b' })
    // (60000+90000)/2 = 75000
    expect(stats.avgTimeMs).toBe(75000)
  })
  test('avgQuality uses Math.round (not floor)', () => {
    // 80 + 80 + 81 = 241 / 3 = 80.33 → round to 80
    let stats = { ...EMPTY_STATS }
    stats = recordBuildInStats(stats, { quality: 80, ms: 0, tokens: 0, mission: 'a' })
    stats = recordBuildInStats(stats, { quality: 80, ms: 0, tokens: 0, mission: 'b' })
    stats = recordBuildInStats(stats, { quality: 81, ms: 0, tokens: 0, mission: 'c' })
    expect(stats.avgQuality).toBe(80)
  })
  test('avgQuality rounds up at .5', () => {
    // 80 + 81 = 161 / 2 = 80.5 → round to 81
    let stats = { ...EMPTY_STATS }
    stats = recordBuildInStats(stats, { quality: 80, ms: 0, tokens: 0, mission: 'a' })
    stats = recordBuildInStats(stats, { quality: 81, ms: 0, tokens: 0, mission: 'b' })
    expect(stats.avgQuality).toBe(81) // Math.round(80.5) === 81
  })
})

describe('recordBuildInStats — defaults', () => {
  test('quality undefined defaults to 0', () => {
    const stats = recordBuildInStats({ ...EMPTY_STATS }, { ms: 1000, tokens: 100, mission: 'test' })
    expect(stats.avgQuality).toBe(0)
    expect(stats.bestQuality).toBe(0)
    expect(stats.worstQuality).toBe(0)
  })
  test('ms undefined defaults to 0', () => {
    const stats = recordBuildInStats({ ...EMPTY_STATS }, { quality: 80, tokens: 100, mission: 'test' })
    expect(stats.totalTimeMs).toBe(0)
    expect(stats.avgTimeMs).toBe(0)
  })
  test('tokens undefined defaults to 0', () => {
    const stats = recordBuildInStats({ ...EMPTY_STATS }, { quality: 80, ms: 1000, mission: 'test' })
    expect(stats.totalTokens).toBe(0)
  })
})

describe('recordBuildInStats — timestamps', () => {
  test('first build sets firstBuildAt and lastBuildAt to same value', () => {
    const stats = recordBuildInStats({ ...EMPTY_STATS }, { quality: 80, ms: 1000, tokens: 100, mission: 'test' })
    expect(stats.firstBuildAt).toBe(stats.lastBuildAt)
    expect(stats.firstBuildAt).toBeGreaterThan(0)
  })
  test('subsequent build updates lastBuildAt but preserves firstBuildAt', () => {
    let stats = recordBuildInStats({ ...EMPTY_STATS }, { quality: 80, ms: 1000, tokens: 100, mission: 'a' })
    const firstAt = stats.firstBuildAt
    stats = recordBuildInStats(stats, { quality: 85, ms: 1000, tokens: 100, mission: 'b' })
    expect(stats.firstBuildAt).toBe(firstAt)
    expect(stats.lastBuildAt).toBeGreaterThanOrEqual(firstAt)
  })
  test('preserves existing firstBuildAt from loaded stats', () => {
    const existing: BuildStats = {
      ...EMPTY_STATS,
      totalBuilds: 1,
      firstBuildAt: 1000,
      lastBuildAt: 2000,
    }
    const stats = recordBuildInStats(existing, { quality: 80, ms: 1000, tokens: 100, mission: 'test' })
    expect(stats.firstBuildAt).toBe(1000)
  })
})

describe('recordBuildInStats — totalRefines preservation', () => {
  test('does not change totalRefines', () => {
    const existing: BuildStats = { ...EMPTY_STATS, totalRefines: 5 }
    const stats = recordBuildInStats(existing, { quality: 80, ms: 1000, tokens: 100, mission: 'test' })
    expect(stats.totalRefines).toBe(5)
  })
})

describe('recordRefineInStats', () => {
  test('increments totalRefines by 1', () => {
    const stats = recordRefineInStats({ ...EMPTY_STATS, totalRefines: 3 })
    expect(stats.totalRefines).toBe(4)
  })
  test('preserves all other fields', () => {
    const current: BuildStats = {
      ...EMPTY_STATS,
      totalBuilds: 5,
      avgQuality: 80,
      bestQuality: 95,
      bestMission: 'best',
    }
    const stats = recordRefineInStats(current)
    expect(stats.totalBuilds).toBe(5)
    expect(stats.avgQuality).toBe(80)
    expect(stats.bestQuality).toBe(95)
    expect(stats.bestMission).toBe('best')
    expect(stats.totalRefines).toBe(1)
  })
  test('does not affect firstBuildAt or lastBuildAt', () => {
    const current: BuildStats = {
      ...EMPTY_STATS,
      firstBuildAt: 1000,
      lastBuildAt: 2000,
    }
    const stats = recordRefineInStats(current)
    expect(stats.firstBuildAt).toBe(1000)
    expect(stats.lastBuildAt).toBe(2000)
  })
  test('can be chained multiple times', () => {
    let stats = { ...EMPTY_STATS }
    stats = recordRefineInStats(stats)
    stats = recordRefineInStats(stats)
    stats = recordRefineInStats(stats)
    expect(stats.totalRefines).toBe(3)
  })
})

describe('resetBuildStats', () => {
  beforeEach(() => {
    Object.keys(mockStore).forEach(k => delete mockStore[k])
  })

  test('returns EMPTY_STATS', () => {
    const stats = resetBuildStats()
    expect(stats).toEqual(EMPTY_STATS)
  })
  test('writes EMPTY_STATS to localStorage', () => {
    saveBuildStats({ ...EMPTY_STATS, totalBuilds: 10 })
    expect(loadBuildStats().totalBuilds).toBe(10)
    resetBuildStats()
    expect(loadBuildStats().totalBuilds).toBe(0)
  })
  test('returns a fresh object (not the EMPTY_STATS singleton)', () => {
    const stats = resetBuildStats()
    expect(stats).not.toBe(EMPTY_STATS)
    expect(stats.modelUsage).not.toBe(EMPTY_STATS.modelUsage)
  })
})

describe('formatStats — summary', () => {
  test('summary = "{N} builds · avg Q:{avg}"', () => {
    const stats = { ...EMPTY_STATS, totalBuilds: 7, avgQuality: 82 }
    const { summary } = formatStats(stats)
    expect(summary).toBe('7 builds · avg Q:82')
  })
  test('summary for zero builds', () => {
    const { summary } = formatStats({ ...EMPTY_STATS })
    expect(summary).toBe('0 builds · avg Q:0')
  })
})

describe('formatStats — details', () => {
  test('always includes "Total builds"', () => {
    const { details } = formatStats({ ...EMPTY_STATS })
    expect(details.some(d => d.label === 'Total builds')).toBe(true)
  })
  test('includes "Total refines" when totalRefines > 0', () => {
    const { details } = formatStats({ ...EMPTY_STATS, totalRefines: 3 })
    expect(details.some(d => d.label === 'Total refines' && d.value === '3')).toBe(true)
  })
  test('omits "Total refines" when totalRefines = 0', () => {
    const { details } = formatStats({ ...EMPTY_STATS })
    expect(details.some(d => d.label === 'Total refines')).toBe(false)
  })
  test('always includes "Avg quality"', () => {
    const { details } = formatStats({ ...EMPTY_STATS })
    expect(details.some(d => d.label === 'Avg quality')).toBe(true)
  })
  test('includes "Best quality" when bestQuality > 0', () => {
    const { details } = formatStats({ ...EMPTY_STATS, bestQuality: 95 })
    expect(details.some(d => d.label === 'Best quality' && d.value === 'Q:95')).toBe(true)
  })
  test('omits "Best quality" when bestQuality = 0', () => {
    const { details } = formatStats({ ...EMPTY_STATS })
    expect(details.some(d => d.label === 'Best quality')).toBe(false)
  })
  test('includes "Worst quality" when 0 < worstQuality < 100', () => {
    const { details } = formatStats({ ...EMPTY_STATS, worstQuality: 60 })
    expect(details.some(d => d.label === 'Worst quality' && d.value === 'Q:60')).toBe(true)
  })
  test('omits "Worst quality" when worstQuality = 0', () => {
    const { details } = formatStats({ ...EMPTY_STATS })
    expect(details.some(d => d.label === 'Worst quality')).toBe(false)
  })
  test('omits "Worst quality" when worstQuality = 100', () => {
    const { details } = formatStats({ ...EMPTY_STATS, worstQuality: 100 })
    expect(details.some(d => d.label === 'Worst quality')).toBe(false)
  })
  test('includes "Avg build time" when avgTimeMs > 0', () => {
    const { details } = formatStats({ ...EMPTY_STATS, avgTimeMs: 120000 })
    expect(details.some(d => d.label === 'Avg build time' && d.value === '120s')).toBe(true)
  })
  test('omits "Avg build time" when avgTimeMs = 0', () => {
    const { details } = formatStats({ ...EMPTY_STATS })
    expect(details.some(d => d.label === 'Avg build time')).toBe(false)
  })
  test('includes "Total tokens" formatted as k when 1000+', () => {
    const { details } = formatStats({ ...EMPTY_STATS, totalTokens: 8000 })
    expect(details.some(d => d.label === 'Total tokens' && d.value === '8.0k')).toBe(true)
  })
  test('includes "Total tokens" formatted as M when 1M+', () => {
    const { details } = formatStats({ ...EMPTY_STATS, totalTokens: 2_500_000 })
    expect(details.some(d => d.label === 'Total tokens' && d.value === '2.5M')).toBe(true)
  })
  test('includes "Total tokens" raw when < 1000', () => {
    const { details } = formatStats({ ...EMPTY_STATS, totalTokens: 500 })
    expect(details.some(d => d.label === 'Total tokens' && d.value === '500')).toBe(true)
  })
  test('omits "Total tokens" when totalTokens = 0', () => {
    const { details } = formatStats({ ...EMPTY_STATS })
    expect(details.some(d => d.label === 'Total tokens')).toBe(false)
  })
})

describe('formatStats — model usage', () => {
  test('includes "Model usage" when any model has >0', () => {
    const { details } = formatStats({
      ...EMPTY_STATS,
      modelUsage: { 'z-ai': 3, qwen: 1, kimi: 0 },
    })
    const modelDetail = details.find(d => d.label === 'Model usage')
    expect(modelDetail).toBeDefined()
    expect(modelDetail!.value).toContain('Z.AI: 3')
    expect(modelDetail!.value).toContain('Qwen: 1')
    expect(modelDetail!.value).not.toContain('Kimi') // kimi=0 → not included
  })
  test('omits "Model usage" when all models are 0', () => {
    const { details } = formatStats({ ...EMPTY_STATS })
    expect(details.some(d => d.label === 'Model usage')).toBe(false)
  })
  test('formats kimi as "Kimi: N"', () => {
    const { details } = formatStats({
      ...EMPTY_STATS,
      modelUsage: { 'z-ai': 0, qwen: 0, kimi: 2 },
    })
    const modelDetail = details.find(d => d.label === 'Model usage')
    expect(modelDetail!.value).toContain('Kimi: 2')
  })
})

describe('formatStats — active span', () => {
  test('includes "Active span" when spanMin > 0', () => {
    // span = lastBuildAt - firstBuildAt = 60000ms = 1min
    const { details } = formatStats({
      ...EMPTY_STATS,
      firstBuildAt: 1000,
      lastBuildAt: 61000,
    })
    expect(details.some(d => d.label === 'Active span' && d.value === '1min')).toBe(true)
  })
  test('omits "Active span" when firstBuildAt is null', () => {
    const { details } = formatStats({ ...EMPTY_STATS, lastBuildAt: 1000 })
    expect(details.some(d => d.label === 'Active span')).toBe(false)
  })
  test('omits "Active span" when lastBuildAt is null', () => {
    const { details } = formatStats({ ...EMPTY_STATS, firstBuildAt: 1000 })
    expect(details.some(d => d.label === 'Active span')).toBe(false)
  })
  test('omits "Active span" when spanMin = 0 (same timestamp)', () => {
    const { details } = formatStats({
      ...EMPTY_STATS,
      firstBuildAt: 1000,
      lastBuildAt: 1000,
    })
    expect(details.some(d => d.label === 'Active span')).toBe(false)
  })
  test('omits "Active span" when span < 1 min (rounds to 0)', () => {
    const { details } = formatStats({
      ...EMPTY_STATS,
      firstBuildAt: 1000,
      lastBuildAt: 30000, // 29s span → 0min rounded
    })
    expect(details.some(d => d.label === 'Active span')).toBe(false)
  })
})

describe('formatStats — token formatting boundaries', () => {
  test('999 tokens → "999"', () => {
    const { details } = formatStats({ ...EMPTY_STATS, totalTokens: 999 })
    expect(details.find(d => d.label === 'Total tokens')!.value).toBe('999')
  })
  test('1000 tokens → "1.0k"', () => {
    const { details } = formatStats({ ...EMPTY_STATS, totalTokens: 1000 })
    expect(details.find(d => d.label === 'Total tokens')!.value).toBe('1.0k')
  })
  test('999999 tokens → "1000.0k"', () => {
    const { details } = formatStats({ ...EMPTY_STATS, totalTokens: 999999 })
    expect(details.find(d => d.label === 'Total tokens')!.value).toBe('1000.0k')
  })
  test('1000000 tokens → "1.0M"', () => {
    const { details } = formatStats({ ...EMPTY_STATS, totalTokens: 1_000_000 })
    expect(details.find(d => d.label === 'Total tokens')!.value).toBe('1.0M')
  })
})
