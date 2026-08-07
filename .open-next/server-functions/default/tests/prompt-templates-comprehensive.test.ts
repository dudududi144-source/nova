// Comprehensive tests for src/lib/prompt-templates.ts
// Tests loadTemplates, saveTemplates, addTemplate, deleteTemplate,
// markTemplateUsed, getTemplateById with edge cases and structure invariants.
import { describe, expect, test, beforeEach } from 'bun:test'
import {
  loadTemplates,
  saveTemplates,
  addTemplate,
  deleteTemplate,
  markTemplateUsed,
  getTemplateById,
  type PromptTemplate,
} from '../src/lib/prompt-templates'

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

function mkTemplate(overrides: Partial<PromptTemplate> = {}): PromptTemplate {
  return {
    id: `id_${Math.random().toString(36).slice(2, 10)}`,
    name: 'Test Template',
    prompt: 'test prompt',
    createdAt: Date.now(),
    lastUsedAt: null,
    ...overrides,
  }
}

describe('prompt-templates — localStorage isolation', () => {
  beforeEach(() => {
    Object.keys(mockStore).forEach(k => delete mockStore[k])
  })

  test('mockStore starts empty after beforeEach', () => {
    expect(Object.keys(mockStore)).toHaveLength(0)
  })
})

describe('loadTemplates', () => {
  beforeEach(() => {
    Object.keys(mockStore).forEach(k => delete mockStore[k])
  })

  test('returns empty array when nothing stored', () => {
    expect(loadTemplates()).toEqual([])
  })
  test('returns empty array when stored value is null', () => {
    expect(loadTemplates()).toEqual([])
  })
  test('loads a single valid template', () => {
    const t = mkTemplate({ name: 'Single' })
    mockStore['nova_prompt_templates'] = JSON.stringify([t])
    const loaded = loadTemplates()
    expect(loaded).toHaveLength(1)
    expect(loaded[0].name).toBe('Single')
  })
  test('loads multiple valid templates', () => {
    const templates = [
      mkTemplate({ id: '1', name: 'First' }),
      mkTemplate({ id: '2', name: 'Second' }),
      mkTemplate({ id: '3', name: 'Third' }),
    ]
    mockStore['nova_prompt_templates'] = JSON.stringify(templates)
    const loaded = loadTemplates()
    expect(loaded).toHaveLength(3)
  })
  test('handles corrupted JSON gracefully', () => {
    mockStore['nova_prompt_templates'] = 'not json'
    expect(loadTemplates()).toEqual([])
  })
  test('returns empty when stored value is not an array', () => {
    mockStore['nova_prompt_templates'] = JSON.stringify({ not: 'an array' })
    expect(loadTemplates()).toEqual([])
  })
  test('returns empty when stored value is a number', () => {
    mockStore['nova_prompt_templates'] = JSON.stringify(42)
    expect(loadTemplates()).toEqual([])
  })
  test('returns empty when stored value is a string', () => {
    mockStore['nova_prompt_templates'] = JSON.stringify('hello')
    expect(loadTemplates()).toEqual([])
  })
  test('filters out null entries', () => {
    mockStore['nova_prompt_templates'] = JSON.stringify([
      mkTemplate({ id: '1', name: 'Valid' }),
      null,
    ])
    expect(loadTemplates()).toHaveLength(1)
  })
  test('filters out string entries', () => {
    mockStore['nova_prompt_templates'] = JSON.stringify([
      mkTemplate({ id: '1', name: 'Valid' }),
      'not an object',
    ])
    expect(loadTemplates()).toHaveLength(1)
  })
  test('filters out entries with non-string id', () => {
    mockStore['nova_prompt_templates'] = JSON.stringify([
      mkTemplate({ id: '1', name: 'Valid' }),
      { id: 123, name: 'Invalid', prompt: 'test' },
    ])
    expect(loadTemplates()).toHaveLength(1)
    expect(loadTemplates()[0].id).toBe('1')
  })
  test('filters out entries with non-string name', () => {
    mockStore['nova_prompt_templates'] = JSON.stringify([
      mkTemplate({ id: '1', name: 'Valid' }),
      { id: '2', name: 42, prompt: 'test' },
    ])
    expect(loadTemplates()).toHaveLength(1)
  })
  test('filters out entries with non-string prompt', () => {
    mockStore['nova_prompt_templates'] = JSON.stringify([
      mkTemplate({ id: '1', name: 'Valid' }),
      { id: '2', name: 'Invalid', prompt: 42 },
    ])
    expect(loadTemplates()).toHaveLength(1)
  })
  test('filters out entries missing prompt field', () => {
    mockStore['nova_prompt_templates'] = JSON.stringify([
      mkTemplate({ id: '1', name: 'Valid' }),
      { id: '2', name: 'Invalid' }, // missing prompt
    ])
    expect(loadTemplates()).toHaveLength(1)
  })
  test('preserves all fields on valid templates', () => {
    const t = mkTemplate({ id: '1', name: 'Test', prompt: 'do thing', createdAt: 12345, lastUsedAt: 67890 })
    mockStore['nova_prompt_templates'] = JSON.stringify([t])
    const loaded = loadTemplates()
    expect(loaded[0]).toEqual(t)
  })
  test('caps at 50 templates', () => {
    const templates: PromptTemplate[] = []
    for (let i = 0; i < 100; i++) {
      templates.push(mkTemplate({ id: `id_${i}`, name: `Template ${i}` }))
    }
    mockStore['nova_prompt_templates'] = JSON.stringify(templates)
    expect(loadTemplates()).toHaveLength(50)
  })
})

