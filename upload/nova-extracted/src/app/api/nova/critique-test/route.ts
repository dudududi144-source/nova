// POST /api/nova/critique-test
// ─────────────────────────────────────────────────────────────────────────────
// SUB-Q-SELF-CRITIQUE-PEER-REVIEW
//
// Runs a SINGLE agent (PM) TWICE for the same mission:
//   1. WITHOUT self-critique  — the "ship it as-is" baseline.
//   2. WITH self-critique + peer review — the polished version.
//
// Returns BOTH outputs side-by-side so the caller can SEE the quality
// improvement: the original (simple) vs the revised (richer, more edge cases,
// more test cases, fewer gaps).
//
// Request body:
//   { mission: string, maxRevisions?: number }
//
// Response:
//   {
//     mission: string,
//     baseline: {                          ← PM without critique
//       output: <PM JSON>,
//       ms, tokensUsed, provider, ok
//     },
//     critiqued: {                         ← PM with self-critique + peer review
//       originalOutput: <PM JSON v1>,
//       finalOutput: <PM JSON final>,
//       revisions: RevisionTrailEntry[],
//       originalQuality: number,           ← self-critique score of v1
//       finalQuality: number,              ← self-critique score of final
//       revised: boolean,
//       revisionCount: number,
//       finalSelfCritique: CritiqueResult,
//       finalPeerReview: PeerReviewResult,
//       totalLlmCalls, totalTokensUsed, totalMs,
//       aborted, abortReason
//     },
//     comparison: {
//       qualityDelta: number,              ← finalQuality - originalQuality
//       outputCharDelta: number,           ← chars(final) - chars(original)
//       issuesFoundCount: number,          ← total issues across all critiques
//       peerApproval: 'approve' | 'request-changes' | 'reject',
//       improvementSummary: string         ← human-readable one-liner
//     },
//     totalMs: number
//   }
// ─────────────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server';
import { runPM, type AgentContext } from '@/lib/nova-llm-agents';
import {
  runAgentWithCritique,
  type CritiqueLoopResult,
} from '@/lib/agent-self-critique';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 120;

interface BaselineResult {
  output: any;
  ms: number;
  tokensUsed: number;
  provider: string;
  ok: boolean;
  degraded: boolean;
  agentName: string;
}

interface ComparisonSummary {
  qualityDelta: number;
  outputCharDelta: number;
  issuesFoundCount: number;
  peerApproval: 'approve' | 'request-changes' | 'reject' | 'unknown';
  improvementSummary: string;
}

interface ResponseShape {
  mission: string;
  baseline: BaselineResult;
  critiqued: CritiqueLoopResult;
  comparison: ComparisonSummary;
  totalMs: number;
}

function buildImprovementSummary(
  baseline: BaselineResult,
  critiqued: CritiqueLoopResult,
): string {
  const parts: string[] = [];

  const qDelta = critiqued.finalQuality - critiqued.originalQuality;
  if (qDelta > 0) {
    parts.push(`quality ${critiqued.originalQuality}→${critiqued.finalQuality} (+${qDelta})`);
  } else if (qDelta < 0) {
    parts.push(`quality ${critiqued.originalQuality}→${critiqued.finalQuality} (${qDelta})`);
  } else {
    parts.push(`quality held at ${critiqued.finalQuality}/10`);
  }

  if (critiqued.revisionCount > 0) {
    parts.push(`${critiqued.revisionCount} revision${critiqued.revisionCount > 1 ? 's' : ''}`);
  }

  const baseChars = JSON.stringify(baseline.output || '').length;
  const finalChars = JSON.stringify(critiqued.finalOutput || '').length;
  if (finalChars > baseChars) {
    parts.push(`output grew ${baseChars}→${finalChars} chars (+${finalChars - baseChars})`);
  } else if (finalChars < baseChars) {
    parts.push(`output shrank ${baseChars}→${finalChars} chars`);
  }

  const peerApproval = critiqued.finalPeerReview?.approval;
  if (peerApproval) {
    parts.push(`peer ${peerApproval}`);
  }

  if (critiqued.aborted) {
    parts.push(`ABORTED: ${critiqued.abortReason}`);
  }

  return parts.join(' · ') || 'no measurable change';
}

