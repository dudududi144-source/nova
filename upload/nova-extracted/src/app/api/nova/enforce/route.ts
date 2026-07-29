// ============================================================================
// POST /api/nova/enforce — Code Excellence Enforcement Endpoint
// ----------------------------------------------------------------------------
// SUB-V-CODE-EXCELLENCE-STANDARDS
//
// Two modes:
//
//   MODE 1 — "enforce my files":
//     Body: { mission, files: [{path, content}], classification? }
//     Runs the Code Excellence Enforcer on the provided files. Each file is
//     sent to the LLM with a SENIOR-CODE-REVIEWER prompt + applicable standards.
//     Returns upgraded files + a list of every upgrade applied + static
//     validation on the upgraded output.
//     Does NOT run the pipeline. Fast (one LLM call per file, parallel).
//
//   MODE 2 — "run pipeline + enforce":
//     Body: { mission, classification?, pipelineOpts? }
//     Runs the enhanced pipeline first (PM → Architect → Coder → QA → Sec),
//     then enforces standards on the pipeline's output files.
//     Slow (pipeline ~60s + enforcement ~5-15s for 4 files).
//
// Response shape (both modes):
//   {
//     ok: true,
//     mode: 'enforce-only' | 'pipeline-plus-enforce',
//     files: UpgradedFile[],         // each file with originalContent + upgrades
//     upgrades: string[],            // flat list of every upgrade note
//     upgradedCount: number,         // files actually upgraded
//     fallbackCount: number,         // files kept as-is (LLM failed)
//     validation: ValidationResult,  // static check on the upgraded output
//     pipelineResult?: EnhancedPipelineResult,  // mode 2 only
//     classification: MissionClassification,
//     tokensUsed: number,
//     totalMs: number
//   }
//
// GET /api/nova/enforce → info endpoint (no body needed)
// ============================================================================

import type { NextRequest } from 'next/server';
import {
  enforceExcellence,
  type EnforceOptions,
  type InputFile,
} from '@/lib/code-excellence-enforcer';
import {
  CODE_STANDARDS,
  getStandards,
  formatStandardsForPrompt,
  listStandardTypes,
  countStandards,
  type StandardType,
} from '@/lib/code-standards';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
// Mode 2 runs the enhanced pipeline (~60s) + enforcement (~5-15s for 4 files
// in parallel). 120s gives us enough room for the worst case.
export const maxDuration = 120;

interface EnforceBody {
  mission?: string;
  // Mode 1 inputs
  files?: { path: string; content: string; language?: string }[];
  classification?: any;
  // Mode 2 inputs
  pipelineOpts?: {
    atlasIntel?: any;
    enableCritique?: boolean;
    enableMultiFile?: boolean;
    enableRefinement?: boolean;
    maxIterations?: number;
  };
  missionId?: string;
  // Common enforcement options
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  concurrency?: number;
  validateOnly?: boolean;
}

