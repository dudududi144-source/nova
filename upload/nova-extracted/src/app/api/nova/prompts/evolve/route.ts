// ============================================================================
// POST /api/nova/prompts/evolve — Run prompt evolution analysis
// ----------------------------------------------------------------------------
// SUB-Y-PROMPT-EVOLUTION
//
// Triggers the conservative evolution across all 6 agents (pm, architect,
// coder, qa, sec, rel). Returns the BEST prompt for each agent + aggregate
// stats. "Best" is defined by the conservative rule:
//   - need ≥ 5 samples per variant
//   - non-default must beat default by > 0.5 quality points
//   - default wins ties and insufficient-data cases
//
// Body (all optional):
//   {
//     record?: {                 // optional: record a prompt result before evolving
//       agentId:      string,
//       variantId:    string,
//       mission:      string,
//       qualityScore: number,   // 0-10
//       tokensUsed?:  number,
//       durationMs?:  number,
//       success?:     boolean
//     }
//   }
//
// Response shape:
//   {
//     ok: true,
//     evolved: string[],           // agent IDs where a non-default variant won
//     kept: string[],              // agent IDs where default was kept
//     perAgent: BestVariantResult[],
//     stats: EvolutionStats,
//     ms: number
//   }
//
// On insufficient data: returns evolved: [] with per-agent reasons like
// "Insufficient data: default has 2/5 samples." This is NOT an error —
// it's the expected initial state. The dashboard shows these reasons.
// ============================================================================

import type { NextRequest } from 'next/server';
import {
  evolveAllPrompts,
  recordPromptResult,
  type PromptResultInput,
} from '@/lib/prompt-evolution';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

interface EvolveBody {
  record?: PromptResultInput;
}

export async function POST(request: NextRequest): Promise<Response> {
  const t0 = Date.now();
  try {
    const body = (await request.json().catch(() => ({}))) as EvolveBody;

    // Optional: record a prompt result before running evolution.
    // Useful for the pipeline: after a mission completes, it can call this
    // endpoint with the quality score, and immediately get the new best
    // prompts back in the same response.
    let recorded: { ok: boolean; id?: string; error?: string } | null = null;
    if (body.record && body.record.agentId && body.record.variantId && body.record.mission !== undefined) {
      recorded = await recordPromptResult(body.record);
    }

    const result = await evolveAllPrompts();

    return Response.json({
      ok: true,
      recorded: recorded ?? undefined,
      evolved: result.evolved,
      kept: result.kept,
      perAgent: result.perAgent,
      stats: result.stats,
      ms: Date.now() - t0,
    });
  } catch (err) {
    console.error(
      '[/api/nova/prompts/evolve] failed:',
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

// GET on the evolve endpoint — returns metadata for discovery
export async function GET(): Promise<Response> {
  return Response.json({
    ok: true,
    endpoint: '/api/nova/prompts/evolve',
    method: 'POST',
    description:
      'Trigger conservative prompt evolution across all 6 agents. Returns the ' +
      'best prompt per agent + aggregate stats. The evolution is conservative: ' +
      'default wins unless a challenger beats it by >0.5 quality points with ' +
      '≥5 samples each.',
    bodyShape: {
      record:
        '{ agentId, variantId, mission, qualityScore (0-10), tokensUsed?, durationMs?, success? } — optional. When present, records the result before evolving.',
    },
    responseShape: {
      ok: 'boolean',
      recorded: '{ ok, id?, error? }? — present only when body.record was provided',
      evolved: 'string[] — agent IDs where a non-default variant won (e.g. "coder→defensive")',
      kept: 'string[] — agent IDs where default was kept',
      perAgent: 'BestVariantResult[] — one per agent with winner, reason, all variants',
      stats: 'EvolutionStats — total samples, byAgent, improvementPct, recommendations',
      ms: 'number — wall-clock time',
    },
    conservativeRules: {
      minSamples: 5,
      winMargin: 0.5,
      tiesGoTo: 'default',
    },
  });
}
