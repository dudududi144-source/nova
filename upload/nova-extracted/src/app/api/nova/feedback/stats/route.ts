// ============================================================================
// GET /api/nova/feedback/stats — User feedback aggregate stats dashboard
// ----------------------------------------------------------------------------
// SUB-BB-USER-FEEDBACK-LOOP
//
// Returns the aggregate stats payload computed from all UserFeedback rows:
//   - totalFeedback: total rows
//   - avgRating: 1-5 stars
//   - avgAdjustedQuality: 0-10
//   - ratingDistribution: { '1': n, '2': n, ... '5': n }
//   - byType: per-mission-type breakdown (count, avgRating, avgAdjustedQuality)
//   - earlyAvg / recentAvg / recentTrend: first-5 vs last-5 ratings
//   - topComplaints: keyword frequency in low-rated (≤2★) feedback
//   - topPraise: keyword frequency in high-rated (≥4★) feedback
//   - distinctMissions: distinct missions that received feedback
//
// Query params: none (everything is computed in-process for simplicity).
//
// Response shape:
//   {
//     ok: true,
//     stats: FeedbackStats,
//     ms: number
//   }
//
// Initial state: totalFeedback=0, all averages 0, all distributions 0, empty
// arrays for byType / topComplaints / topPraise. This is the expected
// initial response before the user has rated any missions.
// ============================================================================

import type { NextRequest } from 'next/server';
import { getFeedbackStats } from '@/lib/user-feedback';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 15;

export async function GET(_request: NextRequest): Promise<Response> {
  const t0 = Date.now();
  try {
    const stats = await getFeedbackStats();
    return Response.json({
      ok: true,
      stats,
      ms: Date.now() - t0,
    });
  } catch (err) {
    console.error(
      '[/api/nova/feedback/stats] failed:',
      err instanceof Error ? err.message : String(err),
    );
    return Response.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        ms: Date.now() - t0,
      },
      { status: 500 },
    );
  }
}
