// ============================================================
// GET /api/nova/assess — NOVA self-assessment + pipeline stats
// ============================================================
// Produces a quality snapshot of the NOVA autonomous code agency.
// Aggregates: total missions (arena runs of origin nova), success
// rate, overall quality score (0-100), and active improvement plans.
//
// Returns:
//   {
//     overallQuality: number (0-100),
//     totalMissions, successCount, failCount,
//     successRate,
//     improvementPlans: [{ id, title, priority, status, impact }],
//     assessedAt
//   }
// ============================================================
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const IMPROVEMENT_PLANS = [
  { id: 'plan-001', title: 'Increase Coder agent test coverage from 78% to 92%', priority: 'high', status: 'in_progress', impact: 'quality' },
  { id: 'plan-002', title: 'Reduce PM planning latency under 500ms', priority: 'medium', status: 'planned', impact: 'latency' },
  { id: 'plan-003', title: 'Add Architect fallback for trivial missions', priority: 'low', status: 'planned', impact: 'efficiency' },
  { id: 'plan-004', title: 'Auto-archive missions older than 30 days', priority: 'low', status: 'in_progress', impact: 'storage' },
  { id: 'plan-005', title: 'Distill recurring QA patterns into reusable playbook', priority: 'high', status: 'in_progress', impact: 'quality' },
];

export async function GET(): Promise<Response> {
  try {
    const [totalMissions, successCount, failCount, recentRuns] = await Promise.all([
      db.arenaRun.count({ where: { origin: 'nova' } }).catch(() => 0),
      db.arenaRun.count({ where: { origin: 'nova', ok: true } }).catch(() => 0),
      db.arenaRun.count({ where: { origin: 'nova', ok: false } }).catch(() => 0),
      db.arenaRun.findMany({
        where: { origin: 'nova' },
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: { ok: true, durationMs: true, createdAt: true },
      }).catch(() => []),
    ]);

    const successRate = totalMissions > 0 ? Math.round((successCount / totalMissions) * 100) : 0;

    // Overall quality: weighted blend of success rate, latency, and recency.
    // successRate (0-100) is 70% of weight, latency score (faster = higher) 20%,
    // recency (had activity in last hour) 10%.
    const avgDurationMs = recentRuns.length > 0 && recentRuns.some(r => r.durationMs)
      ? recentRuns.reduce((s, r) => s + (r.durationMs ?? 0), 0) / recentRuns.filter(r => r.durationMs).length
      : 0;
    const latencyScore = avgDurationMs > 0 ? Math.max(0, 100 - Math.min(60, avgDurationMs / 100)) : 80;
    const lastRunTs = recentRuns[0]?.createdAt?.getTime() ?? 0;
    const recencyScore = lastRunTs > 0 && (Date.now() - lastRunTs) < 3600_000 ? 100 : 50;

    const overallQuality = Math.round(successRate * 0.7 + latencyScore * 0.2 + recencyScore * 0.1);

    return Response.json({
      overallQuality,
      totalMissions,
      successCount,
      failCount,
      successRate,
      avgDurationMs: Math.round(avgDurationMs),
      improvementPlans: IMPROVEMENT_PLANS,
      assessedAt: new Date().toISOString(),
    });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
