// ============================================================================
// POST /api/nova/unified-mission — SUB-L-ADAPTIVE-CODER-UNIFIED-PIPELINE
// ----------------------------------------------------------------------------
// The endpoint that drives the Unified LLM Pipeline — the fix for the user's
// complaint "I wrote something else, it still made a snake game."
//
// Body:
//   {
//     mission: string,        // required — what the user wants built
//     atlasIntel?: any,       // optional — pre-fetched ATLAS intel
//     stream?: boolean        // default false
//   }
//
// If stream=true:
//   - Starts the pipeline in the background (fire-and-forget).
//   - Returns { missionId, status: 'started', streamUrl } immediately.
//   - User connects to /api/nova/mission-stream/[missionId] for live events.
//
// If stream=false (default):
//   - Runs synchronously and returns the full UnifiedPipelineResult.
//   - maxDuration=120 — the pipeline takes ~30-60s end-to-end with real LLM.
// ============================================================================

import type { NextRequest } from 'next/server';
import { newCorrelationId } from '@/lib/event-bus';
import { newMissionId } from '@/lib/mission-stream';
import { runUnifiedPipeline } from '@/lib/unified-llm-pipeline';

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
  const stream: boolean = !!body?.stream;
  const missionId = newMissionId('um');
  const correlationId = newCorrelationId('unified-mission');

  if (stream) {
    // Fire-and-forget — return immediately so the user can connect to SSE
    setImmediate(() => {
      runUnifiedPipeline(mission, {
        missionId,
        correlationId,
        atlasIntel,
      }).then((result) => {
        console.log(
          `[unified-mission] stream pipeline complete · missionId=${missionId} · success=${result.success} · type=${result.classification.type} · format=${result.classification.deliveryFormat} · ${result.durationMs}ms`,
        );
      }).catch((err) => {
        console.error(
          `[unified-mission] stream pipeline crashed missionId=${missionId}:`,
          err instanceof Error ? err.message : String(err),
        );
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

  // Synchronous mode — run the pipeline and return the full result
  try {
    const result = await runUnifiedPipeline(mission, {
      missionId,
      correlationId,
      atlasIntel,
    });
    return Response.json({
      ok: result.success,
      result,
    });
  } catch (err) {
    console.error('[unified-mission] synchronous pipeline crashed:', err instanceof Error ? err.message : String(err));
    return Response.json({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      missionId,
      correlationId,
    }, { status: 500 });
  }
}
