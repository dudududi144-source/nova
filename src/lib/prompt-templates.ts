// v21: Prompt templates — save/load custom prompts with names for reuse.
// Stored in localStorage. Users can save their best prompts and quickly reload them.

export interface PromptTemplate {
  id: string
  name: string
  prompt: string
  createdAt: number
  lastUsedAt: number | null
}

const STORAGE_KEY = 'nova_prompt_templates'

export function loadTemplates(): PromptTemplate[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (!stored) return []
    const parsed = JSON.parse(stored)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((t: unknown): t is PromptTemplate => {
        if (typeof t !== 'object' || t === null) return false
        const item = t as Record<string, unknown>
        return typeof item.id === 'string' &&
               typeof item.name === 'string' &&
               typeof item.prompt === 'string'
      })
      .slice(0, 50) // cap at 50 templates
  } catch {
    return []
  }
}

export function saveTemplates(templates: PromptTemplate[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(templates.slice(0, 50)))
  } catch {
    // localStorage full or unavailable
  }
}

export function addTemplate(name: string, prompt: string): PromptTemplate {
  const templates = loadTemplates()
  const template: PromptTemplate = {
    id: `tpl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    name: name.trim().slice(0, 60),
    prompt: prompt.trim(),
    createdAt: Date.now(),
    lastUsedAt: null,
  }
  // Dedupe by name — replace existing with same name
  const filtered = templates.filter(t => t.name !== template.name)
  const updated = [template, ...filtered].slice(0, 50)
  saveTemplates(updated)
  return template
}

export function deleteTemplate(id: string): void {
  const templates = loadTemplates().filter(t => t.id !== id)
  saveTemplates(templates)
}

export function markTemplateUsed(id: string): void {
  const templates = loadTemplates().map(t =>
    t.id === id ? { ...t, lastUsedAt: Date.now() } : t
  )
  saveTemplates(templates)
}

export function getTemplateById(id: string): PromptTemplate | null {
  return loadTemplates().find(t => t.id === id) ?? null
}
