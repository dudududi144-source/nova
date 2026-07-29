// Test that newBuildId generates unique IDs
// We can't import newBuildId directly (it's not exported from page.tsx),
// so we replicate the function and test the algorithm.
import { describe, it, expect } from 'bun:test'

// Replicated from src/app/page.tsx
function newBuildId(): string {
  return `b_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
}

describe('newBuildId uniqueness', () => {
  it('generates unique IDs in rapid succession', () => {
    const ids = new Set<string>()
    for (let i = 0; i < 10000; i++) {
      ids.add(newBuildId())
    }
    expect(ids.size).toBe(10000)
  })

  it('generates IDs with the correct prefix', () => {
    const id = newBuildId()
    expect(id.startsWith('b_')).toBe(true)
  })

  it('generates IDs with 3 parts (prefix, timestamp, random)', () => {
    const id = newBuildId()
    const parts = id.split('_')
    expect(parts).toHaveLength(3)
    expect(parts[0]).toBe('b')
    expect(parts[1].length).toBeGreaterThan(0)
    expect(parts[2].length).toBe(5)
  })

  it('generates IDs that are sortable by time (roughly)', () => {
    const id1 = newBuildId()
    const id2 = newBuildId()
    // The timestamp part should be non-decreasing
    const ts1 = parseInt(id1.split('_')[1], 36)
    const ts2 = parseInt(id2.split('_')[1], 36)
    expect(ts2).toBeGreaterThanOrEqual(ts1)
  })
})
