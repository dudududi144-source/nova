// POST /api/nova/train
// ─────────────────────────────────────────────────────────────────────────────
// SUB-X-TRAINING-ENGINE — Proactive practice when AI is available.
//
// The user asked: "How can the system learn to improve and use AI when
// available to train itself?" This is the answer: a background Training
// Engine that runs practice missions when the system is idle AND the LLM
// is available (not 429), evaluates the output, and saves the BEST
// examples as TrainingExamples for future fallback distillation.
//
// Body:
//   {
//     maxMissions?: number,           // default 3, max 10
//     autoStart?: boolean,            // if true, starts the auto-training
//                                     // interval (default 30 min)
//     intervalMinutes?: number,       // auto-training interval (default 30)
//   }
//
// Behavior:
//   - If autoStart=true:  starts auto-training and returns
//                          { autoStarted: true, intervalMs }
//   - Otherwise:          runs a single training session synchronously
//                          (maxMissions) and returns the full result.
//
// The single-session path takes up to 5 minutes — we set maxDuration=300.
// ─────────────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server';
import {
  runTrainingSession,
  startAutoTraining,
  stopAutoTraining,
  getAutoTrainingState,
} from '@/lib/training-engine';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300; // training takes time — allow 5 minutes

const DEFAULT_MAX_MISSIONS = 3;
const DEFAULT_INTERVAL_MIN = 30;
const MIN_INTERVAL_MIN = 5;
const MAX_INTERVAL_MIN = 1440; // 24h

export async function POST(request: NextRequest): Promise<Response> {
  const t0 = Date.now();
  try {
    const body = await request.json().catch(() => ({}));
    const maxMissionsRaw = typeof body?.maxMissions === 'number' ? body.maxMissions : DEFAULT_MAX_MISSIONS;
    const maxMissions = Math.max(1, Math.min(10, Math.floor(maxMissionsRaw)));
    const autoStart = body?.autoStart === true;
    const autoStop = body?.autoStop === true;
    const intervalMinutesRaw = typeof body?.intervalMinutes === 'number' ? body.intervalMinutes : DEFAULT_INTERVAL_MIN;
    const intervalMinutes = Math.max(MIN_INTERVAL_MIN, Math.min(MAX_INTERVAL_MIN, intervalMinutesRaw));
    const intervalMs = intervalMinutes * 60 * 1000;

    // ── Auto-stop path ──
    if (autoStop) {
      const stopResult = stopAutoTraining();
      return NextResponse.json({
        autoStopped: stopResult.stopped,
        wasRunning: stopResult.wasRunning,
        state: getAutoTrainingState(),
        totalMs: Date.now() - t0,
      });
    }

    // ── Auto-start path ──
    if (autoStart) {
      const startResult = startAutoTraining(intervalMs);
      return NextResponse.json({
        autoStarted: startResult.started,
        alreadyRunning: startResult.alreadyRunning,
        intervalMs: startResult.intervalMs,
        intervalMinutes: startResult.intervalMs / 60000,
        state: getAutoTrainingState(),
        totalMs: Date.now() - t0,
      });
    }

    // ── Single-session path (synchronous) ──
    const result = await runTrainingSession({
      maxMissions,
      onProgress: (event) => {
        // Lightweight server-side log — no streaming back to client in this route.
        if (event.mission) {
          console.log(`[TrainingEngine] [${event.phase}] ${event.mission}${event.detail ? ' — ' + event.detail : ''}`);
        } else if (event.detail) {
          console.log(`[TrainingEngine] [${event.phase}] ${event.detail}`);
        }
      },
    });

    return NextResponse.json({
      ...result,
      state: getAutoTrainingState(),
      totalMs: Date.now() - t0,
    });
  } catch (err) {
    return NextResponse.json(
      {
        trained: false,
        reason: 'error',
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
        totalMs: Date.now() - t0,
      },
      { status: 500 },
    );
  }
}

// GET — quick usage hint + current state
export async function GET(): Promise<Response> {
  return NextResponse.json({
    usage: 'POST { maxMissions?: number (1-10, default 3), autoStart?: boolean, intervalMinutes?: number (5-1440, default 30), autoStop?: boolean }',
    examples: [
      { maxMissions: 1 }, // run a single training mission synchronously
      { maxMissions: 3 }, // run up to 3 missions (default)
      { autoStart: true, intervalMinutes: 30 }, // start background auto-training every 30 min
      { autoStop: true }, // stop background auto-training
    ],
    behavior: {
      noAutoStart: 'Runs a single synchronous training session (up to maxMissions). Returns the full result. Max 5 min.',
      autoStart: 'Starts background auto-training. Returns immediately with { autoStarted: true, intervalMs }. The interval only fires when LLM is available AND system is idle.',
      autoStop: 'Stops background auto-training.',
    },
    state: getAutoTrainingState(),
    note: 'The training engine only runs when (a) the LLM is available (not 429) and (b) the system is idle (no in-progress missions). It saves high-quality outputs as TrainingExamples for future fallback distillation.',
  });
}
