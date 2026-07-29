// GET /api/nova/quality-stats — aggregate quality stats from AgentMemory
// Returns: total builds, avg quality, best/worst, per-type breakdown, trend
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(): Promise<Response> {
  try {
    const records = await db.agentMemory.findMany({
      where: { success: true, category: { not: 'feedback' } },
      orderBy: { createdAt: 'asc' },
      take: 200,
      select: { mission: true, category: true, subType: true, learnings: true, durationMs: true, createdAt: true },
    });

    const extractQuality = (learnings: string): number => {
      const m = learnings?.match(/quality\s+([\d.]+)/i);
      return m ? parseFloat(m[1]) : 0;
    };

    const allQuals = records.map(r => extractQuality(r.learnings || '')).filter(q => q > 0);
    const byType: Record<string, { count: number; avg: number; best: number; worst: number }> = {};

    for (const r of records) {
      const q = extractQuality(r.learnings || '');
      if (q <= 0) continue;
      const key = r.subType || r.category || 'general';
      if (!byType[key]) byType[key] = { count: 0, avg: 0, best: 0, worst: 10 };
      byType[key].count++;
      byType[key].avg += q;
      byType[key].best = Math.max(byType[key].best, q);
      byType[key].worst = Math.min(byType[key].worst, q);
    }

    for (const key of Object.keys(byType)) {
      byType[key].avg = byType[key].count > 0 ? byType[key].avg / byType[key].count : 0;
    }

    return Response.json({
      ok: true,
      overall: {
        totalBuilds: records.length,
        avgQuality: allQuals.length ? Number((allQuals.reduce((s, x) => s + x, 0) / allQuals.length).toFixed(2)) : 0,
        bestQuality: allQuals.length ? Math.max(...allQuals) : 0,
        worstQuality: allQuals.length ? Math.min(...allQuals) : 0,
        typeCount: Object.keys(byType).length,
      },
      byType: Object.entries(byType).map(([type, s]) => ({
        type, count: s.count, avg: Number(s.avg.toFixed(2)), best: s.best, worst: s.worst
      })).sort((a, b) => b.count - a.count),
      trend: allQuals.slice(-20).map(q => Number(q.toFixed(2))),
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    return Response.json({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      overall: { totalBuilds: 0, avgQuality: 0, bestQuality: 0, worstQuality: 0, typeCount: 0 },
      byType: [], trend: [],
    }, { status: 500 });
  }
}
