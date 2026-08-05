// POST /api/enhance — Expand a terse prompt into a detailed build spec.
//
// Many users type "todo app" or "calculator" which is too terse for the LLM
// to produce a great result. This endpoint takes such a prompt and returns
// a richer, more specific version that lists concrete features, interactions,
// and design goals — without changing the user's intent.
//
// Uses the Z.AI chat model (non-streaming — the response is short, ~1-3 sentences).
// Falls back to DashScope/Qwen if Z.AI fails (same pattern as build/code).
//
// Response: { ok: true, enhanced: "...", tokens: 150, ms: 1200 }
//         | { ok: false, error: "..." }

import type { NextRequest } from 'next/server'
import { llmChat } from '@/lib/llm'
import { validateMission } from '@/lib/mission'
import { RateLimiter } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'
import { isDashScopeConfigured, dashscopeChat } from '@/lib/dashscope'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

const enhanceLimiter = new RateLimiter(1000, 60 * 60 * 1000, 5 * 60 * 1000, 200)
const MAX_BODY_BYTES = 10_000

const ENHANCE_SYSTEM_PROMPT = `You are a prompt engineer for NOVA, a prompt-to-app generator.
The user gives you a terse app idea. Your job is to expand it into a single,
rich, specific build prompt that NOVA can turn into a great single-file HTML app.

RULES:
- Output ONE sentence starting with "Build a" or "Build an".
- Add 2-4 concrete features the app should have (e.g., "with add/delete/complete, filter by status, and local storage persistence").
- Mention key interactions (e.g., "drag-and-drop reordering", "keyboard shortcuts").
- Mention visual style ONLY if it helps (e.g., "with a clean minimalist dark UI").
- Do NOT mention external APIs, backend, or databases — NOVA builds single-file apps with no backend.
- Do NOT mention frameworks (React, Vue) — NOVA uses vanilla HTML/CSS/JS.
- Keep it under 60 words. Be specific, not generic.
- Output ONLY the enhanced prompt. No preamble, no quotes, no markdown.

EXAMPLES:
Input: "todo app"
Output: Build a todo app with add/delete/complete, filter by all/active/completed, drag-to-reorder, in-memory persistence, and a clean dark UI with smooth transitions.

Input: "calculator"
Output: Build a calculator with basic arithmetic, keyboard input, percent and sign toggle, a calculation history panel, and a responsive button grid with tactile feedback.

Input: "snake game"
Output: Build a snake game with score tracking, increasing speed per level, pause/resume, mobile swipe controls, and a game-over screen with restart.`

interface EnhanceBody {
  prompt?: unknown
}

export async function POST(request: NextRequest): Promise<Response> {
  const contentLength = parseInt(request.headers.get('content-length') ?? '0', 10)
  if (contentLength > MAX_BODY_BYTES) {
    return Response.json({ ok: false, error: 'Request body too large (max 10KB)' }, { status: 413 })
  }

  let body: EnhanceBody
  try {
    body = (await request.json()) as EnhanceBody
  } catch {
    return Response.json({ ok: false, error: 'Invalid JSON' }, { status: 400 })
  }

  const prompt = typeof body?.prompt === 'string' ? body.prompt.trim() : ''

  // Validate — same rules as mission (3-2000 chars, no control chars)
  const check = validateMission(prompt)
  if (!check.ok) {
    return Response.json({ ok: false, error: check.error ?? 'Invalid prompt' }, { status: 400 })
  }

  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || request.headers.get('x-real-ip') || 'unknown'
  const rl = enhanceLimiter.check(ip)
  if (!rl.ok) {
    return Response.json({ ok: false, error: 'Rate limited — try again in a few minutes' }, { status: 429 })
  }

  logger.info('enhance.started', { ip, prompt: prompt.slice(0, 80) })

  // Try Z.AI first
  let result = await llmChat(ENHANCE_SYSTEM_PROMPT, prompt, {
    maxTokens: 300,
    temperature: 0.5,
    timeoutMs: 30_000,
  })

  // Fallback to Qwen/DashScope if Z.AI failed
  if (!result.ok && isDashScopeConfigured()) {
    logger.warn('enhance.zai_failed_fallback_qwen', { ip, error: result.error })
    result = await dashscopeChat(ENHANCE_SYSTEM_PROMPT, prompt, {
      maxTokens: 300,
      temperature: 0.5,
      timeoutMs: 30_000,
    })
  }

  if (!result.ok) {
    logger.error('enhance.failed', { ip, error: result.error })
    return Response.json({ ok: false, error: result.error ?? 'Enhancement failed' }, { status: 502 })
  }

  // Clean up the response: strip quotes, code fences, leading/trailing whitespace
  let enhanced = result.text.trim()
  enhanced = enhanced.replace(/^```[\w]*\n?/g, '').replace(/\n?```$/g, '')
  enhanced = enhanced.replace(/^["'`]|["'`]$/g, '')
  enhanced = enhanced.trim()

  // Sanity check: if the enhanced prompt is empty or shorter than the original,
  // something went wrong — return the original so the user isn't stuck.
  if (!enhanced || enhanced.length < prompt.length) {
    logger.warn('enhance.short_result', { ip, enhancedLen: enhanced.length, originalLen: prompt.length })
    return Response.json({
      ok: true,
      enhanced: prompt,
      tokens: result.tokens,
      ms: result.ms,
      note: 'Could not enhance — using original prompt',
    })
  }

  logger.info('enhance.completed', { ip, ms: result.ms, tokens: result.tokens, enhancedLen: enhanced.length })

  return Response.json({
    ok: true,
    enhanced,
    tokens: result.tokens,
    ms: result.ms,
  })
}
