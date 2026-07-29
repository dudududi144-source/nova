// ============================================================================
// GET /api/nova/feedback/recent — Recent user feedback rows
// ----------------------------------------------------------------------------
// SUB-BB-USER-FEEDBACK-LOOP
//
// Returns the most recent UserFeedback rows, newest first. Used by the
// dashboard's "Recent Feedback" list widget.
//
// Query params:
//   limit (number) — max rows (default 20, capped at 100)
//
// Response shape:
//   {
//     ok: true,
//     feedback: UserFeedback[],  // hydrated rows (dimensionFeedback parsed)
//     count: number,             // length of feedback array
//     total: number,             // total rows in the DB
//     ms: number
//   }
//
// The `dimensionFeedback` column is JSON in the DB; this endpoint parses it
// into a plain object before returning so the client doesn't have to.
// ============================================================================

import type { NextRequest } from 'next/server';
import { getRecentFeedback } from '@/lib/user-feedback';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 15;

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return n < lo ? lo : n > hi ? hi : n;
}

export async function GET(request: NextRequest): Promise<Response> {
  const t0 = Date.now();
  try {
    const { searchParams } = new URL(request.url);
    const limitRaw = parseInt(searchParams.get('limit') || '20', 10);
    const limit = clamp(isNaN(limitRaw) ? 20 : limitRaw, 1, 100);

    const [feedback, total] = await Promise.all([
      getRecentFeedback(limit),
      // Cheap count for the total — separate from getRecentFeedback so a
      // count failure doesn't tank the whole response.
      db.userFeedback.count().catch(() => 0),
    ]);

    return Response.json({
      ok: true,
      feedback,
      count: feedback.length,
      total,
      ms: Date.now() - t0,
    });
  } catch (err) {
    console.error(
      '[/api/nova/feedback/recent] failed:',
      err instanceof Error ? err.message : String(err),
    );
    return Response.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        feedback: [],
        count: 0,
        total: 0,
        ms: Date.now() - t0,
      },
      { status: 500 },
    );
  }
}
