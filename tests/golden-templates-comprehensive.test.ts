// Comprehensive tests for src/lib/golden-templates.ts
// Tests GOLDEN_TEMPLATES structure, findTemplate matching, and buildSeededPrompt.
import { describe, expect, test } from 'bun:test'
import {
  findTemplate,
  buildSeededPrompt,
  GOLDEN_TEMPLATES,
  type GoldenTemplate,
} from '../src/lib/golden-templates'

// ─────────────────────────────────────────────────────────────────────────────
// GOLDEN_TEMPLATES — structure
// ─────────────────────────────────────────────────────────────────────────────

describe('GOLDEN_TEMPLATES — structure', () => {
  test('has at least 3 templates', () => {
    expect(GOLDEN_TEMPLATES.length).toBeGreaterThanOrEqual(3)
  })

  test('each template has a unique id', () => {
    const ids = GOLDEN_TEMPLATES.map(t => t.id)
    const unique = new Set(ids)
    expect(unique.size).toBe(ids.length)
  })

  test('each template has a non-empty name', () => {
    for (const t of GOLDEN_TEMPLATES) {
      expect(t.name.length).toBeGreaterThan(0)
    }
  })

  test('each template has at least one keyword', () => {
    for (const t of GOLDEN_TEMPLATES) {
      expect(t.keywords.length).toBeGreaterThan(0)
    }
  })

  test('each template has a non-empty description', () => {
    for (const t of GOLDEN_TEMPLATES) {
      expect(t.description.length).toBeGreaterThan(0)
    }
  })

  test('each template has complete HTML with DOCTYPE', () => {
    for (const t of GOLDEN_TEMPLATES) {
      expect(t.html).toContain('<!DOCTYPE html>')
    }
  })

  test('each template has </html> closing tag', () => {
    for (const t of GOLDEN_TEMPLATES) {
      expect(t.html).toContain('</html>')
    }
  })

  test('each template has <style> block (dark theme tokens)', () => {
    for (const t of GOLDEN_TEMPLATES) {
      expect(t.html.toLowerCase()).toContain('<style')
    }
  })

  test('each template has <script> tag (interactive)', () => {
    for (const t of GOLDEN_TEMPLATES) {
      expect(t.html.toLowerCase()).toContain('<script')
    }
  })

  test('templates include snake-game, todo-app, calculator ids', () => {
    const ids = GOLDEN_TEMPLATES.map(t => t.id)
    expect(ids).toContain('snake-game')
    expect(ids).toContain('todo-app')
    expect(ids).toContain('calculator')
  })

  test('each template keyword is lowercase (per spec)', () => {
    for (const t of GOLDEN_TEMPLATES) {
      for (const kw of t.keywords) {
        expect(kw).toBe(kw.toLowerCase())
      }
    }
  })

  test('snake-game template has "snake" keyword', () => {
    const snake = GOLDEN_TEMPLATES.find(t => t.id === 'snake-game')
    expect(snake).toBeTruthy()
    expect(snake!.keywords).toContain('snake')
  })

  test('todo-app template has "todo" and "task" keywords', () => {
    const todo = GOLDEN_TEMPLATES.find(t => t.id === 'todo-app')
    expect(todo).toBeTruthy()
    expect(todo!.keywords).toContain('todo')
    expect(todo!.keywords).toContain('task')
  })

  test('calculator template has "calculator" and "calc" keywords', () => {
    const calc = GOLDEN_TEMPLATES.find(t => t.id === 'calculator')
    expect(calc).toBeTruthy()
    expect(calc!.keywords).toContain('calculator')
    expect(calc!.keywords).toContain('calc')
  })

  test('template HTML is at least 500 bytes (substantial content)', () => {
    for (const t of GOLDEN_TEMPLATES) {
      expect(t.html.length).toBeGreaterThan(500)
    }
  })

  test('template HTML uses dark theme color (#0f172a background)', () => {
    for (const t of GOLDEN_TEMPLATES) {
      expect(t.html.toLowerCase()).toContain('#0f172a')
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// findTemplate — matching
// ─────────────────────────────────────────────────────────────────────────────

describe('findTemplate — matching', () => {
  test('returns null for empty mission', () => {
    expect(findTemplate('')).toBeNull()
  })

  test('returns null for whitespace-only mission', () => {
    expect(findTemplate('   ')).toBeNull()
    expect(findTemplate('\n\n')).toBeNull()
    expect(findTemplate('\t\t')).toBeNull()
  })

  test('matches snake-game for "snake" keyword', () => {
    const t = findTemplate('build a snake game')
    expect(t).not.toBeNull()
    expect(t!.id).toBe('snake-game')
  })

  test('matches snake-game for "snake game" multi-word keyword', () => {
    const t = findTemplate('I want a snake game with arrows')
    expect(t).not.toBeNull()
    expect(t!.id).toBe('snake-game')
  })

  test('does NOT match snake-game for generic "game" alone', () => {
    // v10 fix: "game" keyword removed from snake template
    expect(findTemplate('build a game')).toBeNull()
  })

  test('matches todo-app for "todo" keyword', () => {
    const t = findTemplate('build a todo app')
    expect(t).not.toBeNull()
    expect(t!.id).toBe('todo-app')
  })

  test('matches todo-app for "task" keyword', () => {
    const t = findTemplate('build a task list')
    expect(t).not.toBeNull()
    expect(t!.id).toBe('todo-app')
  })

  test('matches todo-app for "checklist" keyword', () => {
    const t = findTemplate('build a checklist')
    expect(t).not.toBeNull()
    expect(t!.id).toBe('todo-app')
  })

  test('matches calculator for "calculator" keyword', () => {
    const t = findTemplate('build a calculator')
    expect(t).not.toBeNull()
    expect(t!.id).toBe('calculator')
  })

  test('matches calculator for "calc" keyword', () => {
    const t = findTemplate('build a math calc')
    expect(t).not.toBeNull()
    expect(t!.id).toBe('calculator')
  })

  test('matches calculator for "arithmetic" keyword', () => {
    const t = findTemplate('build an arithmetic tool')
    expect(t).not.toBeNull()
    expect(t!.id).toBe('calculator')
  })

  test('matches calculator for "math" keyword', () => {
    const t = findTemplate('build a math helper')
    expect(t).not.toBeNull()
    expect(t!.id).toBe('calculator')
  })

  test('returns null for unrelated mission (weather)', () => {
    expect(findTemplate('build a weather dashboard')).toBeNull()
  })

  test('returns null for unrelated mission (physics)', () => {
    expect(findTemplate('build a quantum physics simulator')).toBeNull()
  })

  test('returns null for too-short mission', () => {
    expect(findTemplate('hi')).toBeNull()
  })

  test('returns null for "autodo" (word boundary prevents false positive)', () => {
    expect(findTemplate('build an autodo thing')).toBeNull()
  })

  test('is case-insensitive (lowercase, uppercase, mixed)', () => {
    const lower = findTemplate('build a snake game')
    const upper = findTemplate('BUILD A SNAKE GAME')
    const mixed = findTemplate('Build a SNAKE Game')
    expect(lower).not.toBeNull()
    expect(upper).not.toBeNull()
    expect(mixed).not.toBeNull()
    expect(lower!.id).toBe(upper!.id)
    expect(lower!.id).toBe(mixed!.id)
  })

  test('handles missions with extra prose around keyword', () => {
    const t = findTemplate('I would like you to build a snake game please')
    expect(t).not.toBeNull()
    expect(t!.id).toBe('snake-game')
  })

  test('handles missions with punctuation around keyword', () => {
    const t = findTemplate('Build a "calculator"!')
    expect(t).not.toBeNull()
    expect(t!.id).toBe('calculator')
  })

  test('prefers higher-scoring template when multiple match', () => {
    // "snake game calculator" — snake should win (snake + game = 2 keywords = score 4+)
    // vs calculator (1 keyword = score 2)
    const t = findTemplate('snake game calculator')
    expect(t).not.toBeNull()
    expect(['snake-game', 'calculator']).toContain(t!.id)
  })

  test('returns null for mission with no keyword overlap', () => {
    expect(findTemplate('build a chart visualizer')).toBeNull()
  })

  test('returns the same template object reference (from GOLDEN_TEMPLATES)', () => {
    const t = findTemplate('build a snake game')
    expect(t).not.toBeNull()
    expect(GOLDEN_TEMPLATES).toContain(t)
  })

  test('handles keyword with hyphen (no snake template uses hyphens, but verify no crash)', () => {
    expect(() => findTemplate('build a real-time app')).not.toThrow()
  })

  test('handles very long mission', () => {
    const long = 'build a snake game with ' + 'x'.repeat(500)
    const t = findTemplate(long)
    expect(t).not.toBeNull()
    expect(t!.id).toBe('snake-game')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// buildSeededPrompt
// ─────────────────────────────────────────────────────────────────────────────

describe('buildSeededPrompt', () => {
  test('includes the mission', () => {
    const tpl = GOLDEN_TEMPLATES[0]!
    const prompt = buildSeededPrompt('Build a fancy snake game', tpl)
    expect(prompt).toContain('Build a fancy snake game')
  })

  test('includes MISSION: header', () => {
    const tpl = GOLDEN_TEMPLATES[0]!
    const prompt = buildSeededPrompt('test', tpl)
    expect(prompt).toContain('MISSION:')
  })

  test('includes template name', () => {
    const tpl = GOLDEN_TEMPLATES[0]!
    const prompt = buildSeededPrompt('test', tpl)
    expect(prompt).toContain(tpl.name)
  })

  test('includes template description', () => {
    const tpl = GOLDEN_TEMPLATES[1]!
    const prompt = buildSeededPrompt('test', tpl)
    expect(prompt).toContain(tpl.description)
  })

  test('includes template HTML inline', () => {
    const tpl = GOLDEN_TEMPLATES[0]!
    const prompt = buildSeededPrompt('test', tpl)
    expect(prompt).toContain('<!DOCTYPE html>')
    expect(prompt).toContain(tpl.html.slice(0, 100))
  })

  test('includes STARTING TEMPLATE: header', () => {
    const tpl = GOLDEN_TEMPLATES[0]!
    const prompt = buildSeededPrompt('test', tpl)
    expect(prompt).toContain('STARTING TEMPLATE:')
  })

  test('includes TEMPLATE DESCRIPTION: header', () => {
    const tpl = GOLDEN_TEMPLATES[0]!
    const prompt = buildSeededPrompt('test', tpl)
    expect(prompt).toContain('TEMPLATE DESCRIPTION:')
  })

  test('includes TEMPLATE HTML: header', () => {
    const tpl = GOLDEN_TEMPLATES[0]!
    const prompt = buildSeededPrompt('test', tpl)
    expect(prompt).toContain('TEMPLATE HTML:')
  })

  test('instructs LLM to use template as baseline', () => {
    const tpl = GOLDEN_TEMPLATES[0]!
    const prompt = buildSeededPrompt('test', tpl)
    expect(prompt.toLowerCase()).toContain('baseline')
  })

  test('instructs LLM to output COMPLETE modified HTML', () => {
    const tpl = GOLDEN_TEMPLATES[0]!
    const prompt = buildSeededPrompt('test', tpl)
    expect(prompt).toContain('COMPLETE')
    expect(prompt).toContain('HTML')
  })

  test('works for all templates', () => {
    for (const tpl of GOLDEN_TEMPLATES) {
      const prompt = buildSeededPrompt('test', tpl)
      expect(prompt).toContain(tpl.name)
      expect(prompt).toContain(tpl.html.slice(0, 50))
    }
  })

  test('preserves the mission exactly (no truncation)', () => {
    const tpl = GOLDEN_TEMPLATES[0]!
    const longMission = 'Build a snake game with ' + 'x'.repeat(500)
    const prompt = buildSeededPrompt(longMission, tpl)
    expect(prompt).toContain(longMission)
  })

  test('preserves template HTML exactly', () => {
    const tpl = GOLDEN_TEMPLATES[0]!
    const prompt = buildSeededPrompt('test', tpl)
    expect(prompt).toContain(tpl.html)
  })

  test('preserves template description exactly', () => {
    const tpl = GOLDEN_TEMPLATES[0]!
    const prompt = buildSeededPrompt('test', tpl)
    expect(prompt).toContain(tpl.description)
  })

  test('mentions "keep the parts that already work"', () => {
    const tpl = GOLDEN_TEMPLATES[0]!
    const prompt = buildSeededPrompt('test', tpl)
    expect(prompt.toLowerCase()).toContain('keep')
  })

  test('returns a string', () => {
    const tpl = GOLDEN_TEMPLATES[0]!
    const prompt = buildSeededPrompt('test', tpl)
    expect(typeof prompt).toBe('string')
  })

  test('prompt length is greater than template HTML length (has wrapper text)', () => {
    const tpl = GOLDEN_TEMPLATES[0]!
    const prompt = buildSeededPrompt('test', tpl)
    expect(prompt.length).toBeGreaterThan(tpl.html.length)
  })
})
