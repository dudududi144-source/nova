// GET /api/nova/mission-stream/[missionId] — SSE stream of mission events
import type { NextRequest } from 'next/server';
import { subscribeToMission, getMissionEvents, formatMissionSSE } from '@/lib/mission-stream';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ missionId: string }> }
): Promise<Response> {
  const { missionId } = await params;
  if (!missionId) {
    return new Response(JSON.stringify({ error: 'Missing missionId' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const safeEnqueue = (chunk: string) => {
        if (closed) return;
        try { controller.enqueue(encoder.encode(chunk)); } catch { closed = true; }
      };

      // Send initial comment
      safeEnqueue(`: connected mission=${missionId}\n\n`);

      // Send history
      getMissionEvents(missionId).then(events => {
        events.forEach(ev => safeEnqueue(formatMissionSSE(ev)));

        // Subscribe to live events
        const unsub = subscribeToMission(missionId, (event) => {
          safeEnqueue(formatMissionSSE(event));
          if (event.eventType === 'mission.complete' || event.eventType === 'mission.fail') {
            setTimeout(() => {
              safeEnqueue(`: closing\n\n`);
              if (!closed) { try { controller.close(); } catch {} closed = true; }
              unsub();
            }, 1000);
          }
        });
      }).catch(() => {});

      // Heartbeat
      const heartbeat = setInterval(() => {
        safeEnqueue(`: heartbeat ${new Date().toISOString()}\n\n`);
      }, 15000);

      // Cleanup on abort
      request.signal.addEventListener('abort', () => {
        clearInterval(heartbeat);
        closed = true;
        try { controller.close(); } catch {}
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
