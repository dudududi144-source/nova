// Tests for smart mission analysis
import { describe, it, expect } from 'bun:test'
import { analyzeMission } from '../src/lib/mission-analysis'

describe('analyzeMission', () => {
  describe('complexity detection', () => {
    it('detects simple apps', () => {
      const result = analyzeMission('Build a counter app')
      expect(result.complexity).toBe('simple')
    })

    it('detects medium complexity', () => {
      const result = analyzeMission('Build a todo app with add, delete, and filter')
      expect(result.complexity).toBe('medium')
    })

    it('detects complex apps with multiple complex keywords', () => {
      const result = analyzeMission('Build a real-time collaborative dashboard with live streaming and 3D visualization')
      expect(result.complexity).toBe('complex')
    })

    it('detects complex apps with complex keyword + multiple features', () => {
      const result = analyzeMission('Build a 3D game with physics, collision, and scoring')
      expect(result.complexity).toBe('complex')
    })

    it('provides complexity reason', () => {
      const result = analyzeMission('Build a snake game')
      expect(result.complexityReason).toBeTruthy()
      expect(result.complexityReason.length).toBeGreaterThan(0)
    })
  })

  describe('vagueness detection', () => {
    it('detects too-vague prompts', () => {
      const result = analyzeMission('todo')
      expect(result.vagueness).toBe('too-vague')
    })

    it('detects "an app" as too-vague', () => {
      const result = analyzeMission('an app')
      expect(result.vagueness).toBe('too-vague')
    })

    it('detects short vague prompts', () => {
      const result = analyzeMission('todo app')
      expect(result.vagueness).toBe('vague')
    })

    it('does not flag detailed prompts as vague', () => {
      const result = analyzeMission('Build a todo app with add, delete, complete, filter by status, and drag-and-drop reordering')
      expect(result.vagueness).toBe('none')
    })

    it('provides vagueness reason when vague', () => {
      const result = analyzeMission('todo')
      expect(result.vaguenessReason).toBeTruthy()
      expect(result.vaguenessReason.length).toBeGreaterThan(0)
    })
  })

  describe('over-scope detection', () => {
    it('detects operating system requests', () => {
      const result = analyzeMission('Build an operating system with windows and file manager')
      expect(result.isTooComplex).toBe(true)
    })

    it('detects database server requests', () => {
      const result = analyzeMission('Build a database server with SQL support')
      expect(result.isTooComplex).toBe(true)
    })

    it('does not flag normal apps as too complex', () => {
      const result = analyzeMission('Build a todo app with add and delete')
      expect(result.isTooComplex).toBe(false)
    })
  })

  describe('time estimation', () => {
    it('estimates time based on complexity', () => {
      const simple = analyzeMission('Build a counter app')
      const complex = analyzeMission('Build a real-time collaborative 3D dashboard with streaming and physics')
      expect(complex.estimatedTime).toBeGreaterThan(simple.estimatedTime)
    })

    it('estimates more time for more features', () => {
      const few = analyzeMission('Build a todo app with add')
      const many = analyzeMission('Build a todo app with add, delete, complete, filter, search, and drag-and-drop')
      expect(many.estimatedTime).toBeGreaterThanOrEqual(few.estimatedTime)
    })

    it('returns reasonable time range (1-15 min)', () => {
      const result = analyzeMission('Build a calculator with history')
      expect(result.estimatedTime).toBeGreaterThan(60)
      expect(result.estimatedTime).toBeLessThan(900)
    })
  })

  describe('model recommendation', () => {
    it('recommends Qwen for simple apps', () => {
      const result = analyzeMission('Build a counter app')
      expect(result.recommendedModel).toBe('qwen')
    })

    it('recommends Z.AI for medium apps', () => {
      const result = analyzeMission('Build a todo app with add, delete, and filter')
      expect(result.recommendedModel).toBe('z-ai')
    })

    it('recommends Kimi for complex apps', () => {
      const result = analyzeMission('Build a real-time collaborative 3D dashboard with streaming and physics')
      expect(result.recommendedModel).toBe('kimi')
    })

    it('provides model reason', () => {
      const result = analyzeMission('Build a counter app')
      expect(result.modelReason).toBeTruthy()
      expect(result.modelReason.length).toBeGreaterThan(0)
    })
  })

  describe('suggestions', () => {
    it('suggests adding features for vague prompts', () => {
      const result = analyzeMission('todo')
      expect(result.suggestions.length).toBeGreaterThan(0)
      expect(result.suggestions.some(s => s.includes('feature'))).toBe(true)
    })

    it('suggests simplifying for over-scoped requests', () => {
      const result = analyzeMission('Build an operating system with file manager')
      expect(result.suggestions.some(s => s.includes('simplif') || s.includes('single-file'))).toBe(true)
    })

    it('gives positive feedback for good prompts', () => {
      const result = analyzeMission('Build a todo app with add, delete, complete, filter by status, and drag-and-drop reordering')
      expect(result.suggestions.some(s => s.includes('good') || s.includes('ready'))).toBe(true)
    })

    it('warns about too many features', () => {
      const result = analyzeMission('Build a dashboard with charts, filters, search, export, settings, themes, notifications, and analytics')
      expect(result.suggestions.some(s => s.includes('Many features') || s.includes('splitting'))).toBe(true)
    })
  })

  describe('edge cases', () => {
    it('handles empty string', () => {
      const result = analyzeMission('')
      expect(result.wordCount).toBe(0)
      expect(result.complexity).toBeDefined()
    })

    it('handles very long prompts', () => {
      const long = 'Build a ' + 'feature '.repeat(50) + 'app'
      const result = analyzeMission(long)
      expect(result.wordCount).toBeGreaterThan(50)
    })

    it('is case-insensitive', () => {
      const lower = analyzeMission('build a todo app')
      const upper = analyzeMission('BUILD A TODO APP')
      expect(lower.complexity).toBe(upper.complexity)
      expect(lower.vagueness).toBe(upper.vagueness)
    })
  })
})
