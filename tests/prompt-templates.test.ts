// Tests for prompt templates
import { describe, it, expect, beforeEach } from 'bun:test'
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

describe('prompt-templates', () => {
  beforeEach(() => {
    Object.keys(mockStore).forEach(k => delete mockStore[k])
  })

  describe('loadTemplates', () => {
    it('returns empty array when nothing stored', () => {
      expect(loadTemplates()).toEqual([])
    })

    it('loads stored templates', () => {
      const templates = [
        { id: '1', name: 'Todo', prompt: 'Build a todo app', createdAt: 1000, lastUsedAt: null },
      ]
      mockStore['nova_prompt_templates'] = JSON.stringify(templates)
      const loaded = loadTemplates()
      expect(loaded).toHaveLength(1)
      expect(loaded[0].name).toBe('Todo')
    })

    it('handles corrupted data', () => {
      mockStore['nova_prompt_templates'] = 'not json'
      expect(loadTemplates()).toEqual([])
    })

    it('filters out invalid entries', () => {
      mockStore['nova_prompt_templates'] = JSON.stringify([
        { id: '1', name: 'Valid', prompt: 'test', createdAt: 0, lastUsedAt: null },
        { id: 123, name: 'Invalid', prompt: 'test' }, // wrong id type
        'not an object',
        null,
      ])
      expect(loadTemplates()).toHaveLength(1)
    })
  })

  describe('addTemplate', () => {
    it('creates a new template', () => {
      const t = addTemplate('My Template', 'Build a calculator')
      expect(t.id).toBeTruthy()
      expect(t.name).toBe('My Template')
      expect(t.prompt).toBe('Build a calculator')
      expect(t.createdAt).toBeGreaterThan(0)
      expect(t.lastUsedAt).toBeNull()
    })

    it('persists to localStorage', () => {
      addTemplate('Test', 'Build something')
      expect(loadTemplates()).toHaveLength(1)
    })

    it('dedupes by name — replaces existing', () => {
      addTemplate('Todo', 'Build a todo app v1')
      addTemplate('Todo', 'Build a todo app v2')
      const templates = loadTemplates()
      expect(templates).toHaveLength(1)
      expect(templates[0].prompt).toBe('Build a todo app v2')
    })

    it('trims name and caps at 60 chars', () => {
      const longName = '  ' + 'a'.repeat(100) + '  '
      const t = addTemplate(longName, 'test')
      expect(t.name).toHaveLength(60)
      expect(t.name.startsWith('a')).toBe(true)
    })

    it('trims prompt', () => {
      const t = addTemplate('Test', '  Build something  ')
      expect(t.prompt).toBe('Build something')
    })
  })

  describe('deleteTemplate', () => {
    it('removes template by id', () => {
      const t1 = addTemplate('Template 1', 'prompt 1')
      const t2 = addTemplate('Template 2', 'prompt 2')
      deleteTemplate(t1.id)
      const templates = loadTemplates()
      expect(templates).toHaveLength(1)
      expect(templates[0].id).toBe(t2.id)
    })

    it('does nothing for non-existent id', () => {
      addTemplate('Test', 'prompt')
      deleteTemplate('nonexistent')
      expect(loadTemplates()).toHaveLength(1)
    })
  })

  describe('markTemplateUsed', () => {
    it('updates lastUsedAt timestamp', () => {
      const t = addTemplate('Test', 'prompt')
      expect(t.lastUsedAt).toBeNull()
      markTemplateUsed(t.id)
      const updated = getTemplateById(t.id)
      expect(updated).not.toBeNull()
      expect(updated!.lastUsedAt).not.toBeNull()
      expect(updated!.lastUsedAt).toBeGreaterThan(0)
    })

    it('does nothing for non-existent id', () => {
      markTemplateUsed('nonexistent')
      // Should not throw
    })
  })

  describe('getTemplateById', () => {
    it('returns template by id', () => {
      const t = addTemplate('Test', 'prompt')
      const found = getTemplateById(t.id)
      expect(found).not.toBeNull()
      expect(found!.name).toBe('Test')
    })

    it('returns null for non-existent id', () => {
      expect(getTemplateById('nonexistent')).toBeNull()
    })
  })

  describe('saveTemplates', () => {
    it('caps at 50 templates', () => {
      const templates: PromptTemplate[] = []
      for (let i = 0; i < 60; i++) {
        templates.push({
          id: `id_${i}`,
          name: `Template ${i}`,
          prompt: `prompt ${i}`,
          createdAt: i,
          lastUsedAt: null,
        })
      }
      saveTemplates(templates)
      expect(loadTemplates()).toHaveLength(50)
    })
  })
})
