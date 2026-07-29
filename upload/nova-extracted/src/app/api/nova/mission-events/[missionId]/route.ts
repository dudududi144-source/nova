// GET /api/nova/mission-events/[missionId]?since=SEQ — polling endpoint for mission events
// ?all=1 — return ALL events (no take:100 limit) — used by Build Replay feature
import type { NextRequest } from 'next/server';
import { getMissionEvents, getAllMissionEvents } from '@/lib/mission-stream';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ missionId: string }> }
): Promise<Response> {
  const { missionId } = await params;
  if (!missionId) {
    return Response.json({ error: 'Missing missionId' }, { status: 400 });
  }

  const url = new URL(request.url);
  const since = parseInt(url.searchParams.get('since') || '0', 10);
  const all = url.searchParams.get('all') === '1';

  try {
    const events = all ? await getAllMissionEvents(missionId) : await getMissionEvents(missionId, since || undefined);
    return Response.json({
      ok: true,
      events,
      count: events.length,
    });
  } catch (e) {
    return Response.json({
      ok: true,
      events: [],
      count: 0,
      error: String(e),
    });
  }
}
