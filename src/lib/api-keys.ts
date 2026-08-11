// API key management — shared between settings route and LLM modules.
// Extracted from settings/route.ts because Next.js 15+ forbids non-route
// exports from route files.

import { readFileSync } from 'fs'
import { homedir } from 'os'

// v29.39: In-memory settings store (persists across requests but not restarts)
const globalSettings = globalThis as unknown as {
  __novaSettings?: {
    zaiApiKey?: string
    dashscopeApiKey?: string
    tokenrouterApiKey?: string
  }
}

if (!globalSettings.__novaSettings) {
  globalSettings.__novaSettings = {}
}

export function getSettings() {
  return globalSettings.__novaSettings!
}

export function setSettings(settings: Partial<typeof globalSettings.__novaSettings>) {
  globalSettings.__novaSettings = { ...globalSettings.__novaSettings, ...settings }
}

export function maskKey(key: string): string {
  if (!key || key.length < 8) return key ? '***' : ''
  return key.slice(0, 4) + '...' + key.slice(-4)
}

export function getEffectiveKey(envVar: string, settingsKey: string | undefined): string | undefined {
  // Settings (from UI) take precedence over env vars
  if (settingsKey && settingsKey.trim()) return settingsKey.trim()
  // Fall back to env var
  const envValue = process.env[envVar]
  if (envValue && envValue.trim()) return envValue.trim()
  // v29.48: Z.AI SDK loads from /etc/.z-ai-config automatically.
  // If no env var but SDK config exists, report it as configured.
  if (envVar === 'ZAI_API_KEY') {
    try {
      const configPaths = ['/etc/.z-ai-config', homedir() + '/.z-ai-config', process.cwd() + '/.z-ai-config']
      for (const p of configPaths) {
        try {
          const cfg = JSON.parse(readFileSync(p, 'utf-8'))
          if (cfg.apiKey) return cfg.apiKey
        } catch {}
      }
    } catch {}
  }
  return undefined
}

export function getKeySource(envVar: string, settingsKey: string | undefined): string {
  if (settingsKey && settingsKey.trim()) return 'settings'
  const envValue = process.env[envVar]
  if (envValue && envValue.trim()) return 'env'
  // v29.48: Check SDK config file
  if (envVar === 'ZAI_API_KEY') {
    try {
      const configPaths = ['/etc/.z-ai-config', homedir() + '/.z-ai-config', process.cwd() + '/.z-ai-config']
      for (const p of configPaths) {
        try {
          const cfg = JSON.parse(readFileSync(p, 'utf-8'))
          if (cfg.apiKey) return 'sdk-config'
        } catch {}
      }
    } catch {}
  }
  return 'none'
}

export function getEffectiveApiKey(provider: 'zai' | 'dashscope' | 'tokenrouter'): string | undefined {
  const settings = globalSettings.__novaSettings!
  switch (provider) {
    case 'zai':
      return getEffectiveKey('ZAI_API_KEY', settings.zaiApiKey)
    case 'dashscope':
      return getEffectiveKey('DASHSCOPE_API_KEY', settings.dashscopeApiKey)
    case 'tokenrouter':
      return getEffectiveKey('TOKENROUTER_API_KEY', settings.tokenrouterApiKey)
  }
}
