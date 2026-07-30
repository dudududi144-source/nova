// POST /api/build/architect — Stage 1 only.
// Returns the architect's JSON plan for a mission.
// Fast (~2-3s), cheap (~300 tokens), reliable (never truncates).

import type { NextRequest } from 'next/server'
import { llmChat } from '@/lib/llm'
import { validateMission } from '@/lib/mission'
import { RateLimiter } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'
import { enrichMission } from '@/lib/build-intelligence'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 30

const ARCHITECT_PROMPT = `You are a software architect. Output a JSON plan for a single-file HTML app. Output ONLY JSON.

{
  "type": "game|tool|app",
  "title": "title",
  "features": ["feature1", "feature2", "feature3"],
  "approach": "how to build it",
  "colors": { "bg": "#0f172a", "primary": "#3b82f6", "accent": "#22d3ee" },
  "layout": "UI layout description",
  "keyFunctions": ["func1", "func2"]
}`

const architectLimiter = new RateLimiter(100, 60 * 60 * 1000, 5 * 60 * 1000, 1000)

interface ArchitectBody {
  mission?: unknown
}

export async function POST(request: NextRequest): Promise<Response> {
  let body: ArchitectBody
  try {
    body = (await request.json()) as ArchitectBody
  } catch {
    return Response.json({ ok: false, error: 'Invalid JSON' }, { status: 400 })
  }

  const mission = typeof body?.mission === 'string' ? body.mission.trim() : ''
  const validation = validateMission(mission)
  if (!validation.ok) {
    return Response.json({ ok: false, error: validation.error ?? 'Invalid mission' }, { status: 400 })
  }

  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || request.headers.get('x-real-ip') || 'unknown'
  const rl = architectLimiter.check(ip)
  if (!rl.ok) {
    return Response.json({ ok: false, error: 'Rate limited' }, { status: 429 })
  }

  logger.info('architect.started', { ip, mission: mission.slice(0, 80) })

  // Enrich the mission with implementation hints before sending to architect
  const enriched = enrichMission(mission)
  logger.info('architect.enriched', { ip, type: enriched.detectedType, hints: enriched.hints.length })

  const result = await llmChat(ARCHITECT_PROMPT, `Mission: ${enriched.enriched}`, {
    maxTokens: 1000,
    temperature: 0.5,
    timeoutMs: 20_000,
    signal: request.signal,
  })

  if (!result.ok) {
    logger.error('architect.failed', { ip, error: result.error, ms: result.ms })
    return Response.json({ ok: false, error: result.error ?? 'Architect failed' }, { status: 502 })
  }

  // Parse the plan
  let plan: unknown = null
  try {
    const text = result.text.trim()
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    if (start >= 0 && end > start) {
      plan = JSON.parse(text.slice(start, end + 1))
    }
  } catch {
    // Plan parsing failed — return raw text
  }

  logger.info('architect.completed', { ip, ms: result.ms, tokens: result.tokens, hasPlan: !!plan })

  return Response.json({
    ok: true,
    plan,
    rawText: result.text,
    tokens: result.tokens,
    ms: result.ms,
  })
}
