// ============================================================================
// POST /api/nova/validate — Independent Quality Validation Endpoint
// ----------------------------------------------------------------------------
// SUB-U-QUALITY-VALIDATOR
//
// Two modes:
//
//   MODE 1 — "validate my files":
//     Body: { mission, files: [{path, content}], classification?, agentOutputs? }
//     Validates the provided files on 8 dimensions and returns the report.
//     Does NOT run the pipeline. Fast (1 LLM call, ~5-10s).
//
//   MODE 2 — "run pipeline + validate + regenerate":
//     Body: { mission, maxRegenerations?, threshold?, ... }
//     Runs the full enhanced pipeline with a quality gate:
//       - Run enhanced pipeline (PM → Architect → Coder → QA → Sec → Release)
//       - Validate output on 8 dimensions
//       - If below threshold: regenerate with feedback (up to 2x)
//       - Returns best result + final quality report + history
//     Slow (3 attempts × ~60s each = up to 3 minutes). maxDuration=180.
//
// Response shape (both modes):
//   {
//     ok: true,
//     mode: 'validate-only' | 'quality-gated-pipeline',
//     report: QualityReport,        // 8 dimensions, overall, passed, feedback
//     result?: EnhancedPipelineResult,  // only in mode 2
//     history?: QualityReport[],    // only in mode 2 (per-attempt reports)
//     regenerationCount: number,    // 0 in mode 1
//     trend: [{attempt, overall, passed, ...}],
//     improvementDelta: number,     // 0 in mode 1
//     totalMs: number
//   }
//
// GET /api/nova/validate → info endpoint (no body needed)
// ============================================================================

import type { NextRequest } from 'next/server';
import {
  runWithQualityGate,
  validateFiles,
  type QualityGatedOptions,
} from '@/lib/quality-gated-pipeline';
import type { ValidationOptions } from '@/lib/quality-validator';
import { QUALITY_DIMENSIONS } from '@/lib/quality-validator';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
// Mode 2 can run the full pipeline up to 3 times (1 initial + 2 regen).
// Each attempt is ~60s (PM 5s + Architect 8s + Coder 30s + QA 15s = ~60s).
// 3 × 60s = 180s. The validator itself is ~10s per attempt.
// 180s gives us exactly enough room for the worst case.
export const maxDuration = 180;

interface ValidateBody {
  mission?: string;
  // Mode 1 inputs
  files?: { path: string; content: string; language?: string }[];
  classification?: any;
  agentOutputs?: any;
  // Mode 2 inputs
  maxRegenerations?: number;
  pipelineOpts?: {
    atlasIntel?: any;
    enableCritique?: boolean;
    enableMultiFile?: boolean;
    enableRefinement?: boolean;
    maxIterations?: number;
  };
  missionId?: string;
  // Common validation options
  threshold?: number;
  perDimThreshold?: number;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
}