describe('saveTemplates', () => {
  beforeEach(() => {
    Object.keys(mockStore).forEach(k => delete mockStore[k])
  })

  test('writes JSON array to localStorage', () => {
    const t = mkTemplate({ id: '1', name: 'Test' })
    saveTemplates([t])
    expect(mockStore['nova_prompt_templates']).toBeDefined()
    const parsed = JSON.parse(mockStore['nova_prompt_templates']!)
    expect(parsed).toHaveLength(1)
    expect(parsed[0].id).toBe('1')
  })
  test('writes empty array for empty input', () => {
    saveTemplates([])
    expect(JSON.parse(mockStore['nova_prompt_templates']!)).toEqual([])
  })
  test('caps at 50 templates when saving more', () => {
    const templates: PromptTemplate[] = []
    for (let i = 0; i < 60; i++) {
      templates.push(mkTemplate({ id: `id_${i}`, name: `T${i}` }))
    }
    saveTemplates(templates)
    expect(loadTemplates()).toHaveLength(50)
  })
  test('preserves order on round-trip', () => {
    const templates = [
      mkTemplate({ id: '1', name: 'First' }),
      mkTemplate({ id: '2', name: 'Second' }),
      mkTemplate({ id: '3', name: 'Third' }),
    ]
    saveTemplates(templates)
    const loaded = loadTemplates()
    expect(loaded.map(t => t.id)).toEqual(['1', '2', '3'])
  })
  test('silently ignores errors (does not throw)', () => {
    const orig = (globalThis as unknown as { localStorage: Storage }).localStorage.setItem
    ;(globalThis as unknown as { localStorage: Storage }).localStorage.setItem = () => {
      throw new Error('quota exceeded')
    }
    expect(() => saveTemplates([mkTemplate()])).not.toThrow()
    ;(globalThis as unknown as { localStorage: Storage }).localStorage.setItem = orig
  })
})

