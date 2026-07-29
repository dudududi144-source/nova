// ============================================================================
// POST /api/nova/smart-train — Targeted (smart) training session
// ----------------------------------------------------------------------------
// SUB-EE-SMART-TRAINING-SCHEDULER
//
// THE PROBLEM THIS SOLVES
// ───────────────────────
// The dumb Training Engine (SUB-X, POST /api/nova/train) runs missions in
// curriculum order — un-trained first, then lowest-quality. It has no idea
// what the system is actually BAD at, so it might train snake-game 5 times
// while algorithm missions average 4.7/10.
//
// This endpoint is the SMART counterpart. It:
//   1. Reads the self-assessment to find the WEAKEST type + WEAKEST dimension.
//   2. Picks a curriculum mission that targets BOTH.
//   3. Injects concrete focus areas into the PM/Coder prompts (e.g.
//      "Input validation: every function must validate inputs").
//   4. Runs the master pipeline with all intelligence layers.
//   5. Saves high-quality output as a TrainingExample for future distillation.
//   6. Records failure lessons when quality < 7.0.
//   7. Returns before/after effectiveness comparison.
//
// BODY:
//   {
//     maxMissions?: number,   // default 3, max 5, min 1
//     dryRun?: boolean,       // default false
//                              // true  → return the training plan WITHOUT executing
//                              // false → execute the session synchronously (max 5 min)
//   }
//
// RESPONSE (dryRun=true):
//   {
//     ok: true,
//     dryRun: true,
//     plan: TrainingPlanResult,           // single next plan
//     schedule: TrainingPlan[],           // up to maxMissions upcoming plans
//     llmAvailable: boolean,
//     ms: number
//   }
//
// RESPONSE (dryRun=false):
//   {
//     ok: true,
//     dryRun: false,
//     result: SmartTrainingResult,        // full session summary
//     ms: number
//   }
//
// The session can take up to 5 minutes — maxDuration = 300.
// ============================================================================

import type { NextRequest } from 'next/server';
import {
  planTrainingSession,
  getTrainingSchedule,
  executeSmartTraining,
  isSmartTrainingRunning,
} from '@/lib/smart-scheduler';
import { isRateLimited } from '@/lib/llm-resilience';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300; // smart training can run up to 5 missions × ~60s each

const DEFAULT_MAX_MISSIONS = 3;
const HARD_MAX_MISSIONS = 5;

interface SmartTrainBody {
  maxMissions?: number;
  dryRun?: boolean;
}

export async function POST(request: NextRequest): Promise<Response> {
  const t0 = Date.now();
  try {
    const body = (await request.json().catch(() => ({}))) as SmartTrainBody;
    const maxMissionsRaw = typeof body?.maxMissions === 'number' ? body.maxMissions : DEFAULT_MAX_MISSIONS;
    const maxMissions = Math.max(1, Math.min(HARD_MAX_MISSIONS, Math.floor(maxMissionsRaw)));
    const dryRun = body?.dryRun === true;

    // ── Dry-run path: return the plan without executing ──
    if (dryRun) {
      const [planResult, schedule] = await Promise.all([
        planTrainingSession(),
        getTrainingSchedule(maxMissions),
      ]);

      return Response.json({
        ok: true,
        dryRun: true,
        plan: planResult,
        schedule,
        llmAvailable: !isRateLimited(),
        rateLimited: isRateLimited(),
        alreadyRunning: isSmartTrainingRunning(),
        ms: Date.now() - t0,
      });
    }

    // ── Execute path: run the smart training session synchronously ──
    if (isSmartTrainingRunning()) {
      return Response.json(
        {
          ok: false,
          error: 'A smart training session is already running. Try again in a few minutes.',
          alreadyRunning: true,
          ms: Date.now() - t0,
        },
        { status: 409 },
      );
    }

    const result = await executeSmartTraining(maxMissions);

    return Response.json({
      ok: true,
      dryRun: false,
      result,
      ms: Date.now() - t0,
    });
  } catch (err) {
    console.error(
      '[/api/nova/smart-train] failed:',
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

// GET — usage hint + current state
export async function GET(): Promise<Response> {
  return Response.json({
    endpoint: '/api/nova/smart-train',
    method: 'POST',
    description:
      'Run a SMART training session. Reads the self-assessment, finds the weakest type ' +
      '+ weakest dimension, picks a curriculum mission that targets both, injects focus ' +
      'areas into the PM/Coder prompts, runs the master pipeline, and saves high-quality ' +
      'output as a TrainingExample.',
    bodyShape: {
      maxMissions: 'number? (default 3, max 5, min 1) — number of missions to run',
      dryRun: 'boolean? (default false) — if true, returns the plan WITHOUT executing',
    },
    responseShape: {
      dryRun_true: {
        ok: 'boolean',
        dryRun: 'true',
        plan: 'TrainingPlanResult — single next plan (planned: false on llm-unavailable or no-training-needed)',
        schedule: 'TrainingPlan[] — up to maxMissions upcoming plans, ordered by priority',
        llmAvailable: 'boolean',
        rateLimited: 'boolean',
        ms: 'number',
      },
      dryRun_false: {
        ok: 'boolean',
        dryRun: 'false',
        result: 'SmartTrainingResult — full session summary with missionsRun, results, avgQuality, improvementDetected, effectiveness',
        ms: 'number',
      },
    },
    examples: [
      { dryRun: true }, // see the plan without running
      { dryRun: false, maxMissions: 1 }, // run 1 targeted mission
      { dryRun: false, maxMissions: 3 }, // run up to 3 (default)
    ],
    relatedEndpoints: {
      plan: 'GET /api/nova/smart-train/plan — current training plan',
      assess: 'GET /api/nova/assess — full self-assessment',
      train: 'POST /api/nova/train — dumb (sequential) training',
    },
    state: {
      llmAvailable: !isRateLimited(),
      rateLimited: isRateLimited(),
      alreadyRunning: isSmartTrainingRunning(),
    },
  });
}
