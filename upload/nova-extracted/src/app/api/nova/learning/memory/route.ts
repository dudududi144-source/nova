// GET /api/nova/learning/memory — inspect past AgentMemory rows
//
// Query params (all optional):
//   category (string)  — filter by category/domain
//   agentId (string)   — filter by agent
//   success ("true"|"false") — filter by success boolean
//   limit  (number)    — max rows to return (default 20, capped at 100)
//
// Response:
//   { memories: AgentMemory[], count: number, total: number }
//
// Used for debugging the learning loop — see what the agents actually remember.
import type { NextRequest } from 'next/server';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: NextRequest): Promise<Response> {
  try {
    const { searchParams } = new URL(request.url);
    const category = searchParams.get('category') || undefined;
    const agentId = searchParams.get('agentId') || undefined;
    const successStr = searchParams.get('success');
    const limitRaw = parseInt(searchParams.get('limit') || '20', 10);
    const limit = Math.min(Math.max(isNaN(limitRaw) ? 20 : limitRaw, 1), 100);

    let success: boolean | undefined;
    if (successStr === 'true') success = true;
    else if (successStr === 'false') success = false;

    const where = {
      AND: [
        category ? { category } : {},
        agentId ? { agentId } : {},
        success === undefined ? {} : { success },
      ],
    };

    const [memories, count, total] = await Promise.all([
      db.agentMemory.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        select: {
          id: true,
          mission: true,
          category: true,
          subType: true,
          agentId: true,
          agentName: true,
          success: true,
          durationMs: true,
          forgeProjectId: true,
          vaultReleaseId: true,
          learnings: true,
          createdAt: true,
          // sourceCode/testOutput deliberately omitted from default listing —
          // they can be huge. Available on a single-memory GET if needed.
        },
      }),
      db.agentMemory.count({ where }),
      db.agentMemory.count(),
    ]);

    return Response.json({
      memories,
      count,
      total,
    });
  } catch (err) {
    console.error('[/api/nova/learning/memory] failed:', err instanceof Error ? err.message : String(err));
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
