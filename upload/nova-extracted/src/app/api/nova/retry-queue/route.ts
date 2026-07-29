// GET /api/nova/retry-queue — current retry queue status
// POST /api/nova/retry-queue { action: 'clear' | 'cancel', missionId? } — manage queue
import type { NextRequest } from 'next/server';
import { getQueueSnapshot, clearQueue, dequeue } from '@/lib/retry-queue';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(): Promise<Response> {
  return Response.json({ ok: true, ...getQueueSnapshot() });
}

export async function POST(request: NextRequest): Promise<Response> {
  let body: any;
  try { body = await request.json(); } catch { return Response.json({ ok: false, error: 'Invalid JSON' }, { status: 400 }); }
  const action = body?.action;
  if (action === 'clear') {
    clearQueue();
    return Response.json({ ok: true, cleared: true });
  }
  if (action === 'cancel' && body?.missionId) {
    dequeue(body.missionId);
    return Response.json({ ok: true, cancelled: body.missionId });
  }
  return Response.json({ ok: false, error: 'Unknown action' }, { status: 400 });
}
