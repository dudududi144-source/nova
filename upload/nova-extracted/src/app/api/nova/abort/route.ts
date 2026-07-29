// POST /api/nova/abort — abort a running pipeline
import type { NextRequest } from 'next/server';
import { abortMission } from '@/lib/abort-manager';

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

  abortMission(missionId);
  return Response.json({ ok: true, message: 'Abort signal sent' });
}
