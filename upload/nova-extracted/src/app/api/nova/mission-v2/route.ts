// POST /api/nova/mission-v2
// ----------------------------------------------------------------------------
// Starts a streaming NOVA pipeline (PM → Architect → Coder → FORGE → QA →
// Security → VAULT) and returns immediately with a `missionId`. The pipeline
// runs in the background (fire-and-forget via Promise.resolve().then(...))
// and emits MissionStreamEvents at every step. The user connects to:
//
//   GET /api/nova/mission-stream/[missionId]
//
// via EventSource to watch the events stream in real-time. No more spinners.
//
// Request body:
//   { mission: string, atlasIntel?: any }
//
// Response (200):
//   { ok: true, missionId, correlationId, streamUrl, status: 'started' }
//
// The pipeline catches its own errors and always emits a `mission.complete`
// event (success or failure), so the SSE stream always terminates cleanly.
//
// NOTE on the race: mission-v2 returns the missionId BEFORE the pipeline
// starts emitting. We use a small setImmediate delay so the response can
// flush first. The SSE endpoint also replays history from the DB, so even
// if the client connects a moment late, it sees all events from seq=0.
import type { NextRequest } from 'next/server';
import { newCorrelationId } from '@/lib/event-bus';
import { newMissionId } from '@/lib/mission-stream';
import { runStreamingPipeline } from '@/lib/nova-streaming-pipeline';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 120;

export async function POST(request: NextRequest): Promise<Response> {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  const mission: string | undefined = body?.mission;
  if (!mission || !mission.trim()) {
    return Response.json({ ok: false, error: 'Missing mission' }, { status: 400 });
  }

  const atlasIntel = body?.atlasIntel;
  const missionId = newMissionId();
  const correlationId = newCorrelationId('nova-v2');

  // Fire-and-forget. The pipeline runs in this same process so its
  // `emitMissionEvent` calls hit `globalThis.__missionSubs` which the SSE
  // endpoint has access to. We use setImmediate so the response below can
  // flush before the first await in the pipeline.
  setImmediate(() => {
    runStreamingPipeline(mission, {
      missionId,
      correlationId,
      atlasIntel,
    }).then((result) => {
      console.log(
        `[nova/mission-v2] pipeline complete · missionId=${missionId} · success=${result.success} · ${result.totalMs}ms`,
      );
    }).catch((err) => {
      // Should never happen — runStreamingPipeline catches its own errors
      // and returns a result with success=false. But just in case:
      console.error(`[nova/mission-v2] pipeline crashed missionId=${missionId}:`, err instanceof Error ? err.message : String(err));
    });
  });

  return Response.json({
    ok: true,
    missionId,
    correlationId,
    streamUrl: `/api/nova/mission-stream/${missionId}`,
    status: 'started',
    instructions: 'Connect an EventSource to streamUrl to receive live MissionStreamEvents.',
  });
}
