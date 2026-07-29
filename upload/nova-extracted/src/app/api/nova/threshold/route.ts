// ============================================================================
// GET /api/nova/threshold
// ----------------------------------------------------------------------------
// SUB-CC-ADAPTIVE-THRESHOLD-IN-MISSION-LEARNING
//
// Returns the current adaptive distillation threshold + the 30-day history
// + the underlying stats (mission count, avg lesson score, distilled count).
//
// This is the read endpoint for the dashboard widget that shows:
//   - "Current distillation bar: 6.0 (bootstrap tier)"
//   - "Missions seen: 80 · Avg quality: 4.8 · Distilled: 0"
//   - A small timeline: how the bar has risen over the past 30 days.
//
// Optional query params:
//   ?bust=1   — invalidate the cache before reading (forces a DB recompute)
//
// Response shape (200 OK):
//   {
//     ok: true,
//     threshold: number,            // 0-10
//     tier: string,                 // bootstrap | warmup | maturing | mature | elite
//     missionCount: number,
//     avgQuality: number,           // 0-10
//     distilledCount: number,
//     cacheTtlMs: number,
//     cachedAt: string | null,      // ISO
//     history: [
//       { at, missionCount, avgQuality, threshold, tier }, ...
//     ],
//     tiers: [                      // human-readable tier table for the UI
//       { name, minMissions, minAvgQuality, threshold, description }
//     ],
//     ms: number                    // total wall-clock time of the request
//   }
// ============================================================================

import { NextRequest, NextResponse } from 'next/server';
import {
  getThresholdStats,
  invalidateThresholdCache,
  ADAPTIVE_THRESHOLD_CONSTANTS as C,
  type ThresholdTier,
} from '@/lib/adaptive-threshold';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 10;

// Human-readable tier table — the UI can render this as a "tier ladder".
const TIERS: {
  name: ThresholdTier;
  minMissions: string;
  minAvgQuality: string;
  threshold: number;
  description: string;
}[] = [
  {
    name: 'bootstrap',
    minMissions: `0 – ${C.TIER_BOOTSTRAP_MISSIONS - 1}`,
    minAvgQuality: '—',
    threshold: C.THRESHOLD_BOOTSTRAP,
    description:
      'System is just starting — bar is low so early distillation builds the library.',
  },
  {
    name: 'warmup',
    minMissions: `${C.TIER_BOOTSTRAP_MISSIONS} – ${C.TIER_WARMUP_MISSIONS - 1}`,
    minAvgQuality: '—',
    threshold: C.THRESHOLD_WARMUP,
    description: 'System has some history — bar rises slightly.',
  },
  {
    name: 'maturing',
    minMissions: `${C.TIER_WARMUP_MISSIONS} – ${C.TIER_MATURE_MISSIONS - 1}`,
    minAvgQuality: '—',
    threshold: C.THRESHOLD_MATURING,
    description: 'System is maturing — moderate bar.',
  },
  {
    name: 'mature',
    minMissions: `${C.TIER_MATURE_MISSIONS}+`,
    minAvgQuality: `≥ ${C.TIER_MATURE_AVG_QUALITY}`,
    threshold: C.THRESHOLD_MATURE,
    description: 'System is mature with good average quality — standard bar.',
  },
  {
    name: 'elite',
    minMissions: `${C.TIER_MATURE_MISSIONS}+`,
    minAvgQuality: `≥ ${C.TIER_ELITE_AVG_QUALITY}`,
    threshold: C.THRESHOLD_ELITE,
    description: 'System is elite — only the very best output gets distilled.',
  },
];

export async function GET(request: NextRequest): Promise<Response> {
  const t0 = Date.now();

  try {
    // Optional cache bust via ?bust=1
    const bust = request.nextUrl.searchParams.get('bust');
    if (bust === '1' || bust === 'true') {
      invalidateThresholdCache();
    }

    const stats = await getThresholdStats();

    return NextResponse.json({
      ok: true,
      threshold: stats.threshold,
      tier: stats.tier,
      missionCount: stats.missionCount,
      avgQuality: Math.round(stats.avgQuality * 100) / 100,
      distilledCount: stats.distilledCount,
      cacheTtlMs: stats.cacheTtlMs,
      cachedAt: stats.cachedAt,
      history: stats.history,
      tiers: TIERS,
      ms: Date.now() - t0,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[/api/nova/threshold] error:', err);
    return NextResponse.json(
      { ok: false, error: msg, ms: Date.now() - t0 },
      { status: 500 },
    );
  }
}
