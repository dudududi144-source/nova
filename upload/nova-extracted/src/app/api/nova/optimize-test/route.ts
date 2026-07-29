// ============================================================================
// POST /api/nova/optimize-test — SUB-R-PERFORMANCE-QUALITY-TUNING
// ----------------------------------------------------------------------------
// Test endpoint that runs the PARALLEL pipeline (with optimal params +
// caching + token tracking) and returns:
//   - Per-phase timing breakdown
//   - Per-agent token usage
//   - Cache hit/miss counts
//   - Total wall-clock time
//   - The full result (files, agent outputs, forge/arena/vault ids)
//
// Body:
//   { mission: string, rerun?: boolean, resetStats?: boolean }
//
// `rerun=true` forces a second run so you can compare first-run vs cached-run
// timing.
//
// `resetStats=true` resets the token stats before running (clean before/after
// comparison).
//
// Set `maxDuration = 120` to give the LLM calls enough time to complete.
// ============================================================================

import type { NextRequest } from 'next/server';
import { newMissionId } from '@/lib/mission-stream';
import { newCorrelationId } from '@/lib/event-bus';
import {
  runParallelPipeline,
  type ParallelPipelineResult,
} from '@/lib/parallel-pipeline';
import {
  getTokenStats,
  resetTokenStats,
  getCacheStats,
  clearLlmCache,
  OPTIMAL_PARAMS,
  getOptimalParams,
  type TokenStats,
} from '@/lib/llm-optimizer';

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
    return Response.json(
      { ok: false, error: 'Missing "mission" in body' },
      { status: 400 },
    );
  }

  const rerun: boolean = !!body?.rerun;
  const resetStats: boolean = !!body?.resetStats;
  const clearCacheBefore: boolean = !!body?.clearCacheBefore;

  // Optional pre-run state for before/after comparison
  if (resetStats) resetTokenStats();
  const beforeStats: TokenStats = getTokenStats();
  const beforeCache = getCacheStats();

  if (clearCacheBefore) {
    clearLlmCache();
  }

  const missionId = newMissionId('opt');
  const correlationId = newCorrelationId('optimize-test');

  // ── Run #1 (cold or warm depending on cache state) ───────────────────────
  const run1T0 = Date.now();
  const result1: ParallelPipelineResult = await runParallelPipeline(mission, {
    missionId,
    correlationId,
    skipCache: false,
    resetStats,
  });
  const run1WallMs = Date.now() - run1T0;

  // ── Optional Run #2 (cache test) ─────────────────────────────────────────
  // If rerun=true, run the same mission again. The cache should make this
  // dramatically faster (most LLM calls return from cache).
  let run2: ParallelPipelineResult | null = null;
  let run2WallMs = 0;
  if (rerun) {
    const run2T0 = Date.now();
    run2 = await runParallelPipeline(mission, {
      missionId: newMissionId('opt2'),
      correlationId: newCorrelationId('optimize-test-rerun'),
      skipCache: false,
      resetStats: false,
    });
    run2WallMs = Date.now() - run2T0;
  }

  const afterStats = getTokenStats();
  const afterCache = getCacheStats();

  // ── Build the response ───────────────────────────────────────────────────
  const phaseBreakdown = result1.phases.map(p => ({
    phase: p.name,
    description: p.description,
    parallel: p.parallel,
    ms: p.ms,
    items: p.items.map(it => ({
      key: it.key,
      ms: it.ms,
      ok: it.ok,
      cached: it.cached,
      error: it.error,
    })),
  }));

  const sequentialEquivalentMs = result1.phases.reduce(
    (sum, p) => sum + p.items.reduce((s, it) => s + it.ms, 0),
    0,
  );
  const parallelSpeedupMs = sequentialEquivalentMs - result1.durationMs;
  const parallelSpeedupPct = sequentialEquivalentMs > 0
    ? Math.round((parallelSpeedupMs / sequentialEquivalentMs) * 100)
    : 0;

  return Response.json({
    ok: true,
    mission,
    missionId: result1.missionId,
    correlationId: result1.correlationId,

    // ── Timing breakdown ──
    timing: {
      totalWallMs: run1WallMs,
      totalWallSec: Number((run1WallMs / 1000).toFixed(2)),
      sequentialEquivalentMs,
      sequentialEquivalentSec: Number((sequentialEquivalentMs / 1000).toFixed(2)),
      parallelSpeedupMs,
      parallelSpeedupPct,
      phases: phaseBreakdown,
      rerunWallMs: run2WallMs,
      rerunWallSec: Number((run2WallMs / 1000).toFixed(2)),
      rerunSpeedupPct: run2WallMs > 0
        ? Math.round(((run1WallMs - run2WallMs) / run1WallMs) * 100)
        : 0,
    },

    // ── Token usage ──
    tokens: {
      before: beforeStats,
      after: afterStats,
      delta: {
        agents: Object.fromEntries(
          Object.entries(afterStats.agents).map(([k, v]) => {
            const before = beforeStats.agents[k] || { tokens: 0, costUsd: 0, calls: 0 };
            return [k, {
              tokens: v.tokens - before.tokens,
              costUsd: Number((v.costUsd - before.costUsd).toFixed(6)),
              calls: v.calls - before.calls,
            }];
          }),
        ),
        total: {
          tokens: afterStats.total.tokens - beforeStats.total.tokens,
          costUsd: Number((afterStats.total.costUsd - beforeStats.total.costUsd).toFixed(6)),
          calls: afterStats.total.calls - beforeStats.total.calls,
        },
      },
    },

    // ── Cache stats ──
    cache: {
      before: beforeCache,
      after: afterCache,
      hits: result1.cacheHits,
      misses: result1.cacheMisses,
      note: 'Re-run the same mission to see cache hits return instantly.',
    },

    // ── Optimal params reference ──
    optimalParamsUsed: {
      'pm-analysis': getOptimalParams('pm-analysis'),
      'architect-design': getOptimalParams('architect-design'),
      'coder-default': getOptimalParams('coder-default'),
      'qa-strategy': getOptimalParams('qa-strategy'),
      'qa-tests': getOptimalParams('qa-tests'),
      'security-scan': getOptimalParams('security-scan'),
      'release-notes': getOptimalParams('release-notes'),
      'classification': getOptimalParams('classification'),
    },
    optimalParamsCatalog: OPTIMAL_PARAMS,

    // ── Pipeline result (summary) ──
    result: {
      missionId: result1.missionId,
      classification: result1.classification,
      classificationSource: result1.classificationSource,
      isPlayable: result1.isPlayable,
      arenaRuntime: result1.arenaRuntime,
      success: result1.success,
      durationMs: result1.durationMs,
      fileCount: result1.files.length,
      files: result1.files.map(f => ({
        path: f.path,
        language: f.language,
        sizeChars: f.content.length,
        preview: f.content.slice(0, 200) + (f.content.length > 200 ? '...' : ''),
      })),
      agents: Object.fromEntries(
        Object.entries(result1.agents).filter(([, v]) => v).map(([k, v]: [string, any]) => [
          k,
          {
            ok: v.ok,
            degraded: v.degraded,
            provider: v.provider,
            ms: v.ms,
            cached: v.provider?.includes('cached'),
            outputSummary: typeof v.output === 'object' && v.output
              ? Object.keys(v.output).slice(0, 8)
              : null,
            error: v.error,
          },
        ]),
      ),
      forgeProjectId: result1.forgeProjectId,
      arenaSnippetId: result1.arenaSnippetId,
      vaultReleaseId: result1.vaultReleaseId,
      patternCount: result1.patterns.length,
    },

    // ── Optional rerun comparison ──
    rerun: run2
      ? {
          wallMs: run2WallMs,
          wallSec: Number((run2WallMs / 1000).toFixed(2)),
          cacheHits: run2.cacheHits,
          cacheMisses: run2.cacheMisses,
          success: run2.success,
          fileCount: run2.files.length,
        }
      : null,

    // ── Summary verdict ──
    summary: {
      baseline: '60-90s (sequential unified pipeline)',
      achieved: `${(run1WallMs / 1000).toFixed(1)}s (parallel pipeline)`,
      improvement: run2WallMs > 0
        ? `${(run1WallMs / 1000).toFixed(1)}s cold → ${(run2WallMs / 1000).toFixed(1)}s cached`
        : `${(run1WallMs / 1000).toFixed(1)}s (rerun with ?rerun=true to see cache speedup)`,
      faster: run1WallMs < 60000,
      cachedSpeedup: run2WallMs > 0 ? `${Math.round(((run1WallMs - run2WallMs) / run1WallMs) * 100)}%` : null,
    },
  });
}

// GET — returns the optimal params catalog + current cache/token stats
// (no LLM calls; useful for inspection without spending tokens).
export async function GET(): Promise<Response> {
  return Response.json({
    ok: true,
    optimalParams: OPTIMAL_PARAMS,
    cacheStats: getCacheStats(),
    tokenStats: getTokenStats(),
    endpoints: {
      POST: 'Run the parallel pipeline. Body: { mission: string, rerun?: boolean, resetStats?: boolean }',
    },
  });
}
