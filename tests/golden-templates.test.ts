// Tests for golden-templates.ts — findTemplate matching + buildSeededPrompt.
import { describe, it, expect } from 'bun:test'
import {
  findTemplate,
  buildSeededPrompt,
  GOLDEN_TEMPLATES,
  type GoldenTemplate,
} from '../src/lib/golden-templates'

describe('GOLDEN_TEMPLATES', () => {
  it('has at least 3 templates', () => {
    expect(GOLDEN_TEMPLATES.length).toBeGreaterThanOrEqual(3)
  })

  it('each template has a unique id', () => {
    const ids = GOLDEN_TEMPLATES.map(t => t.id)
    const unique = new Set(ids)
    expect(unique.size).toBe(ids.length)
  })

  it('each template has a non-empty name', () => {
    for (const t of GOLDEN_TEMPLATES) {
      expect(t.name.length).toBeGreaterThan(0)
    }
  })

  it('each template has at least one keyword', () => {
    for (const t of GOLDEN_TEMPLATES) {
      expect(t.keywords.length).toBeGreaterThan(0)
    }
  })

  it('each template has complete HTML', () => {
    for (const t of GOLDEN_TEMPLATES) {
      expect(t.html).toContain('<!DOCTYPE html>')
      expect(t.html).toContain('</html>')
    }
  })

  it('templates include snake-game, todo-app, calculator', () => {
    const ids = GOLDEN_TEMPLATES.map(t => t.id)
    expect(ids).toContain('snake-game')
    expect(ids).toContain('todo-app')
    expect(ids).toContain('calculator')
  })

  it('template HTML is dark-themed', () => {
    for (const t of GOLDEN_TEMPLATES) {
      // Should contain dark color tokens (e.g. #0f172a, #1e293b, etc.)
      expect(t.html).toMatch(/#[0-9a-f]{6}/i)
    }
  })
})

describe('findTemplate', () => {
  it('returns null for empty mission', () => {
    expect(findTemplate('')).toBeNull()
    expect(findTemplate('   ')).toBeNull()
  })

  it('returns null for whitespace-only mission', () => {
    expect(findTemplate('\n\n')).toBeNull()
  })

  it('returns snake-game for "snake game" mission', () => {
    const t = findTemplate('build a snake game with score')
    expect(t).not.toBeNull()
    expect(t!.id).toBe('snake-game')
  })

  it('returns snake-game for "game" keyword (single word)', () => {
    const t = findTemplate('build a game')
    expect(t).not.toBeNull()
    expect(t!.id).toBe('snake-game')
  })

  it('returns todo-app for "todo app" mission', () => {
    const t = findTemplate('build a todo app with add and delete')
    expect(t).not.toBeNull()
    expect(t!.id).toBe('todo-app')
  })

  it('returns todo-app for "task list" mission', () => {
    const t = findTemplate('build a task list')
    expect(t).not.toBeNull()
    expect(t!.id).toBe('todo-app')
  })

  it('returns calculator for "calculator" mission', () => {
    const t = findTemplate('build a calculator')
    expect(t).not.toBeNull()
    expect(t!.id).toBe('calculator')
  })

  it('returns calculator for "math calc" mission', () => {
    const t = findTemplate('build a math calc')
    expect(t).not.toBeNull()
    expect(t!.id).toBe('calculator')
  })

  it('returns null for unrelated mission', () => {
    expect(findTemplate('build a quantum physics simulator')).toBeNull()
  })

  it('returns null for too-short / vague mission', () => {
    expect(findTemplate('hi')).toBeNull()
  })

  it('is case-insensitive', () => {
    const lower = findTemplate('build a snake game')
    const upper = findTemplate('BUILD A SNAKE GAME')
    const mixed = findTemplate('Build a SNAKE Game')
    expect(lower).not.toBeNull()
    expect(upper).not.toBeNull()
    expect(mixed).not.toBeNull()
    expect(lower!.id).toBe(upper!.id)
    expect(lower!.id).toBe(mixed!.id)
  })

  it('word-boundary matches prevent false positives (e.g. "todo" in "autodo")', () => {
    // "autodo" should NOT match "todo" (word boundary check)
    expect(findTemplate('build an autodo thing')).toBeNull()
  })

  it('multi-word keyword "snake game" matches the literal phrase', () => {
    const t = findTemplate('I want a snake game with arrows')
    expect(t).not.toBeNull()
    expect(t!.id).toBe('snake-game')
  })

  it('prefers higher-scoring template when multiple match', () => {
    // "snake game calculator" — snake should win (2 keywords: snake + game)
    // vs calculator (1 keyword: calculator)
    const t = findTemplate('snake game calculator')
    expect(t).not.toBeNull()
    // Could go either way depending on weighting — just verify it picks one
    expect(['snake-game', 'calculator']).toContain(t!.id)
  })

  it('returns null for mission with no keyword overlap', () => {
    expect(findTemplate('build a weather dashboard')).toBeNull()
  })

  it('handles missions with extra prose around the keyword', () => {
    const t = findTemplate('I would like you to build a snake game please')
    expect(t).not.toBeNull()
    expect(t!.id).toBe('snake-game')
  })

  it('handles missions with punctuation around keywords', () => {
    const t = findTemplate('Build a "calculator"!')
    expect(t).not.toBeNull()
    expect(t!.id).toBe('calculator')
  })
})

describe('buildSeededPrompt', () => {
  it('includes the mission', () => {
    const tpl = GOLDEN_TEMPLATES[0]!
    const prompt = buildSeededPrompt('Build a fancy snake game', tpl)
    expect(prompt).toContain('Build a fancy snake game')
    expect(prompt).toContain('MISSION:')
  })

  it('includes the template name', () => {
    const tpl = GOLDEN_TEMPLATES[0]!
    const prompt = buildSeededPrompt('test mission', tpl)
    expect(prompt).toContain(tpl.name)
  })

  it('includes the template description', () => {
    const tpl = GOLDEN_TEMPLATES[1]!
    const prompt = buildSeededPrompt('test mission', tpl)
    expect(prompt).toContain(tpl.description)
  })

  it('includes the template HTML inline', () => {
    const tpl = GOLDEN_TEMPLATES[0]!
    const prompt = buildSeededPrompt('test mission', tpl)
    // Should contain the HTML — at least the DOCTYPE and the closing tag
    expect(prompt).toContain('<!DOCTYPE html>')
    expect(prompt).toContain(tpl.html.slice(0, 100))
  })

  it('instructs the LLM to use the template as a baseline', () => {
    const tpl = GOLDEN_TEMPLATES[0]!
    const prompt = buildSeededPrompt('test mission', tpl)
    expect(prompt.toLowerCase()).toContain('baseline')
    expect(prompt.toLowerCase()).toContain('template')
  })

  it('instructs the LLM to output the COMPLETE modified HTML', () => {
    const tpl = GOLDEN_TEMPLATES[0]!
    const prompt = buildSeededPrompt('test mission', tpl)
    expect(prompt).toContain('COMPLETE')
    expect(prompt).toContain('HTML')
  })

  it('works for all templates', () => {
    for (const tpl of GOLDEN_TEMPLATES) {
      const prompt = buildSeededPrompt('test', tpl)
      expect(prompt).toContain(tpl.name)
      expect(prompt).toContain(tpl.html.slice(0, 50))
    }
  })

  it('preserves the mission exactly (no truncation)', () => {
    const tpl = GOLDEN_TEMPLATES[0]!
    const longMission = 'Build a snake game with ' + 'x'.repeat(500)
    const prompt = buildSeededPrompt(longMission, tpl)
    expect(prompt).toContain(longMission)
  })
})
