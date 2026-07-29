// POST /api/nova/benchmark — run a fixed 5-mission benchmark suite to measure engine quality
// Returns aggregated stats: avg quality, avg duration, avg cost, success rate, per-mission results.
// Each mission runs sequentially (to avoid 429 pressure) with the current engine config.
// The user gets a benchmark ID they can compare across engine versions.
import type { NextRequest } from 'next/server';
import { newMissionId, newCorrelationId } from '@/lib/mission-stream';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 600; // 10 minutes — benchmark runs ~5 builds

// Fixed benchmark suite — chosen to cover different difficulty levels
const BENCHMARK_MISSIONS = [
  { id: 'calc', mission: 'Build a calculator with basic arithmetic and history', difficulty: 'easy' },
  { id: 'todo', mission: 'Build a todo app with localStorage and filters', difficulty: 'easy' },
  { id: 'snake', mission: 'Build a snake game with score and levels', difficulty: 'medium' },
  { id: 'markdown', mission: 'Build a markdown to HTML converter with live preview', difficulty: 'medium' },
  { id: 'chess', mission: 'Build a chess game with basic AI opponent', difficulty: 'hard' },
];

export async function POST(request: NextRequest): Promise<Response> {
  let body: any;
  try { body = await request.json(); } catch { body = {}; }
  const qualityTarget = Math.min(9, Math.max(5, Number(body?.qualityTarget) || 7));
  const benchmarkId = 'bm_' + Date.now().toString(36);

  // Run in background — the client polls /api/nova/benchmark/:id for status
  setImmediate(async () => {
    const results: any[] = [];
    let success = 0, totalQ = 0, totalDur = 0, totalCost = 0;
    for (const m of BENCHMARK_MISSIONS) {
      try {
        const { runPipeline } = await import('@/lib/pipeline');
        const missionId = newMissionId('bm');
        const r = await runPipeline(m.mission, { missionId, qualityTarget });
        const q = r.qualityScore || 0;
        const cost = (r as any).tokenUsage?.cost || 0;
        results.push({
          id: m.id, mission: m.mission, difficulty: m.difficulty,
          missionId, success: r.success, quality: q, durationMs: r.durationMs, cost, files: r.files?.length || 0,
        });
        if (r.success) success++;
        totalQ += q; totalDur += r.durationMs; totalCost += cost;
        // Save intermediate status
        activeBenchmarks.set(benchmarkId, {
          id: benchmarkId, qualityTarget, startedAt: Date.now(),
          total: BENCHMARK_MISSIONS.length, completed: results.length,
          results, success, avgQuality: results.length ? totalQ / results.length : 0,
          avgDurationMs: results.length ? totalDur / results.length : 0,
          avgCost: results.length ? totalCost / results.length : 0,
          status: 'running',
        });
      } catch (err: any) {
        results.push({ id: m.id, mission: m.mission, difficulty: m.difficulty, error: String(err.message || err) });
        activeBenchmarks.set(benchmarkId, {
          id: benchmarkId, qualityTarget, startedAt: Date.now(),
          total: BENCHMARK_MISSIONS.length, completed: results.length,
          results, success, avgQuality: results.length ? totalQ / results.length : 0,
          avgDurationMs: results.length ? totalDur / results.length : 0,
          avgCost: results.length ? totalCost / results.length : 0,
          status: 'running',
        });
      }
    }
    // Final
    const cur = activeBenchmarks.get(benchmarkId);
    if (cur) {
      cur.status = 'complete';
      cur.completedAt = Date.now();
    }
    console.log(`[benchmark] ${benchmarkId} done: ${success}/${BENCHMARK_MISSIONS.length} success, avg q ${results.length ? (totalQ / results.length).toFixed(2) : 0}/10`);
  });

  // Return immediately with the benchmark ID for polling
  activeBenchmarks.set(benchmarkId, {
    id: benchmarkId, qualityTarget, startedAt: Date.now(),
    total: BENCHMARK_MISSIONS.length, completed: 0,
    results: [], success: 0, avgQuality: 0, avgDurationMs: 0, avgCost: 0,
    status: 'running',
  });

  return Response.json({
    ok: true, benchmarkId,
    total: BENCHMARK_MISSIONS.length,
    missions: BENCHMARK_MISSIONS.map(m => ({ id: m.id, mission: m.mission, difficulty: m.difficulty })),
    pollUrl: `/api/nova/benchmark?id=${benchmarkId}`,
  });
}

// ── GET ?id=BM_ID — poll benchmark status ──
export async function GET(request: NextRequest): Promise<Response> {
  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  if (!id) return Response.json({ ok: false, error: 'Missing id' }, { status: 400 });
  const bm = activeBenchmarks.get(id);
  if (!bm) return Response.json({ ok: false, error: 'Unknown benchmark' }, { status: 404 });
  return Response.json({ ok: true, benchmark: bm });
}

// In-memory benchmark tracker (cleared on server restart)
const activeBenchmarks = new Map<string, any>();
