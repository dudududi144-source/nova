// ============================================================
// GET /api/nova/performance — Performance profiling dashboard
// ============================================================
// Returns the NOVA performance stats + bottleneck analysis + per-agent
// performance. Powers the "Performance" panel of the NOVA dashboard.
//
// Query params:
//   ?report=true  → return a human-readable markdown report instead of JSON
//
// Response (JSON):
//   {
//     stats: PerformanceStats,
//     bottleneck: BottleneckAnalysis,
//     agents: AgentStat[],
//   }
// ============================================================
import type { NextRequest } from 'next/server';
import {
  getPerformanceStats,
  getBottleneckAnalysis,
  getAgentPerformanceStats,
  formatPerformanceReport,
} from '@/lib/performance-profiler';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: NextRequest): Promise<Response> {
  try {
    const reportOnly = request.nextUrl.searchParams.get('report') === 'true';

    if (reportOnly) {
      const report = formatPerformanceReport();
      return new Response(report, {
        status: 200,
        headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
      });
    }

    const stats = getPerformanceStats();
    const bottleneck = getBottleneckAnalysis();
    const agents = getAgentPerformanceStats();

    return Response.json({
      ok: true,
      stats,
      bottleneck,
      agents,
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
