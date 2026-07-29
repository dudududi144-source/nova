// ============================================================================
// GET /api/nova/smart-train/plan — Current smart training plan
// ----------------------------------------------------------------------------
// SUB-EE-SMART-TRAINING-SCHEDULER
//
// Returns what the Smart Scheduler WOULD train on next:
//   - The single next plan (planTrainingSession)
//   - The next 5 upcoming plans (getTrainingSchedule)
//   - The current training effectiveness (before vs after recent sessions)
//   - Whether the LLM is currently available
//
// This endpoint is for DASHBOARDS and PREVIEW: "Here's what we'd train on if
// you hit the Smart Train button." It does NOT execute anything — that's
// POST /api/nova/smart-train.
//
// Response shape:
//   {
//     ok: true,
//     plan: TrainingPlanResult,         // single next plan (planned: false on
//                                        // llm-unavailable or no-training-needed)
//     schedule: TrainingPlan[],         // up to 5 upcoming plans, by priority
//     effectiveness: TrainingEffectiveness,  // before vs after recent sessions
//     llmAvailable: boolean,
//     rateLimited: boolean,
//     alreadyRunning: boolean,          // is a session executing right now?
//     ms: number
//   }
//
// Notes:
//   - maxDuration = 30s — the assessment scan + planning queries are fast
//     (<200ms on a warm SQLite) but we leave headroom for cold starts.
//   - READ-ONLY — never throws 500 on DB errors. Returns a 500 only when the
//     DB is truly unreachable.
// ============================================================================

import type { NextRequest } from 'next/server';
import {
  planTrainingSession,
  getTrainingSchedule,
  getTrainingEffectiveness,
  isSmartTrainingRunning,
  getLastSmartTrainingResult,
  getLastSmartTrainingAt,
} from '@/lib/smart-scheduler';
import { isRateLimited } from '@/lib/llm-resilience';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

const SCHEDULE_COUNT = 5;

export async function GET(_request: NextRequest): Promise<Response> {
  const t0 = Date.now();
  try {
    // Run the planner, schedule, and effectiveness queries in parallel —
    // they all hit different DB rows and don't depend on each other.
    // (planTrainingSession internally fetches its own assessment, but the
    // redundancy is one extra ~50ms query — acceptable for clarity.)
    const [plan, schedule, effectiveness] = await Promise.all([
      planTrainingSession(),
      getTrainingSchedule(SCHEDULE_COUNT),
      getTrainingEffectiveness(),
    ]);

    return Response.json({
      ok: true,
      plan,
      schedule,
      effectiveness,
      llmAvailable: !isRateLimited(),
      rateLimited: isRateLimited(),
      alreadyRunning: isSmartTrainingRunning(),
      lastSessionAt: getLastSmartTrainingAt(),
      lastSessionResult: getLastSmartTrainingResult(),
      ms: Date.now() - t0,
    });
  } catch (err) {
    console.error(
      '[/api/nova/smart-train/plan] failed:',
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
