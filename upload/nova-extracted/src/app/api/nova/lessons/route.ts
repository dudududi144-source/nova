// ============================================================================
// GET /api/nova/lessons — Adaptive Learning dashboard endpoint
// ----------------------------------------------------------------------------
// SUB-W-ADAPTIVE-LEARNING-FEEDBACK
//
// Returns recent lessons + aggregate learning stats. Used by the dashboard
// widget to show "what the agents have learned" and the improvement trend.
//
// Query params (all optional):
//   type    (string) — filter lessons by mission type (game, algorithm, api, ...)
//   limit   (number) — max lessons to return (default 20, capped at 100)
//   stats   ("true") — if set, include aggregate stats in the response
//   outcome ("success"|"failure") — filter by outcome
//
// Response shape:
//   {
//     ok: true,
//     lessons: Lesson[],          // recent lessons (newest first)
//     count: number,              // # of lessons returned
//     total: number,              // total lessons in DB (with type filter applied)
//     stats?: LearningStats,      // only when stats=true
//     ms: number                  // wall-clock time
//   }
//
// Notes:
//   - Lessons are returned newest-first so the widget can show "latest learnings".
//   - The stats include the improvement trend (recent-5 minus early-5 mission
//     averages) — positive = agents are getting better, negative = regressing.
//   - This endpoint is READ-ONLY — never throws 500 on DB errors. Returns a
//     500 with an error message only when the DB is truly unreachable.
// ============================================================================

import type { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import {
  getLearningStats,
  type Lesson,
  type LearningStats,
} from '@/lib/adaptive-learning';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function parseKeywords(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter((x: unknown) => typeof x === 'string');
    }
  } catch {
    /* fall through */
  }
  return [];
}

function serialize(row: any): Lesson {
  return {
    id: row.id,
    mission: row.mission,
    type: row.type,
    subtype: row.subtype || '',
    dimension: row.dimension,
    score: row.score,
    outcome: row.outcome === 'success' ? 'success' : 'failure',
    lesson: row.lesson,
    pattern: row.pattern || '',
    missionKeywords: parseKeywords(row.missionKeywords),
    createdAt: row.createdAt,
  };
}

export async function GET(request: NextRequest): Promise<Response> {
  const t0 = Date.now();
  try {
    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type') || undefined;
    const outcomeRaw = searchParams.get('outcome');
    let outcome: 'success' | 'failure' | undefined;
    if (outcomeRaw === 'success') outcome = 'success';
    else if (outcomeRaw === 'failure') outcome = 'failure';

    const includeStats = searchParams.get('stats') === 'true';

    const limitRaw = parseInt(searchParams.get('limit') || '20', 10);
    const limit = Math.min(Math.max(isNaN(limitRaw) ? 20 : limitRaw, 1), 100);

    // Build the where clause from the optional filters
    const where: any = {
      AND: [
        type ? { type } : {},
        outcome ? { outcome } : {},
      ],
    };

    const [rows, count, total, stats] = await Promise.all([
      db.agentLesson.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
      }),
      db.agentLesson.count({ where }),
      db.agentLesson.count(),
      includeStats ? getLearningStats() : Promise.resolve(null as LearningStats | null),
    ]);

    return Response.json({
      ok: true,
      lessons: rows.map(serialize),
      count,
      total,
      stats: stats ?? undefined,
      ms: Date.now() - t0,
    });
  } catch (err) {
    console.error(
      '[/api/nova/lessons] failed:',
      err instanceof Error ? err.message : String(err),
    );
    return Response.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        ms: Date.now() - t0,
      },
      { status: 500 },
    );
  }
}
