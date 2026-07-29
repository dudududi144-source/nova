// ============================================================================
// GET /api/nova/assess/improvement-plan — Prioritized action plan
// ----------------------------------------------------------------------------
// SUB-Z-SELF-ASSESSMENT
//
// Returns JUST the improvement plan — a prioritized list of concrete actions
// the system should take to improve its weakest areas. Cheaper to call than
// the full /api/nova/assess when the consumer only needs the "what next".
//
// This is the "system knows what it needs to do next" endpoint. The
// orchestrator can poll this between missions and decide what training
// mission to run next.
//
// Query params:
//   (none)
//
// Response shape:
//   {
//     ok: true,
//     plan: {
//       plan: ImprovementAction[],   // high → medium → low priority
//       generatedAt: string,
//       basedOn: { totalLessons, totalMissions, weakestDimension, decliningTypes }
//     },
//     ms: number
//   }
//
// Notes:
//   - This internally calls assessPerformance() (the same parallel scan),
//     then projects to just the plan. If we later cache the assessment,
//     this endpoint gets the cache for free.
//   - maxDuration = 30s for parity with /api/nova/assess.
// ============================================================================

import type { NextRequest } from 'next/server';
import {
  assessPerformance,
  buildImprovementPlanReport,
  type ImprovementPlan,
} from '@/lib/self-assessment';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

export async function GET(_request: NextRequest): Promise<Response> {
  const t0 = Date.now();
  try {
    const assessment = await assessPerformance();
    const plan: ImprovementPlan = buildImprovementPlanReport(assessment);
    return Response.json({
      ok: true,
      plan,
      ms: Date.now() - t0,
    });
  } catch (err) {
    console.error(
      '[/api/nova/assess/improvement-plan] failed:',
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
