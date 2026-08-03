// GET /api/build/result?id=xxx — poll for a stored build result.
// Fallback mechanism when SSE stream drops.

import type { NextRequest } from 'next/server'
import { getResult } from '@/lib/build-store'
import { RateLimiter } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const resultLimiter = new RateLimiter(200, 60 * 1000, 5 * 60 * 1000, 5000)

export async function GET(request: NextRequest): Promise<Response> {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || request.headers.get('x-real-ip') || 'unknown'
  const rl = resultLimiter.check(ip)
  if (!rl.ok) return Response.json({ error: 'Rate limited' }, { status: 429 })

  const id = request.nextUrl.searchParams.get('id')
  if (!id) return Response.json({ error: 'Missing build ID' }, { status: 400 })

  const result = getResult(id)
  if (!result) {
    return Response.json({ error: 'Build not found', status: 'not_found', requestedId: id }, { status: 404 })
  }

  return Response.json({
    status: result.status,
    html: result.html || undefined,
    tokens: result.tokens,
    ms: result.ms,
    quality: result.quality,
    metrics: result.metrics,
    files: result.files,
    outputType: result.outputType,
    previewable: result.previewable,
    suggestions: result.suggestions,
    error: result.error,
  }, { headers: { 'Cache-Control': 'no-cache, no-store, must-revalidate' } })
}
