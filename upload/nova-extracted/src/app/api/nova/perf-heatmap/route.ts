// GET /api/nova/perf-heatmap — aggregate stage timings across recent builds
// Returns per-stage avg/p50/p90/max duration so the UI can render a heatmap.
// Used by Build Performance Heatmap (JJ).
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface StageTiming {
  stage: string;
  count: number;
  avgMs: number;
  p50Ms: number;
  p90Ms: number;
  maxMs: number;
  totalMs: number;
}

export async function GET(): Promise<Response> {
  try {
    // Pull the last 30 mission.complete events that have stage timings
    // We look at agent.message events that start with "Stage timings:"
    const timingEvents = await db.missionStreamEvent.findMany({
      where: {
        eventType: 'agent.message',
        // SQLite JSON-like substring search via payload
      },
      orderBy: { ts: 'desc' },
      take: 1000, // scan recent events to find ~30 timing messages
      select: { missionId: true, payload: true, ts: true },
    });

    // Parse payloads, extract stage timings
    const stageData: Record<string, number[]> = {}; // stage → list of ms values
    let parsedCount = 0;
    for (const ev of timingEvents) {
      try {
        const payload = typeof ev.payload === 'string' ? JSON.parse(ev.payload) : ev.payload;
        const msg: string = payload?.message || '';
        if (!msg.startsWith('Stage timings:')) continue;
        // Parse "Stage timings: stageA: 1.5s · stageB: 2.3s · total 429 wait: 30s"
        const timings = msg.replace('Stage timings:', '').trim();
        for (const part of timings.split('·')) {
          const trimmed = part.trim();
          // skip "total 429 wait:" prefix annotations
          const match = trimmed.match(/^([\w-]+):\s+([\d.]+)s(?:\s+\(incl\s+([\d.]+)s\s+429 wait\))?/);
          if (match) {
            const stage = match[1];
            const ms = parseFloat(match[2]) * 1000;
            if (!stageData[stage]) stageData[stage] = [];
            stageData[stage].push(ms);
          }
        }
        parsedCount++;
        if (parsedCount >= 30) break; // 30 builds worth of timings is enough
      } catch {}
    }

    const stages: StageTiming[] = [];
    for (const [stage, values] of Object.entries(stageData)) {
      if (values.length === 0) continue;
      values.sort((a, b) => a - b);
      const avg = values.reduce((s, x) => s + x, 0) / values.length;
      const p50 = values[Math.floor(values.length * 0.5)];
      const p90 = values[Math.floor(values.length * 0.9)];
      const max = values[values.length - 1];
      stages.push({
        stage,
        count: values.length,
        avgMs: Math.round(avg),
        p50Ms: Math.round(p50),
        p90Ms: Math.round(p90),
        maxMs: Math.round(max),
        totalMs: Math.round(values.reduce((s, x) => s + x, 0)),
      });
    }
    stages.sort((a, b) => b.avgMs - a.avgMs); // slowest first

    return Response.json({
      ok: true,
      builds: parsedCount,
      stages,
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    return Response.json({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      builds: 0,
      stages: [],
    }, { status: 500 });
  }
}