export async function POST(request: NextRequest): Promise<Response> {
  const t0 = Date.now();

  try {
    const body = await request.json().catch(() => ({}));
    const mission = String(body?.mission || '').trim();
    const maxRevisionsRaw = Number(body?.maxRevisions ?? 2);

    if (!mission) {
      return NextResponse.json(
        { error: 'Missing "mission" field in request body.' },
        { status: 400 },
      );
    }

    const maxRevisions = Math.max(0, Math.min(3, Math.floor(maxRevisionsRaw)));

    // ── 1. Baseline: run PM WITHOUT critique ────────────────────────────
    const context: AgentContext = {};
    const baselinePm = await runPM(mission, context);

    const baseline: BaselineResult = {
      output: baselinePm.output,
      ms: baselinePm.ms,
      tokensUsed: baselinePm.tokensUsed,
      provider: baselinePm.provider,
      ok: baselinePm.ok,
      degraded: baselinePm.degraded,
      agentName: baselinePm.agentName,
    };

    // ── 2. Critiqued: run PM WITH self-critique + peer review ────────────
    const critiqued: CritiqueLoopResult = await runAgentWithCritique(
      'pm',
      mission,
      context,
      { maxRevisions },
    );

    // ── 3. Build the comparison summary ──────────────────────────────────
    const baseChars = JSON.stringify(baseline.output || '').length;
    const finalChars = JSON.stringify(critiqued.finalOutput || '').length;
    const issuesFoundCount =
      (critiqued.finalSelfCritique?.issues?.length ?? 0) +
      (critiqued.finalPeerReview?.issues?.length ?? 0) +
      critiqued.revisions.reduce(
        (sum, r) => sum + (r.issuesAddressed?.length ?? 0),
        0,
      );

    const peerApproval: ComparisonSummary['peerApproval'] =
      critiqued.finalPeerReview?.approval ?? 'unknown';

    const comparison: ComparisonSummary = {
      qualityDelta: critiqued.finalQuality - critiqued.originalQuality,
      outputCharDelta: finalChars - baseChars,
      issuesFoundCount,
      peerApproval,
      improvementSummary: buildImprovementSummary(baseline, critiqued),
    };

    const response: ResponseShape = {
      mission,
      baseline,
      critiqued,
      comparison,
      totalMs: Date.now() - t0,
    };

    return NextResponse.json(response, { status: 200 });
  } catch (err) {
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
        totalMs: Date.now() - t0,
      },
      { status: 500 },
    );
  }
}

// GET — quick usage hint
export async function GET(): Promise<Response> {
  return NextResponse.json({
    usage: 'POST { mission: string, maxRevisions?: number }',
    example: {
      mission: 'build a snake game',
      maxRevisions: 2,
    },
    description:
      'Runs the PM agent TWICE for the same mission — once WITHOUT self-critique (baseline) and once WITH self-critique + peer review. Returns both outputs side-by-side plus a comparison summary so you can SEE the quality improvement from the critique loop.',
    returns: {
      baseline: 'PM output without critique (the "ship it as-is" version)',
      critiqued: 'PM output with self-critique + peer review (the polished version)',
      comparison: {
        qualityDelta: 'finalQuality - originalQuality (positive = critique helped)',
        outputCharDelta: 'chars(final) - chars(baseline) (positive = richer output)',
        issuesFoundCount: 'total issues surfaced by critique + peer review',
        peerApproval: 'final verdict from the peer reviewer',
        improvementSummary: 'human-readable one-liner',
      },
    },
  });
}