export async function POST(request: NextRequest): Promise<Response> {
  const t0 = Date.now();

  try {
    const body = (await request.json().catch(() => ({}))) as EnforceBody;

    if (
      !body.mission ||
      typeof body.mission !== 'string' ||
      body.mission.trim().length === 0
    ) {
      return Response.json(
        { ok: false, error: 'Missing or empty "mission" field' },
        { status: 400 },
      );
    }

    const mission = body.mission.trim();

    const enforceOpts: EnforceOptions = {
      classification: body.classification,
      temperature: body.temperature,
      maxTokens: body.maxTokens,
      timeoutMs: body.timeoutMs,
      concurrency: body.concurrency,
      validateOnly: body.validateOnly,
    };

    // ══ MODE 1: enforce-only (files provided) ══
    if (Array.isArray(body.files) && body.files.length > 0) {
      const validFiles: InputFile[] = body.files.filter(
        (f): f is InputFile =>
          !!f &&
          typeof f.path === 'string' &&
          typeof f.content === 'string',
      );
      if (validFiles.length === 0) {
        return Response.json(
          {
            ok: false,
            error: 'files[] provided but no valid {path, content} entries',
          },
          { status: 400 },
        );
      }

      console.log(
        `[nova/enforce] mode=enforce-only ` +
          `mission="${mission.slice(0, 60)}" ` +
          `files=${validFiles.length} ` +
          `validateOnly=${body.validateOnly ?? false}`,
      );

      const result = await enforceExcellence(
        validFiles,
        mission,
        body.classification,
        enforceOpts,
      );

      return Response.json({
        ok: true,
        mode: 'enforce-only',
        files: result.files,
        upgrades: result.upgrades,
        upgradedCount: result.upgradedCount,
        fallbackCount: result.fallbackCount,
        validation: result.validation,
        classification: body.classification || null,
        tokensUsed: result.tokensUsed,
        totalMs: Date.now() - t0,
        perFileMs: result.perFileMs,
      });
    }

    // ══ MODE 2: pipeline + enforce ══
    console.log(
      `[nova/enforce] mode=pipeline-plus-enforce ` +
        `mission="${mission.slice(0, 60)}"`,
    );

    // Dynamically import the pipeline to keep mode 1 fast (it never needs it)
    const { runEnhancedPipeline } = await import(
      '@/lib/enhanced-unified-pipeline'
    ).catch(() => ({ runEnhancedPipeline: null }));

    if (!runEnhancedPipeline) {
      return Response.json(
        {
          ok: false,
          error: 'enhanced-unified-pipeline not available — cannot run mode 2',
        },
        { status: 503 },
      );
    }

    const pipelineResult = await runEnhancedPipeline(mission, {
      atlasIntel: body.pipelineOpts?.atlasIntel,
      missionId: body.missionId,
      enableCritique: body.pipelineOpts?.enableCritique,
      enableMultiFile: body.pipelineOpts?.enableMultiFile,
      enableRefinement: body.pipelineOpts?.enableRefinement,
      maxIterations: body.pipelineOpts?.maxIterations,
    });

    const pipelineFiles: InputFile[] = (pipelineResult.files || []).map(f => ({
      path: f.path,
      content: f.content,
      language: f.language,
    }));

    if (pipelineFiles.length === 0) {
      return Response.json({
        ok: true,
        mode: 'pipeline-plus-enforce',
        files: [],
        upgrades: [],
        upgradedCount: 0,
        fallbackCount: 0,
        validation: { passed: false, violations: [], files: [] },
        pipelineResult,
        classification: pipelineResult.classification,
        tokensUsed: 0,
        totalMs: Date.now() - t0,
        warning: 'pipeline produced no files to enforce',
      });
    }

    // Enforce on the pipeline output (use the pipeline's classification)
    const enforceResult = await enforceExcellence(
      pipelineFiles,
      mission,
      pipelineResult.classification,
      enforceOpts,
    );

    return Response.json({
      ok: true,
      mode: 'pipeline-plus-enforce',
      files: enforceResult.files,
      upgrades: enforceResult.upgrades,
      upgradedCount: enforceResult.upgradedCount,
      fallbackCount: enforceResult.fallbackCount,
      validation: enforceResult.validation,
      pipelineResult,
      classification: pipelineResult.classification,
      tokensUsed: enforceResult.tokensUsed,
      totalMs: Date.now() - t0,
      perFileMs: enforceResult.perFileMs,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : null;
    console.error('[nova/enforce] FATAL:', msg, stack);
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
  const standardsByType = listStandardTypes().map(({ type, count }) => ({
    type,
    count,
    sampleRules: (CODE_STANDARDS[type] as any[]).slice(0, 3).map(s => s.rule),
  }));

  return Response.json({
    ok: true,
    endpoint: '/api/nova/enforce',
    method: 'POST',
    description:
      'Code Excellence Enforcer — upgrades code in-place to meet production-grade standards (JSDoc, validation, error handling, structure)',
    modes: {
      'enforce-only':
        'POST with { mission, files: [{path, content}] } — enforces standards on existing files (no pipeline)',
      'pipeline-plus-enforce':
        'POST with { mission } — runs enhanced pipeline, then enforces standards on the output',
    },
    standardTypes: standardsByType,
    defaults: {
      temperature: 0.2,
      maxTokens: 6000,
      timeoutMs: 60_000,
      concurrency: 4,
    },
    response: {
      ok: 'boolean',
      mode: '"enforce-only" | "pipeline-plus-enforce"',
      files:
        'UpgradedFile[] — each file has { path, content (upgraded), originalContent, upgrades: UpgradeNote[], upgraded, ms, tokens, provider }',
      upgrades: 'string[] — flat list of every upgrade applied across all files',
      upgradedCount: 'number — files actually upgraded (vs kept as-is)',
      fallbackCount: 'number — files kept as-is due to LLM failure',
      validation:
        '{ passed, violations: [{file, standardId, rule, severity, reason}], files: [{path, passed, checked, violations}] }',
      pipelineResult: 'EnhancedPipelineResult (mode 2 only)',
      classification: 'MissionClassification',
      tokensUsed: 'number — aggregated LLM token usage',
      totalMs: 'number',
      perFileMs: 'array — {path, ms, upgraded} per file',
    },
    example: {
      enforceOnly: {
        mission: 'fibonacci to 10',
        files: [
          {
            path: 'src/index.js',
            content:
              'function fib(n){return n<2?n:fib(n-1)+fib(n-2)}\nmodule.exports = fib;',
          },
        ],
      },
      fullPipeline: {
        mission: 'build a snake game',
        pipelineOpts: {
          enableMultiFile: true,
          enableCritique: true,
          maxIterations: 2,
        },
      },
    },
    sampleStandardsForGame: formatStandardsForPrompt(
      getStandards('game', 'html'),
    ).slice(0, 600),
    countsForGame: countStandards('game', 'html'),
    countsForAlgorithm: countStandards('algorithm', 'nodejs'),
    countsForApi: countStandards('api', 'nodejs'),
  });
}

// Type re-export for callers
export type { StandardType };
