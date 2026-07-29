// GET /api/nova/mission-stream/active
// ----------------------------------------------------------------------------
// Returns missions with MissionStreamEvents in the last 5 minutes (in-progress
// or recently completed). Used by the dashboard "Live Missions" list so the
// user can pick a running mission to watch.
//
// Query params:
//   windowMs  numeric — override the 5-minute window (clamped to 1s..1h)
//
// Response:
//   {
//     ok: true,
//     count: number,
//     missions: ActiveMission[],
//     generatedAt: number  // ms
//   }
import type { NextRequest } from 'next/server';
import { getActiveMissions } from '@/lib/mission-stream';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: NextRequest): Promise<Response> {
  const url = new URL(request.url);
  const windowParam = url.searchParams.get('windowMs');
  let windowMs = 5 * 60 * 1000;
  if (windowParam) {
    const n = parseInt(windowParam, 10);
    if (!Number.isNaN(n) && n >= 1000 && n <= 60 * 60 * 1000) windowMs = n;
  }

  const missions = await getActiveMissions(windowMs);

  return Response.json({
    ok: true,
    count: missions.length,
    missions,
    generatedAt: Date.now(),
  });
}
