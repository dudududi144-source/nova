// Tests for build stats tracking
import { describe, it, expect, beforeEach, mock } from 'bun:test'
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
mock.module('global', () => ({
  localStorage: {
    getItem: (key: string) => mockStore[key] ?? null,
    setItem: (key: string, value: string) => { mockStore[key] = value },
    removeItem: (key: string) => { delete mockStore[key] },
  },
}))

// Override global localStorage
;(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (key: string) => mockStore[key] ?? null,
  setItem: (key: string, value: string) => { mockStore[key] = value },
  removeItem: (key: string) => { delete mockStore[key] },
  clear: () => { Object.keys(mockStore).forEach(k => delete mockStore[k]) },
  key: (index: number) => Object.keys(mockStore)[index] ?? null,
  get length() { return Object.keys(mockStore).length },
} as Storage

describe('build-stats', () => {
  beforeEach(() => {
    Object.keys(mockStore).forEach(k => delete mockStore[k])
  })

  describe('loadBuildStats', () => {
    it('returns empty stats when nothing stored', () => {
      const stats = loadBuildStats()
      expect(stats.totalBuilds).toBe(0)
      expect(stats.avgQuality).toBe(0)
    })

    it('loads stored stats', () => {
      mockStore['nova_build_stats'] = JSON.stringify({
        totalBuilds: 5,
        avgQuality: 85,
        bestQuality: 95,
      })
      const stats = loadBuildStats()
      expect(stats.totalBuilds).toBe(5)
      expect(stats.avgQuality).toBe(85)
    })

    it('handles corrupted data gracefully', () => {
      mockStore['nova_build_stats'] = 'not json'
      const stats = loadBuildStats()
      expect(stats.totalBuilds).toBe(0)
    })

    it('merges with defaults for missing fields', () => {
      mockStore['nova_build_stats'] = JSON.stringify({ totalBuilds: 3 })
      const stats = loadBuildStats()
      expect(stats.totalBuilds).toBe(3)
      expect(stats.modelUsage).toBeDefined()
      expect(stats.modelUsage['z-ai']).toBe(0)
    })
  })

  describe('recordBuildInStats', () => {
    it('records first build', () => {
      const empty = loadBuildStats()
      const updated = recordBuildInStats(empty, {
        quality: 85, ms: 60000, tokens: 5000, mission: 'todo app', model: 'z-ai',
      })
      expect(updated.totalBuilds).toBe(1)
      expect(updated.avgQuality).toBe(85)
      expect(updated.bestQuality).toBe(85)
      expect(updated.worstQuality).toBe(85)
      expect(updated.bestMission).toBe('todo app')
      expect(updated.modelUsage['z-ai']).toBe(1)
    })

    it('records second build with better quality', () => {
      let stats = recordBuildInStats(loadBuildStats(), {
        quality: 70, ms: 60000, tokens: 4000, mission: 'first', model: 'z-ai',
      })
      stats = recordBuildInStats(stats, {
        quality: 90, ms: 80000, tokens: 6000, mission: 'second', model: 'qwen',
      })
      expect(stats.totalBuilds).toBe(2)
      expect(stats.avgQuality).toBe(80) // (70+90)/2
      expect(stats.bestQuality).toBe(90)
      expect(stats.bestMission).toBe('second')
      expect(stats.worstQuality).toBe(70)
      expect(stats.worstMission).toBe('first')
      expect(stats.modelUsage['z-ai']).toBe(1)
      expect(stats.modelUsage['qwen']).toBe(1)
    })

    it('tracks total time and tokens', () => {
      let stats = recordBuildInStats(loadBuildStats(), {
        quality: 80, ms: 60000, tokens: 5000, mission: 'a', model: 'z-ai',
      })
      stats = recordBuildInStats(stats, {
        quality: 85, ms: 90000, tokens: 7000, mission: 'b', model: 'z-ai',
      })
      expect(stats.totalTimeMs).toBe(150000)
      expect(stats.avgTimeMs).toBe(75000)
      expect(stats.totalTokens).toBe(12000)
    })

    it('handles missing quality (defaults to 0)', () => {
      const stats = recordBuildInStats(loadBuildStats(), {
        ms: 60000, tokens: 5000, mission: 'test',
      })
      expect(stats.avgQuality).toBe(0)
      expect(stats.bestQuality).toBe(0)
    })

    it('handles missing ms and tokens', () => {
      const stats = recordBuildInStats(loadBuildStats(), {
        quality: 80, mission: 'test', model: 'kimi',
      })
      expect(stats.totalTimeMs).toBe(0)
      expect(stats.totalTokens).toBe(0)
      expect(stats.modelUsage['kimi']).toBe(1)
    })

    it('sets firstBuildAt and lastBuildAt', () => {
      const stats = recordBuildInStats(loadBuildStats(), {
        quality: 80, ms: 60000, tokens: 5000, mission: 'test', model: 'z-ai',
      })
      expect(stats.firstBuildAt).not.toBeNull()
      expect(stats.lastBuildAt).not.toBeNull()
      expect(stats.firstBuildAt).toBe(stats.lastBuildAt)
    })
  })

  describe('recordRefineInStats', () => {
    it('increments refine count', () => {
      let stats = recordBuildInStats(loadBuildStats(), {
        quality: 80, ms: 60000, tokens: 5000, mission: 'test', model: 'z-ai',
      })
      stats = recordRefineInStats(stats)
      expect(stats.totalRefines).toBe(1)
      expect(stats.totalBuilds).toBe(1) // unchanged
    })
  })

  describe('resetBuildStats', () => {
    it('clears all stats', () => {
      let stats = recordBuildInStats(loadBuildStats(), {
        quality: 80, ms: 60000, tokens: 5000, mission: 'test', model: 'z-ai',
      })
      saveBuildStats(stats)
      stats = resetBuildStats()
      expect(stats.totalBuilds).toBe(0)
      expect(loadBuildStats().totalBuilds).toBe(0)
    })
  })

  describe('formatStats', () => {
    it('formats empty stats', () => {
      const { summary, details } = formatStats(loadBuildStats())
      expect(summary).toBe('0 builds · avg Q:0')
      expect(details.length).toBeGreaterThan(0)
      expect(details[0].label).toBe('Total builds')
    })

    it('formats stats with builds', () => {
      let stats = recordBuildInStats(loadBuildStats(), {
        quality: 85, ms: 120000, tokens: 8000, mission: 'todo', model: 'z-ai',
      })
      const { summary, details } = formatStats(stats)
      expect(summary).toBe('1 builds · avg Q:85')
      expect(details.some(d => d.label === 'Avg quality' && d.value === 'Q:85')).toBe(true)
      expect(details.some(d => d.label === 'Avg build time' && d.value === '120s')).toBe(true)
      expect(details.some(d => d.label === 'Total tokens' && d.value === '8.0k')).toBe(true)
    })

    it('includes model usage when present', () => {
      let stats = recordBuildInStats(loadBuildStats(), {
        quality: 80, ms: 60000, tokens: 5000, mission: 'a', model: 'z-ai',
      })
      stats = recordBuildInStats(stats, {
        quality: 85, ms: 70000, tokens: 6000, mission: 'b', model: 'qwen',
      })
      const { details } = formatStats(stats)
      const modelDetail = details.find(d => d.label === 'Model usage')
      expect(modelDetail).toBeDefined()
      expect(modelDetail!.value).toContain('Z.AI: 1')
      expect(modelDetail!.value).toContain('Qwen: 1')
    })
  })
})
