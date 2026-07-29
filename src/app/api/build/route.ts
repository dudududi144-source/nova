// POST /api/build — one-shot LLM build.
// Body: { mission: string }
// Returns: { ok, html, tokens, ms } or { ok: false, error }
//
// No DB. No streaming. No events. One LLM call, one HTML string.

import type { NextRequest } from 'next/server'
import { llmChat, validateMission, stripCodeFences, looksLikeHtml } from '@/lib/llm'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 120

const SYSTEM_PROMPT = `You are a senior front-end engineer. You build complete, working, single-file HTML apps.

Rules:
- Output ONLY the HTML. No explanation, no markdown, no commentary.
- The HTML must be a complete document: <!DOCTYPE html>, <html>, <head>, <body>.
- All CSS goes in a <style> tag in <head>. All JS goes in a <script> tag before </body>.
- The app must be fully functional in a sandboxed iframe (no external requests, no API keys, no fetch to outside services).
- Use modern, clean, dark-themed UI (background #0f172a, text #e2e8f0) unless the user specifies otherwise.
- Make it actually work. A snake game must have a game loop, scoring, and game-over. A todo app must have add/complete/delete. A markdown editor must render in real time.
- Keep it in ONE file. Do not split into multiple files.
- Do not include any external scripts, stylesheets, fonts, or images. Everything must be inline.
- The output must be playable/usable immediately when opened in a browser.`

interface BuildBody {
  mission?: unknown
}

export async function POST(request: NextRequest): Promise<Response> {
  let body: BuildBody
  try {
    body = (await request.json()) as BuildBody
  } catch {
    return Response.json({ ok: false, error: 'Invalid JSON' }, { status: 400 })
  }

  const mission = typeof body?.mission === 'string' ? body.mission.trim() : ''
  const validation = validateMission(mission)
  if (!validation.ok) {
    return Response.json({ ok: false, error: validation.error }, { status: 400 })
  }

  // Pass request.signal so the LLM call aborts if the client disconnects
  const result = await llmChat(SYSTEM_PROMPT, `Build this: ${mission}`, {
    maxTokens: 8000,
    temperature: 0.4,
    timeoutMs: 90_000,
    signal: request.signal,
  })

  if (!result.ok) {
    // result.error is already human-friendly (sanitized in llmChat)
    return Response.json(
      { ok: false, error: result.error, tokens: result.tokens, ms: result.ms },
      { status: 502 }
    )
  }

  const html = stripCodeFences(result.text)

  if (!looksLikeHtml(html)) {
    return Response.json(
      {
        ok: false,
        error: 'The model did not return valid HTML. Try rephrasing your request.',
        tokens: result.tokens,
        ms: result.ms,
      },
      { status: 502 }
    )
  }

  return Response.json({
    ok: true,
    html,
    tokens: result.tokens,
    ms: result.ms,
  })
}
