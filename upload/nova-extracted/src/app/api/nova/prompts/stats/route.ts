// ============================================================================
// GET /api/nova/prompts/stats — Prompt evolution dashboard stats
// ----------------------------------------------------------------------------
// SUB-Y-PROMPT-EVOLUTION
//
// Returns the prompt-evolution stats payload:
//   - totalVariants: total PromptVariant rows in DB
//   - totalMissions: distinct missions recorded
//   - byAgent: per-agent breakdown
//       • every variant's description, sample count, avg quality,
//         avg tokens, avg duration, success rate
//       • which variant is currently the "winner"
//       • improvementPct (best-vs-default delta)
//       • recommendation (human-readable)
//   - improvementPct: mean across agents
//   - recommendations: top-level recommendations list
//
// Query params (all optional):
//   agent  (string) — filter to a single agent (pm|architect|coder|qa|sec|rel).
//                     When set, byAgent contains only that agent's entry.
//
// Response shape:
//   {
//     ok: true,
//     stats: EvolutionStats,
//     ms: number
//   }
//
// Initial state: totalVariants=0, byAgent entries all show 0 samples with
// "insufficient data" recommendations. This is the expected initial response.
// ============================================================================

import type { NextRequest } from 'next/server';
import { getEvolutionStats, EVOLUTION_AGENTS } from '@/lib/prompt-evolution';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: NextRequest): Promise<Response> {
  const t0 = Date.now();
  try {
    const { searchParams } = new URL(request.url);
    const agentFilter = searchParams.get('agent');

    const stats = await getEvolutionStats();

    // Optional: filter to a single agent for narrow dashboards.
    if (agentFilter && EVOLUTION_AGENTS.includes(agentFilter as any)) {
      const filtered = stats.byAgent.filter(a => a.agentId === agentFilter);
      return Response.json({
        ok: true,
        stats: { ...stats, byAgent: filtered },
        ms: Date.now() - t0,
      });
    }

    return Response.json({
      ok: true,
      stats,
      ms: Date.now() - t0,
    });
  } catch (err) {
    console.error(
      '[/api/nova/prompts/stats] failed:',
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