describe('addTemplate', () => {
  beforeEach(() => {
    Object.keys(mockStore).forEach(k => delete mockStore[k])
  })

  test('creates a template with id starting with "tpl_"', () => {
    const t = addTemplate('Test', 'prompt')
    expect(t.id.startsWith('tpl_')).toBe(true)
  })
  test('id contains a timestamp component (base36)', () => {
    const before = Date.now()
    const t = addTemplate('Test', 'prompt')
    const after = Date.now()
    // Extract the timestamp portion: tpl_<base36>_<random>
    const parts = t.id.split('_')
    expect(parts).toHaveLength(3)
    const ts = parseInt(parts[1], 36)
    expect(ts).toBeGreaterThanOrEqual(before)
    expect(ts).toBeLessThanOrEqual(after)
  })
  test('id contains a 4-char random suffix', () => {
    const t = addTemplate('Test', 'prompt')
    const parts = t.id.split('_')
    expect(parts[2].length).toBe(4)
  })
  test('trims name', () => {
    const t = addTemplate('  spaced  ', 'prompt')
    expect(t.name).toBe('spaced')
  })
  test('caps name at 60 chars', () => {
    const longName = 'a'.repeat(100)
    const t = addTemplate(longName, 'prompt')
    expect(t.name).toHaveLength(60)
  })
  test('trims prompt', () => {
    const t = addTemplate('Test', '  spaced prompt  ')
    expect(t.prompt).toBe('spaced prompt')
  })
  test('does NOT cap prompt length', () => {
    const longPrompt = 'a'.repeat(10000)
    const t = addTemplate('Test', longPrompt)
    expect(t.prompt).toHaveLength(10000)
  })
  test('sets createdAt to current time', () => {
    const before = Date.now()
    const t = addTemplate('Test', 'prompt')
    const after = Date.now()
    expect(t.createdAt).toBeGreaterThanOrEqual(before)
    expect(t.createdAt).toBeLessThanOrEqual(after)
  })
  test('initializes lastUsedAt to null', () => {
    const t = addTemplate('Test', 'prompt')
    expect(t.lastUsedAt).toBeNull()
  })
  test('persists to localStorage', () => {
    addTemplate('Test', 'prompt')
    expect(loadTemplates()).toHaveLength(1)
  })
  test('new template is prepended (first in list)', () => {
    addTemplate('First', 'prompt 1')
    addTemplate('Second', 'prompt 2')
    const loaded = loadTemplates()
    expect(loaded[0].name).toBe('Second')
    expect(loaded[1].name).toBe('First')
  })
  test('dedupes by name — replaces existing with same name', () => {
    addTemplate('Same Name', 'prompt v1')
    addTemplate('Same Name', 'prompt v2')
    const loaded = loadTemplates()
    expect(loaded).toHaveLength(1)
    expect(loaded[0].prompt).toBe('prompt v2')
  })
  test('dedupe preserves other templates', () => {
    addTemplate('One', 'prompt 1')
    addTemplate('Two', 'prompt 2')
    addTemplate('One', 'prompt 1 updated')
    const loaded = loadTemplates()
    expect(loaded).toHaveLength(2)
    expect(loaded.find(t => t.name === 'One')!.prompt).toBe('prompt 1 updated')
    expect(loaded.find(t => t.name === 'Two')!.prompt).toBe('prompt 2')
  })
  test('dedupe is case-sensitive (Name != name)', () => {
    addTemplate('Name', 'prompt 1')
    addTemplate('name', 'prompt 2')
    expect(loadTemplates()).toHaveLength(2)
  })
  test('handles empty name (trims to empty string)', () => {
    const t = addTemplate('   ', 'prompt')
    expect(t.name).toBe('')
  })
  test('handles empty prompt', () => {
    const t = addTemplate('Test', '   ')
    expect(t.prompt).toBe('')
  })
})

describe('deleteTemplate', () => {
  beforeEach(() => {
    Object.keys(mockStore).forEach(k => delete mockStore[k])
  })

  test('removes template by id', () => {
    const t1 = addTemplate('First', 'p1')
    const t2 = addTemplate('Second', 'p2')
    deleteTemplate(t1.id)
    const loaded = loadTemplates()
    expect(loaded).toHaveLength(1)
    expect(loaded[0].id).toBe(t2.id)
  })
  test('removes the correct template when multiple exist', () => {
    const t1 = addTemplate('First', 'p1')
    const t2 = addTemplate('Second', 'p2')
    const t3 = addTemplate('Third', 'p3')
    deleteTemplate(t2.id)
    const loaded = loadTemplates()
    expect(loaded.map(t => t.id)).toEqual([t3.id, t1.id])
  })
  test('does nothing for non-existent id', () => {
    addTemplate('Test', 'p1')
    deleteTemplate('nonexistent-id')
    expect(loadTemplates()).toHaveLength(1)
  })
  test('does nothing on empty template list', () => {
    expect(() => deleteTemplate('any-id')).not.toThrow()
  })
  test('persists the deletion to localStorage', () => {
    const t = addTemplate('Test', 'p1')
    deleteTemplate(t.id)
    // Reading from localStorage should give empty array
    expect(loadTemplates()).toEqual([])
  })
})