export async function POST(request: NextRequest): Promise<Response> {
  const t0 = Date.now();

  try {
    const body = (await request.json().catch(() => ({}))) as ValidateBody;

    if (!body.mission || typeof body.mission !== 'string' || body.mission.trim().length === 0) {
      return Response.json(
        { ok: false, error: 'Missing or empty "mission" field' },
        { status: 400 },
      );
    }

    const mission = body.mission.trim();
    const validationOpts: ValidationOptions = {
      threshold: body.threshold,
      perDimThreshold: body.perDimThreshold,
      temperature: body.temperature,
      maxTokens: body.maxTokens,
      timeoutMs: body.timeoutMs,
      classification: body.classification,
      agentOutputs: body.agentOutputs,
    };

    // ══ MODE 1: validate-only (files provided) ══
    if (Array.isArray(body.files) && body.files.length > 0) {
      // Basic validation of files structure
      const validFiles = body.files.filter(
        f => f && typeof f.path === 'string' && typeof f.content === 'string',
      );
      if (validFiles.length === 0) {
        return Response.json(
          { ok: false, error: 'files[] provided but no valid {path, content} entries' },
          { status: 400 },
        );
      }

      console.log(
        `[nova/validate] mode=validate-only ` +
        `mission="${mission.slice(0, 60)}" ` +
        `files=${validFiles.length} ` +
        `threshold=${body.threshold ?? 7.0}`,
      );

      const report = await validateFiles(
        mission,
        validFiles,
        body.classification,
        body.agentOutputs,
        validationOpts,
      );

      return Response.json({
        ok: true,
        mode: 'validate-only',
        report,
        regenerationCount: 0,
        trend: [{
          attempt: 1,
          overall: report.overall,
          passed: report.passed,
          weakestDimension: report.weakestDimension?.name ?? null,
          weakestScore: report.weakestDimension?.score ?? null,
          totalMs: report.totalMs,
        }],
        improvementDelta: 0,
        totalMs: Date.now() - t0,
      });
    }

    // ══ MODE 2: full quality-gated pipeline ══
    console.log(
      `[nova/validate] mode=quality-gated-pipeline ` +
      `mission="${mission.slice(0, 60)}" ` +
      `maxRegen=${body.maxRegenerations ?? 2} ` +
      `threshold=${body.threshold ?? 7.0}`,
    );

    const gatedOpts: QualityGatedOptions = {
      ...validationOpts,
      maxRegenerations: body.maxRegenerations,
      pipelineOpts: body.pipelineOpts,
      missionId: body.missionId,
    };

    const gated = await runWithQualityGate(mission, gatedOpts);

    return Response.json({
      ok: true,
      mode: 'quality-gated-pipeline',
      report: gated.qualityReport,
      result: gated.result,
      history: gated.history,
      regenerationCount: gated.regenerationCount,
      passed: gated.passed,
      trend: gated.trend,
      improvementDelta: gated.improvementDelta,
      totalMs: Date.now() - t0,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : null;
    console.error('[nova/validate] FATAL:', msg, stack);
    return Response.json(
      {
        ok: false,
        error: msg,
        stack: process.env.NODE_ENV === 'development' ? stack : undefined,
        totalMs: Date.now() - t0,
      },
      { status: 500 },
    );
  }
}

// GET — info endpoint
export async function GET(): Promise<Response> {
  return Response.json({
    ok: true,
    endpoint: '/api/nova/validate',
    method: 'POST',
    description: 'Independent 8-dimension quality validator with auto-regeneration below threshold',
    modes: {
      'validate-only': 'POST with { mission, files: [{path, content}] } — validates existing files without running the pipeline',
      'quality-gated-pipeline': 'POST with { mission } — runs enhanced pipeline + validates + regenerates up to 2x if below threshold',
    },
    dimensions: QUALITY_DIMENSIONS.map((name, i) => ({
      index: i + 1,
      name,
      description: DIMENSION_DESCRIPTIONS[name],
    })),
    defaults: {
      threshold: 7.0,
      perDimThreshold: 5.0,
      temperature: 0.3,
      maxTokens: 2000,
      timeoutMs: 60000,
      maxRegenerations: 2,
    },
    response: {
      ok: 'boolean',
      mode: '"validate-only" | "quality-gated-pipeline"',
      report: 'QualityReport — { dimensions[], overall, passed, feedback, weakestDimension, staticHints, totalMs, provider, tokensUsed }',
      result: 'EnhancedPipelineResult (mode 2 only) — full pipeline output',
      history: 'QualityReport[] (mode 2 only) — per-attempt reports for trend analysis',
      regenerationCount: 'number — 0 in mode 1, 0-2 in mode 2',
      passed: 'boolean — did any attempt pass the quality gate?',
      trend: 'array — overall score per attempt',
      improvementDelta: 'number — last.overall - first.overall (positive = improvement)',
      totalMs: 'number',
    },
    example: {
      validateOnly: {
        mission: 'build a snake game',
        files: [{ path: 'index.html', content: '<html><body>hello</body></html>' }],
      },
      fullPipeline: {
        mission: 'fibonacci to 10',
        maxRegenerations: 2,
        threshold: 7.0,
      },
    },
  });
}

const DIMENSION_DESCRIPTIONS: Record<string, string> = {
  'Completeness': 'Does it fulfill all aspects of the mission? Missing features?',
  'Correctness': 'Will the code actually work? Logic errors? Syntax errors?',
  'Code Quality': 'Clean code? Descriptive names? Proper structure? Comments?',
  'Error Handling': 'Edge cases handled? Graceful failures? Input validation?',
  'UX/Polish': 'For games/apps — usable? Responsive? Accessible? For code — well-formatted?',
  'Security': 'Any vulnerabilities? Input sanitization? Safe patterns?',
  'Testability': 'Can it be tested? Are there tests? Do tests cover edge cases?',
  'Professionalism': 'Does this look like a senior engineer\'s work or a junior\'s?',
};
