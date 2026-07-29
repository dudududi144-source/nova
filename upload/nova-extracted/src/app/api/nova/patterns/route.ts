// ============================================================
// GET /api/nova/patterns — Winning patterns + transfer stats
// ============================================================
// Returns the cross-mission knowledge transfer summary:
//   - stats: how many patterns stored / retrieved, avg quality with vs
//     without patterns (the "does transfer help?" number).
//   - patterns: the most recent winning patterns (capped at ?limit=, default
//     20) with their mission, type, quality, key insight.
//   - byMissionType: pattern counts grouped by mission type.
//
// Query params:
//   ?limit=N    → cap on number of patterns returned (default 20, max 100)
//   ?stats=true → return ONLY the stats summary (no patterns array)
//
// Response (JSON):
//   {
//     ok: true,
//     stats: TransferStats,
//     patterns: WinningPattern[],
//   }
// ============================================================
import type { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { deserializePattern, getTransferStats, type WinningPattern } from '@/lib/cross-mission-transfer';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: NextRequest): Promise<Response> {
  try {
    const statsOnly = request.nextUrl.searchParams.get('stats') === 'true';
    const limitParam = parseInt(request.nextUrl.searchParams.get('limit') || '20', 10);
    const limit = Number.isFinite(limitParam) ? Math.max(1, Math.min(limitParam, 100)) : 20;

    const stats = await getTransferStats();

    if (statsOnly) {
      return Response.json({ ok: true, stats });
    }

    // Fetch the most recent winning patterns from the DB and deserialize them.
    const rows = await db.agentMemory.findMany({
      where: { category: 'winning-pattern', success: true },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true, mission: true, subType: true, durationMs: true,
        learnings: true, createdAt: true,
      },
    });

    const patterns: WinningPattern[] = [];
    for (const row of rows) {
      const p = deserializePattern(row.learnings, row.mission, row.subType, row.durationMs, row.createdAt);
      if (p) patterns.push(p);
    }

    return Response.json({
      ok: true,
      stats,
      patterns,
      count: patterns.length,
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    return Response.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}
