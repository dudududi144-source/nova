// Tests for build-memory.ts — normalizeMission (pure function) and graceful
// fallback for the IndexedDB-backed async functions.
//
// Note: IndexedDB is not available in the bun test environment, so the async
// functions should gracefully return null/empty/[] rather than throwing.
import { describe, it, expect } from 'bun:test'
import {
  normalizeMission,
  cacheBuild,
  findCachedBuildNormalized,
  findSimilarBuilds,
  getRecentBuilds,
  getAllBuilds,
  cleanupExpired,
  clearAllBuilds,
} from '../src/lib/build-memory'
import type { BuildResult } from '../src/lib/helpers'

function makeBuild(mission: string, html: string = '<html></html>'): BuildResult {
  return { id: 'b1', html, tokens: 100, ms: 500, mission }
}

describe('normalizeMission', () => {
  it('returns empty string for empty input', () => {
    expect(normalizeMission('')).toBe('')
  })

  it('returns empty string for null/undefined input', () => {
    expect(normalizeMission(null as unknown as string)).toBe('')
    expect(normalizeMission(undefined as unknown as string)).toBe('')
  })

  it('lowercases the mission', () => {
    expect(normalizeMission('BUILD A SNAKE GAME')).toBe('a build game snake')
  })

  it('sorts words alphabetically', () => {
    const result = normalizeMission('snake game build')
    expect(result).toBe('build game snake')
  })

  it('is word-order independent', () => {
    const a = normalizeMission('build a snake game')
    const b = normalizeMission('game snake a build')
    const c = normalizeMission('a snake game build')
    expect(a).toBe(b)
    expect(b).toBe(c)
  })

  it('strips punctuation', () => {
    const result = normalizeMission('Build a snake game, with score & pause!')
    // Punctuation replaced with spaces, then words sorted
    expect(result).not.toContain(',')
    expect(result).not.toContain('!')
    expect(result).not.toContain('&')
  })

  it('collapses whitespace', () => {
    const result = normalizeMission('build   a\n\tsnake\t\tgame')
    expect(result).not.toContain('\n')
    expect(result).not.toContain('\t')
    expect(result).not.toMatch(/ {2,}/)
  })

  it('handles unicode characters by stripping them', () => {
    // build-memory.ts strips non-alphanumeric ASCII
    const result = normalizeMission('build a 🐍 snake game')
    expect(result).not.toContain('🐍')
  })

  it('preserves digits', () => {
    const result = normalizeMission('build a snake game 2')
    expect(result).toContain('2')
  })

  it('preserves letters and spaces only', () => {
    const result = normalizeMission('Hello, World! 123')
    // All punctuation stripped, words sorted
    expect(result).toMatch(/^[a-z0-9 ]+$/)
  })

  it('produces stable output for the same input', () => {
    const a = normalizeMission('Build a Todo App with Filters')
    const b = normalizeMission('Build a Todo App with Filters')
    expect(a).toBe(b)
  })

  it('returns a single word unchanged (just lowercased)', () => {
    expect(normalizeMission('Snake')).toBe('snake')
  })

  it('handles strings with only punctuation', () => {
    const result = normalizeMission('!!! ??? ...')
    expect(result).toBe('')
  })
})

describe('build-memory — graceful fallback when IndexedDB is unavailable', () => {
  // In the bun test environment, IndexedDB is not defined, so all async
  // functions should gracefully resolve to null/empty/[] without throwing.

  it('cacheBuild resolves without throwing', async () => {
    await expect(cacheBuild(makeBuild('test'), 80)).resolves.toBeUndefined()
  })

  it('findCachedBuildNormalized resolves to null', async () => {
    await expect(findCachedBuildNormalized('snake game')).resolves.toBeNull()
  })

  it('findSimilarBuilds resolves to empty array', async () => {
    await expect(findSimilarBuilds('snake game')).resolves.toEqual([])
  })

  it('getRecentBuilds resolves to empty array', async () => {
    await expect(getRecentBuilds(10)).resolves.toEqual([])
  })

  it('getAllBuilds resolves to empty array', async () => {
    await expect(getAllBuilds()).resolves.toEqual([])
  })

  it('cleanupExpired resolves to 0', async () => {
    await expect(cleanupExpired()).resolves.toBe(0)
  })

  it('clearAllBuilds resolves without throwing', async () => {
    await expect(clearAllBuilds()).resolves.toBeUndefined()
  })

  it('cacheBuild does not throw for low quality', async () => {
    await expect(cacheBuild(makeBuild('test'), 0)).resolves.toBeUndefined()
  })

  it('cacheBuild does not throw for high quality', async () => {
    await expect(cacheBuild(makeBuild('test'), 100)).resolves.toBeUndefined()
  })

  it('findSimilarBuilds with custom limit does not throw', async () => {
    await expect(findSimilarBuilds('test', 5)).resolves.toEqual([])
  })

  it('getRecentBuilds with custom limit does not throw', async () => {
    await expect(getRecentBuilds(5)).resolves.toEqual([])
  })

  it('multiple sequential calls all succeed', async () => {
    await cacheBuild(makeBuild('a'), 70)
    await cacheBuild(makeBuild('b'), 80)
    await cacheBuild(makeBuild('c'), 90)
    const cached = await findCachedBuildNormalized('a')
    expect(cached).toBeNull()
    const recent = await getRecentBuilds()
    expect(recent).toEqual([])
  })

  it('normalizeMission can be used to pre-normalize for cacheBuild', async () => {
    // This is the intended usage pattern
    const mission = 'Build a Snake Game'
    const normalized = normalizeMission(mission)
    expect(normalized).toBe('a build game snake')
    await cacheBuild({ ...makeBuild(mission), mission }, 85)
    const found = await findCachedBuildNormalized(mission)
    expect(found).toBeNull() // IndexedDB unavailable in test env
  })
})
