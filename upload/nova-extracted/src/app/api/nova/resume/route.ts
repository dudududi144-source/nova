// POST /api/nova/resume — resume a crashed build from last checkpoint
import type { NextRequest } from 'next/server';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: NextRequest): Promise<Response> {
  let body: any;
  try { body = await request.json(); } catch {
    return Response.json({ ok: false, error: 'Invalid JSON' }, { status: 400 });
  }

  const missionId: string | undefined = body?.missionId;
  if (!missionId) {
    return Response.json({ ok: false, error: 'Missing missionId' }, { status: 400 });
  }

  try {
    const checkpoint = await db.buildCheckpoint.findUnique({ where: { missionId } });
    if (!checkpoint) {
      return Response.json({ ok: false, error: 'No checkpoint found' }, { status: 404 });
    }

    const files = JSON.parse(checkpoint.filesJson || '[]');
    const analysis = JSON.parse(checkpoint.analysisJson || '{}');

    return Response.json({
      ok: true,
      checkpoint: {
        missionId: checkpoint.missionId,
        mission: checkpoint.mission,
        stage: checkpoint.stage,
        files,
        analysis,
        qualityScore: checkpoint.qualityScore,
        totalTokens: checkpoint.totalTokens,
        totalCost: checkpoint.totalCost,
        status: checkpoint.status,
      },
    });
  } catch (err) {
    return Response.json({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    }, { status: 500 });
  }
}
