// GET /api/nova/recent-missions — recent unified mission memories
// ----------------------------------------------------------------------------
// Used by the Universal Mission Console's "Past Missions" list.
//
// Returns the most recent AgentMemory rows (default 20, capped at 50) with the
// fields needed to display a mission card: mission text, category, subType,
// success, durationMs, createdAt, vaultReleaseId, forgeProjectId, and an
// arenaSnippetId parsed from the learnings JSON when present.
//
// Query params:
//   limit (number)   — max rows (default 20, capped at 50)
//   category (string) — optional category filter
//
// Response:
//   { missions: RecentMission[], count, total }
import type { NextRequest } from 'next/server';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export interface RecentMission {
  id: string;
  mission: string;
  category: string;
  subType: string;
  agentName: string;
  success: boolean;
  durationMs: number;
  forgeProjectId: string | null;
  vaultReleaseId: string | null;
  arenaSnippetId: string | null;
  createdAt: string;
}

function parseArenaSnippetId(learnings: string | null | undefined): string | null {
  if (!learnings) return null;
  // Try JSON parse first (some learnings are JSON)
  try {
    const obj = JSON.parse(learnings);
    if (obj && typeof obj === 'object') {
      const candidate = (obj as Record<string, unknown>).arenaSnippetId ??
        (obj as Record<string, unknown>).arenaId ??
        (obj as Record<string, unknown>).snippetId;
      if (typeof candidate === 'string' && candidate.length > 0) return candidate;
    }
  } catch {
    // not JSON, fall through to regex
  }
  // Fallback: regex match `arenaSnippetId":"..."` or `snippet: ...`
  const m1 = learnings.match(/arenaSnippetId["']?\s*[:=]\s*["']([a-zA-Z0-9_]+)/);
  if (m1) return m1[1];
  const m2 = learnings.match(/arena snippet[:\s]+([a-zA-Z0-9_]+)/i);
  if (m2) return m2[1];
  return null;
}

export async function GET(request: NextRequest): Promise<Response> {
  try {
    const { searchParams } = new URL(request.url);
    const limitRaw = parseInt(searchParams.get('limit') || '20', 10);
    const limit = Math.min(Math.max(isNaN(limitRaw) ? 20 : limitRaw, 1), 50);
    const category = searchParams.get('category') || undefined;

    const where = category ? { category } : {};

    const [rows, count, total] = await Promise.all([
      db.agentMemory.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        select: {
          id: true,
          mission: true,
          category: true,
          subType: true,
          agentName: true,
          success: true,
          durationMs: true,
          forgeProjectId: true,
          vaultReleaseId: true,
          learnings: true,
          createdAt: true,
        },
      }),
      db.agentMemory.count({ where }),
      db.agentMemory.count(),
    ]);

    const missions: RecentMission[] = rows.map((r) => ({
      id: r.id,
      mission: r.mission,
      category: r.category || '',
      subType: r.subType || '',
      agentName: r.agentName || '',
      success: !!r.success,
      durationMs: r.durationMs || 0,
      forgeProjectId: r.forgeProjectId ?? null,
      vaultReleaseId: r.vaultReleaseId ?? null,
      arenaSnippetId: parseArenaSnippetId(r.learnings),
      createdAt:
        r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
    }));

    return Response.json({ missions, count, total });
  } catch (err) {
    console.error(
      '[/api/nova/recent-missions] failed:',
      err instanceof Error ? err.message : String(err),
    );
    return Response.json(
      { error: err instanceof Error ? err.message : String(err), missions: [], count: 0, total: 0 },
      { status: 500 },
    );
  }
}
