// POST /api/nova/enhanced-mission — Enhanced pipeline with all quality improvements
import type { NextRequest } from 'next/server';
import { newCorrelationId } from '@/lib/event-bus';
import { newMissionId } from '@/lib/mission-stream';
import { runEnhancedPipeline } from '@/lib/enhanced-unified-pipeline';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

export async function POST(request: NextRequest): Promise<Response> {
  let body: any;
  try { body = await request.json(); } catch { return Response.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 }); }

  const mission: string | undefined = body?.mission;
  if (!mission || !mission.trim()) return Response.json({ ok: false, error: 'Missing mission' }, { status: 400 });

  const stream: boolean = !!body?.stream;
  const missionId = newMissionId('em');
  const correlationId = newCorrelationId('enhanced-mission');

  const enhanceOpts = {
    atlasIntel: body?.atlasIntel,
    missionId,
    correlationId,
    enableCritique: body?.enableCritique !== false,
    enableMultiFile: body?.enableMultiFile !== false,
    enableRefinement: body?.enableRefinement !== false,
    maxIterations: body?.maxIterations || 3,
  };

  if (stream) {
    setImmediate(() => {
      runEnhancedPipeline(mission, enhanceOpts).then((r) => {
        console.log(`[enhanced-mission] ${missionId} success=${r.success} files=${r.files.length} ${r.durationMs}ms`);
      }).catch((e) => console.error(`[enhanced-mission] ${missionId} crashed:`, e));
    });
    return Response.json({ ok: true, missionId, correlationId, streamUrl: `/api/nova/mission-stream/${missionId}`, status: 'started', pipeline: 'enhanced-unified' });
  }

  try {
    const result = await runEnhancedPipeline(mission, enhanceOpts);
    return Response.json({ ok: result.success, result });
  } catch (err) {
    return Response.json({ ok: false, error: err instanceof Error ? err.message : String(err), missionId, correlationId }, { status: 500 });
  }
}