describe('markTemplateUsed', () => {
  beforeEach(() => {
    Object.keys(mockStore).forEach(k => delete mockStore[k])
  })

  test('updates lastUsedAt to current time', () => {
    const t = addTemplate('Test', 'p1')
    const before = Date.now()
    markTemplateUsed(t.id)
    const after = Date.now()
    const updated = getTemplateById(t.id)
    expect(updated!.lastUsedAt).not.toBeNull()
    expect(updated!.lastUsedAt).toBeGreaterThanOrEqual(before)
    expect(updated!.lastUsedAt).toBeLessThanOrEqual(after)
  })
  test('does not change other fields', () => {
    const t = addTemplate('Test', 'p1')
    markTemplateUsed(t.id)
    const updated = getTemplateById(t.id)
    expect(updated!.name).toBe(t.name)
    expect(updated!.prompt).toBe(t.prompt)
    expect(updated!.id).toBe(t.id)
    expect(updated!.createdAt).toBe(t.createdAt)
  })
  test('does not affect other templates', () => {
    const t1 = addTemplate('First', 'p1')
    const t2 = addTemplate('Second', 'p2')
    markTemplateUsed(t1.id)
    const untouched = getTemplateById(t2.id)
    expect(untouched!.lastUsedAt).toBeNull()
  })
  test('does nothing for non-existent id', () => {
    expect(() => markTemplateUsed('nonexistent')).not.toThrow()
  })
  test('can be called multiple times (updates each time, no errors)', () => {
    const t = addTemplate('Test', 'p1')
    markTemplateUsed(t.id)
    const first = getTemplateById(t.id)!.lastUsedAt
    expect(first).not.toBeNull()
    markTemplateUsed(t.id)
    const second = getTemplateById(t.id)!.lastUsedAt
    expect(second).not.toBeNull()
    expect(second).toBeGreaterThanOrEqual(first!)
  })
})

describe('getTemplateById', () => {
  beforeEach(() => {
    Object.keys(mockStore).forEach(k => delete mockStore[k])
  })

  test('returns the matching template', () => {
    const t = addTemplate('Test', 'p1')
    const found = getTemplateById(t.id)
    expect(found).not.toBeNull()
    expect(found!.id).toBe(t.id)
    expect(found!.name).toBe('Test')
  })
  test('returns null for non-existent id', () => {
    expect(getTemplateById('does-not-exist')).toBeNull()
  })
  test('returns null when no templates stored', () => {
    expect(getTemplateById('any-id')).toBeNull()
  })
  test('returns the correct template when multiple exist', () => {
    const t1 = addTemplate('First', 'p1')
    const t2 = addTemplate('Second', 'p2')
    const t3 = addTemplate('Third', 'p3')
    expect(getTemplateById(t2.id)!.name).toBe('Second')
    expect(getTemplateById(t3.id)!.name).toBe('Third')
    expect(getTemplateById(t1.id)!.name).toBe('First')
  })
})

describe('PromptTemplate — type invariants', () => {
  test('all loaded templates have string id, name, prompt, number createdAt', () => {
    const templates = [
      mkTemplate({ id: '1', name: 'A', prompt: 'a', createdAt: 1 }),
      mkTemplate({ id: '2', name: 'B', prompt: 'b', createdAt: 2, lastUsedAt: 99 }),
    ]
    saveTemplates(templates)
    const loaded = loadTemplates()
    for (const t of loaded) {
      expect(typeof t.id).toBe('string')
      expect(typeof t.name).toBe('string')
      expect(typeof t.prompt).toBe('string')
      expect(typeof t.createdAt).toBe('number')
      expect(t.lastUsedAt === null || typeof t.lastUsedAt === 'number').toBe(true)
    }
  })
})
