// GET /api/settings — Get current API key configuration status.
// POST /api/settings — Update API keys (stored in memory, not persisted to disk).
//
// This allows users to configure LLM API keys through the UI without
// needing to set environment variables or restart the server.
//
// Security: Keys are stored in memory only (globalThis), not written to disk.
// They are never returned in full — only a masked version is shown.

import type { NextRequest } from 'next/server'
import { logger } from '@/lib/logger'
import { RateLimiter } from '@/lib/rate-limit'
import { readFileSync, existsSync } from 'fs'
import { homedir } from 'os'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const settingsLimiter = new RateLimiter(30, 60 * 1000, 5 * 60 * 1000, 1000)

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

function maskKey(key: string): string {
  if (!key || key.length < 8) return key ? '***' : ''
  return key.slice(0, 4) + '...' + key.slice(-4)
}

function getEffectiveKey(envVar: string, settingsKey: string | undefined): string | undefined {
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

function getKeySource(envVar: string, settingsKey: string | undefined): string {
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

export async function GET(): Promise<Response> {
  const settings = globalSettings.__novaSettings!

  // Get effective keys (settings > env)
  const zaiKey = getEffectiveKey('ZAI_API_KEY', settings.zaiApiKey)
  const dashscopeKey = getEffectiveKey('DASHSCOPE_API_KEY', settings.dashscopeApiKey)
  const tokenrouterKey = getEffectiveKey('TOKENROUTER_API_KEY', settings.tokenrouterApiKey)

  return Response.json({
    // Show masked versions for security
    keys: {
      zai: {
        configured: !!zaiKey,
        masked: zaiKey ? maskKey(zaiKey) : '',
        source: getKeySource('ZAI_API_KEY', settings.zaiApiKey),
      },
      dashscope: {
        configured: !!dashscopeKey,
        masked: dashscopeKey ? maskKey(dashscopeKey) : '',
        source: getKeySource('DASHSCOPE_API_KEY', settings.dashscopeApiKey),
      },
      tokenrouter: {
        configured: !!tokenrouterKey,
        masked: tokenrouterKey ? maskKey(tokenrouterKey) : '',
        source: getKeySource('TOKENROUTER_API_KEY', settings.tokenrouterApiKey),
      },
    },
    // Which models are available
    models: {
      'z-ai': !!zaiKey,
      'qwen': !!dashscopeKey,
      'kimi': !!tokenrouterKey,
    },
  })
}

export async function POST(request: NextRequest): Promise<Response> {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || request.headers.get('x-real-ip') || 'unknown'
  const rl = settingsLimiter.check(ip)
  if (!rl.ok) {
    return Response.json({ error: 'Rate limited' }, { status: 429 })
  }

  let body: {
    zaiApiKey?: string
    dashscopeApiKey?: string
    tokenrouterApiKey?: string
  }

  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const settings = globalSettings.__novaSettings!

  // Update only provided keys (don't clear existing ones unless explicitly empty)
  if (typeof body.zaiApiKey === 'string') {
    settings.zaiApiKey = body.zaiApiKey.trim() || undefined
    logger.info('settings.updated', { key: 'zai', source: 'ui' })
  }
  if (typeof body.dashscopeApiKey === 'string') {
    settings.dashscopeApiKey = body.dashscopeApiKey.trim() || undefined
    logger.info('settings.updated', { key: 'dashscope', source: 'ui' })
  }
  if (typeof body.tokenrouterApiKey === 'string') {
    settings.tokenrouterApiKey = body.tokenrouterApiKey.trim() || undefined
    logger.info('settings.updated', { key: 'tokenrouter', source: 'ui' })
  }

  // Return updated status
  const zaiKey = getEffectiveKey('ZAI_API_KEY', settings.zaiApiKey)
  const dashscopeKey = getEffectiveKey('DASHSCOPE_API_KEY', settings.dashscopeApiKey)
  const tokenrouterKey = getEffectiveKey('TOKENROUTER_API_KEY', settings.tokenrouterApiKey)

  return Response.json({
    ok: true,
    keys: {
      zai: {
        configured: !!zaiKey,
        masked: zaiKey ? maskKey(zaiKey) : '',
        source: getKeySource('ZAI_API_KEY', settings.zaiApiKey),
      },
      dashscope: {
        configured: !!dashscopeKey,
        masked: dashscopeKey ? maskKey(dashscopeKey) : '',
        source: getKeySource('DASHSCOPE_API_KEY', settings.dashscopeApiKey),
      },
      tokenrouter: {
        configured: !!tokenrouterKey,
        masked: tokenrouterKey ? maskKey(tokenrouterKey) : '',
        source: getKeySource('TOKENROUTER_API_KEY', settings.tokenrouterApiKey),
      },
    },
    models: {
      'z-ai': !!zaiKey,
      'qwen': !!dashscopeKey,
      'kimi': !!tokenrouterKey,
    },
  })
}

// Export for other modules to access the effective keys
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
