// GET /api/nova/stats — aggregate build statistics for the quality dashboard
// Returns per-mission-type aggregates: count, avg quality, best, worst, success rate, trend.
// Also returns overall stats. Used by the Quality Regression Dashboard (N).
// KK extension: includes effectiveness (success rate per type) + failure counts.
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface ByTypeRow {
  category: string;
  count: number;
  avg: number;
  best: number;
  worst: number;
  successRate: number;
  recentAvg: number; // last 5 builds avg — to detect regression
  previousAvg: number; // builds 6-10 avg — baseline
  trend: 'up' | 'down' | 'flat' | 'new';
  // ── Effectiveness (KK) — failure tracking per type ──
  failures: number;
  effectiveness: number; // 0-100 — success rate weighted by recency
}

export async function GET(): Promise<Response> {
  try {
    // Pull all builds (success + failure) from AgentMemory for effectiveness.
    // For quality trend we only use successful builds (with parseable quality).
    const allRecords = await db.agentMemory.findMany({
      where: { category: { not: 'feedback' } },
      orderBy: { createdAt: 'asc' },
      take: 300, // bigger window for failure stats
      select: { mission: true, category: true, subType: true, success: true, learnings: true, durationMs: true, createdAt: true },
    });

    const extractQuality = (learnings: string): number => {
      const m = learnings?.match(/quality\s+([\d.]+)/i);
      return m ? parseFloat(m[1]) : 0;
    };

    // Group by subType (falls back to category if subType empty) — track both
    // successful (for quality trend) and all (for effectiveness)
    const groups: Record<string, { quality: number; success: boolean; createdAt: Date }[]> = {};
    for (const r of allRecords) {
      const key = (r.subType && r.subType.length > 0) ? r.subType : (r.category || 'general');
      const q = extractQuality(r.learnings || '');
      if (!groups[key]) groups[key] = [];
      // Include all records (even failures — quality 0 for failures) for effectiveness
      groups[key].push({ quality: q, success: r.success, createdAt: r.createdAt });
    }

    const byType: ByTypeRow[] = [];
    for (const [category, items] of Object.entries(groups)) {
      if (items.length === 0) continue;
      items.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
      const successItems = items.filter(i => i.success && i.quality > 0);
      const quals = successItems.map(i => i.quality);
      const avg = quals.length ? quals.reduce((s, x) => s + x, 0) / quals.length : 0;
      const recent5 = successItems.slice(-5).map(i => i.quality);
      const recentAvg = recent5.length ? recent5.reduce((s, x) => s + x, 0) / recent5.length : 0;
      const previous5 = successItems.slice(-10, -5).map(i => i.quality);
      const previousAvg = previous5.length > 0 ? previous5.reduce((s, x) => s + x, 0) / previous5.length : null;
      let trend: ByTypeRow['trend'] = 'new';
      if (previousAvg !== null) {
        const delta = recentAvg - previousAvg;
        trend = Math.abs(delta) < 0.3 ? 'flat' : delta > 0 ? 'up' : 'down';
      }
      const failures = items.filter(i => !i.success).length;
      // Effectiveness: success rate × 100, but recent failures weighted 2x
      const recent10 = items.slice(-10);
      const recentFailures = recent10.filter(i => !i.success).length;
      const recentSuccessRate = recent10.length > 0 ? (recent10.length - recentFailures) / recent10.length : 1;
      const overallSuccessRate = items.length > 0 ? (items.length - failures) / items.length : 1;
      const effectiveness = Math.round((recentSuccessRate * 0.7 + overallSuccessRate * 0.3) * 100);
      byType.push({
        category,
        count: items.length,
        avg: Number(avg.toFixed(2)),
        best: quals.length ? Math.max(...quals) : 0,
        worst: quals.length ? Math.min(...quals) : 0,
        successRate: overallSuccessRate,
        recentAvg: Number(recentAvg.toFixed(2)),
        previousAvg: previousAvg !== null ? Number(previousAvg.toFixed(2)) : 0,
        trend,
        failures,
        effectiveness,
      });
    }
    byType.sort((a, b) => b.count - a.count);

    const allQuals = allRecords.map(r => extractQuality(r.learnings || '')).filter(q => q > 0);
    const totalSuccess = allRecords.filter(r => r.success).length;
    return Response.json({
      ok: true,
      overall: {
        totalBuilds: allRecords.length,
        successfulBuilds: totalSuccess,
        failedBuilds: allRecords.length - totalSuccess,
        avgQuality: allQuals.length ? Number((allQuals.reduce((s, x) => s + x, 0) / allQuals.length).toFixed(2)) : 0,
        bestQuality: allQuals.length ? Math.max(...allQuals) : 0,
        typeCount: byType.length,
        overallEffectiveness: allRecords.length > 0 ? Math.round((totalSuccess / allRecords.length) * 100) : 0,
      },
      byType,
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    return Response.json({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      overall: { totalBuilds: 0, successfulBuilds: 0, failedBuilds: 0, avgQuality: 0, bestQuality: 0, typeCount: 0, overallEffectiveness: 0 },
      byType: [],
    }, { status: 500 });
  }
}

