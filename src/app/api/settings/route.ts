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
import {
  getSettings,
  setSettings,
  maskKey,
  getEffectiveKey,
  getKeySource,
} from '@/lib/api-keys'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

const settingsLimiter = new RateLimiter(30, 60 * 1000, 5 * 60 * 1000, 1000)

export async function GET(): Promise<Response> {
  const settings = getSettings()

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

  const updates: { zaiApiKey?: string; dashscopeApiKey?: string; tokenrouterApiKey?: string } = {}

  // Update only provided keys (don't clear existing ones unless explicitly empty)
  if (typeof body.zaiApiKey === 'string') {
    updates.zaiApiKey = body.zaiApiKey.trim() || undefined
    logger.info('settings.updated', { key: 'zai', source: 'ui' })
  }
  if (typeof body.dashscopeApiKey === 'string') {
    updates.dashscopeApiKey = body.dashscopeApiKey.trim() || undefined
    logger.info('settings.updated', { key: 'dashscope', source: 'ui' })
  }
  if (typeof body.tokenrouterApiKey === 'string') {
    updates.tokenrouterApiKey = body.tokenrouterApiKey.trim() || undefined
    logger.info('settings.updated', { key: 'tokenrouter', source: 'ui' })
  }

  setSettings(updates)
  const settings = getSettings()

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
