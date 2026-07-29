// GET /api/nova/conversation/recent — recent agent conversations (dashboard view)
// ----------------------------------------------------------------------------
// Returns a summary of the last 20 missions that have an agent conversation,
// with turn count, agent count, and duration. Used by the dashboard widget to
// show "recent team deliberations."
//
// Query params:
//   limit (optional, default 20, max 100) — number of missions to return
//
// Response:
//   {
//     ok: true,
//     count: number,
//     conversations: Array<{
//       missionId: string,
//       correlationId: string,
//       turnCount: number,
//       agentCount: number,
//       llmTurnCount: number,
//       durationMs: number,
//       firstTurnAt: string,    // ISO
//       lastTurnAt: string,     // ISO
//       firstAgent: { name, role, icon } | null,
//       lastAgent:  { name, role, icon } | null,
//       agents: Array<{ agentId, agentName, agentRole, turnCount }>,
//       preview: string         // first 200 chars of the last turn's content
//     }>,
//     aggregate: {
//       totalMissions: number,
//       totalTurns: number,
//       averageTurns: number,
//       averageDurationMs: number,
//       averageAgents: number,
//       llmTurnCount: number
//     }
//   }
import type { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { FULL_AGENT_PROFILES } from '@/lib/nova-full-profiles';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const AGENT_META: Record<string, { name: string; role: string; icon: string; color: string }> = Object.fromEntries(
  Object.entries(FULL_AGENT_PROFILES).map(([k, v]) => [k, { name: v.name, role: v.role, icon: v.icon, color: v.color }]),
);

function metaFor(agentId: string): { name: string; role: string; icon: string; color: string } | null {
  return AGENT_META[agentId] ?? null;
}

export async function GET(request: NextRequest): Promise<Response> {
  const t0 = Date.now();
  try {
    const { searchParams } = new URL(request.url);
    const limitRaw = parseInt(searchParams.get('limit') ?? '20', 10);
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(100, limitRaw)) : 20;

    // Step 1: find the most recent missions that have conversation rows.
    // We group by missionId and pick the max ts per mission, then order desc.
    // Prisma's groupBy + raw SQL would be cleaner, but to stay portable we
    // fetch recent rows (capped) and group in JS.
    const recentRows = await db.agentConversation.findMany({
      orderBy: { ts: 'desc' },
      take: limit * 12, // heuristic: each mission has ~11 turns; over-fetch to be safe
    });

    // Group by missionId, preserving the latest-ts ordering
    const byMission = new Map<string, typeof recentRows>();
    for (const row of recentRows) {
      const arr = byMission.get(row.missionId) ?? [];
      arr.push(row);
      byMission.set(row.missionId, arr);
    }

    // Sort missions by their max ts desc, take top `limit`
    const missionEntries = Array.from(byMission.entries())
      .map(([missionId, rows]) => {
        const sorted = rows.slice().sort((a, b) => a.turn - b.turn);
        const lastTs = sorted.reduce((max, r) => {
          const t = r.ts instanceof Date ? r.ts.getTime() : new Date(r.ts as any).getTime();
          return t > max ? t : max;
        }, 0);
        return { missionId, rows: sorted, lastTs };
      })
      .sort((a, b) => b.lastTs - a.lastTs)
      .slice(0, limit);

    const conversations = missionEntries.map(({ missionId, rows }) => {
      const correlationId = rows[0]?.correlationId ?? '';
      const turnCount = rows.length;
      const agentSet = new Map<string, { agentId: string; agentName: string; agentRole: string; turnCount: number }>();
      for (const r of rows) {
        const existing = agentSet.get(r.agentId);
        if (existing) existing.turnCount += 1;
        else agentSet.set(r.agentId, { agentId: r.agentId, agentName: r.agentName, agentRole: r.agentRole, turnCount: 1 });
      }
      const agents = Array.from(agentSet.values()).sort((a, b) => b.turnCount - a.turnCount);
      const agentCount = agents.length;
      const llmTurnCount = rows.filter(r => r.isLLM).length;

      const firstRow = rows[0];
      const lastRow = rows[rows.length - 1];
      const firstTs = firstRow?.ts instanceof Date ? firstRow.ts.getTime() : new Date(firstRow?.ts as any).getTime();
      const lastTs = lastRow?.ts instanceof Date ? lastRow.ts.getTime() : new Date(lastRow?.ts as any).getTime();
      const durationMs = rows.length >= 2 ? Math.max(0, lastTs - firstTs) : 0;

      const firstAgent = firstRow ? metaFor(firstRow.agentId) : null;
      const lastAgent = lastRow ? metaFor(lastRow.agentId) : null;

      const preview = (lastRow?.content ?? '').slice(0, 200);

      const firstTurnAt = firstRow
        ? (firstRow.ts instanceof Date ? firstRow.ts : new Date(firstRow.ts as any)).toISOString()
        : null;
      const lastTurnAt = lastRow
        ? (lastRow.ts instanceof Date ? lastRow.ts : new Date(lastRow.ts as any)).toISOString()
        : null;

      return {
        missionId,
        correlationId,
        turnCount,
        agentCount,
        llmTurnCount,
        durationMs,
        firstTurnAt,
        lastTurnAt,
        firstAgent: firstAgent ? { name: firstAgent.name, role: firstAgent.role, icon: firstAgent.icon, color: firstAgent.color } : null,
        lastAgent: lastAgent ? { name: lastAgent.name, role: lastAgent.role, icon: lastAgent.icon, color: lastAgent.color } : null,
        agents,
        preview,
      };
    });

    // Aggregate stats
    const totalMissions = conversations.length;
    const totalTurns = conversations.reduce((s, c) => s + c.turnCount, 0);
    const averageTurns = totalMissions > 0 ? Math.round((totalTurns / totalMissions) * 10) / 10 : 0;
    const averageDurationMs = totalMissions > 0
      ? Math.round(conversations.reduce((s, c) => s + c.durationMs, 0) / totalMissions)
      : 0;
    const averageAgents = totalMissions > 0
      ? Math.round((conversations.reduce((s, c) => s + c.agentCount, 0) / totalMissions) * 10) / 10
      : 0;
    const llmTurnCount = conversations.reduce((s, c) => s + c.llmTurnCount, 0);

    return Response.json({
      ok: true,
      count: conversations.length,
      conversations,
      aggregate: {
        totalMissions,
        totalTurns,
        averageTurns,
        averageDurationMs,
        averageAgents,
        llmTurnCount,
      },
      ms: Date.now() - t0,
    });
  } catch (err) {
    console.error('[/api/nova/conversation/recent] failed:', err instanceof Error ? err.message : String(err));
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
