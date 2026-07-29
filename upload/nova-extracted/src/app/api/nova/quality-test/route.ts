// POST /api/nova/quality-test
// ─────────────────────────────────────────────────────────────────────────────
// SUB-N-ENHANCED-PROMPTS — Quality comparison endpoint
//
// Runs BOTH the ORIGINAL NOVA agents AND the ENHANCED agents on the SAME
// mission, side-by-side. Returns both outputs plus computed comparison
// metrics so we can MEASURE the improvement.
//
// We run a 3-stage mini-pipeline for each side: PM → Architect → Coder.
// These three stages are the most output-sensitive — they decide whether
// the user gets a 4-function toy or a 6-function production spec, a
// 100-line skeleton or a 400-line polished game.
//
// Request body:
//   { mission: string }
//
// Response:
//   {
//     mission: string,
//     original: { pmOutput, archOutput, coderOutput, pmMs, coderMs, totalMs },
//     enhanced: { pmOutput, archOutput, coderOutput, pmMs, coderMs, totalMs },
//     comparison: {
//       pm:       { fnDiff, testCaseDiff, riskDiff, acceptDiff, tokenDiff },
//       coder:    { fileDiff, lineDiff, charDiff, tokenDiff },
//       enhancedWins: boolean,
//       summary: string
//     }
//   }
// ─────────────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server';
import {
  runPM,
  runArchitect,
  runCoder,
  type AgentContext,
  type AgentResult,
} from '@/lib/nova-llm-agents';
import {
  runPMEnhanced,
  runArchitectEnhanced,
  runCoderEnhanced,
} from '@/lib/enhanced-llm-agents';
import { allExpertPromptWordCounts } from '@/lib/agent-prompt-library';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
// Two full pipelines (original + enhanced), each with 3 LLM calls. The
// enhanced Coder alone can take 60-90s with 8000 token budget. 180s gives
// both pipelines room to finish.
export const maxDuration = 180;

// ─────────────────────────────────────────────────────────────────────────────
// Metric helpers
// ─────────────────────────────────────────────────────────────────────────────

interface PMMetrics {
  functionCount: number;
  testCaseCount: number;
  riskCount: number;
  acceptanceCount: number;
  tokensUsed: number;
  ms: number;
}

interface CoderMetrics {
  fileCount: number;
  totalLines: number;
  totalChars: number;
  tokensUsed: number;
  ms: number;
  paths: string[];
}

function measurePM(pm: AgentResult): PMMetrics {
  const o = pm.output || {};
  return {
    functionCount: Array.isArray(o.functions) ? o.functions.length : 0,
    testCaseCount: Array.isArray(o.testCases) ? o.testCases.length : 0,
    riskCount: Array.isArray(o.risks) ? o.risks.length : 0,
    acceptanceCount: Array.isArray(o.acceptanceCriteria) ? o.acceptanceCriteria.length : 0,
    tokensUsed: pm.tokensUsed || 0,
    ms: pm.ms || 0,
  };
}

function measureCoder(coder: AgentResult): CoderMetrics {
  const files = Array.isArray(coder.output?.files) ? coder.output.files : [];
  const totalLines = files.reduce((sum: number, f: any) => sum + ((f.content || '').split('\n').length), 0);
  const totalChars = files.reduce((sum: number, f: any) => sum + (f.content || '').length, 0);
  return {
    fileCount: files.length,
    totalLines,
    totalChars,
    tokensUsed: coder.tokensUsed || 0,
    ms: coder.ms || 0,
    paths: files.map((f: any) => f.path),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Run a 3-stage mini-pipeline (PM → Architect → Coder)
// Returns all three AgentResults.
// ─────────────────────────────────────────────────────────────────────────────

async function runOriginalPipeline(mission: string, context: AgentContext) {
  const pmResult = await runPM(mission, context);
  const archResult = await runArchitect(mission, pmResult.output, context);
  const coderResult = await runCoder(mission, pmResult.output, archResult.output, context);
  return { pm: pmResult, architect: archResult, coder: coderResult };
}

async function runEnhancedPipeline(mission: string, context: AgentContext) {
  const pmResult = await runPMEnhanced(mission, context);
  const archResult = await runArchitectEnhanced(mission, pmResult.output, context);
  const coderResult = await runCoderEnhanced(mission, pmResult.output, archResult.output, context);
  return { pm: pmResult, architect: archResult, coder: coderResult };
}

// ─────────────────────────────────────────────────────────────────────────────
// POST handler
// ─────────────────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest): Promise<Response> {
  const t0 = Date.now();

  try {
    const body = await request.json().catch(() => ({}));
    const mission = String(body?.mission || '').trim();

    if (!mission) {
      return NextResponse.json(
        { error: 'Missing "mission" field in request body.' },
        { status: 400 }
      );
    }

    const context: AgentContext = {
      atlasIntel: body?.atlasIntel || undefined,
      learningContext: body?.learningContext ? String(body.learningContext) : undefined,
      patterns: Array.isArray(body?.patterns) ? body.patterns : undefined,
    };

    // Run BOTH pipelines in parallel — they don't depend on each other.
    // This maximizes throughput (180s budget covers both).
    const [originalResult, enhancedResult] = await Promise.all([
      runOriginalPipeline(mission, context).catch(err => ({
        error: err instanceof Error ? err.message : String(err),
      })),
      runEnhancedPipeline(mission, context).catch(err => ({
        error: err instanceof Error ? err.message : String(err),
      })),
    ]);

    // Compute metrics
    const originalPM = (originalResult as any)?.pm ? measurePM((originalResult as any).pm) : null;
    const enhancedPM = (enhancedResult as any)?.pm ? measurePM((enhancedResult as any).pm) : null;
    const originalCoder = (originalResult as any)?.coder ? measureCoder((originalResult as any).coder) : null;
    const enhancedCoder = (enhancedResult as any)?.coder ? measureCoder((enhancedResult as any).coder) : null;

    const comparison = {
      pm: originalPM && enhancedPM ? {
        fnDiff: enhancedPM.functionCount - originalPM.functionCount,
        testCaseDiff: enhancedPM.testCaseCount - originalPM.testCaseCount,
        riskDiff: enhancedPM.riskCount - originalPM.riskCount,
        acceptDiff: enhancedPM.acceptanceCount - originalPM.acceptanceCount,
        tokenDiff: enhancedPM.tokensUsed - originalPM.tokensUsed,
        original: originalPM,
        enhanced: enhancedPM,
      } : null,
      coder: originalCoder && enhancedCoder ? {
        fileDiff: enhancedCoder.fileCount - originalCoder.fileCount,
        lineDiff: enhancedCoder.totalLines - originalCoder.totalLines,
        charDiff: enhancedCoder.totalChars - originalCoder.totalChars,
        tokenDiff: enhancedCoder.tokensUsed - originalCoder.tokensUsed,
        original: originalCoder,
        enhanced: enhancedCoder,
      } : null,
      enhancedWins: !!(enhancedCoder && originalCoder && enhancedCoder.totalLines > originalCoder.totalLines),
      summary: '',
    };

    // Human-readable summary
    if (comparison.coder && comparison.pm) {
      const lineWin = comparison.coder.lineDiff > 0 ? 'more' : comparison.coder.lineDiff < 0 ? 'fewer' : 'same';
      const fnWin = comparison.pm.fnDiff > 0 ? 'more' : comparison.pm.fnDiff < 0 ? 'fewer' : 'same';
      const testWin = comparison.pm.testCaseDiff > 0 ? 'more' : comparison.pm.testCaseDiff < 0 ? 'fewer' : 'same';
      comparison.summary = `Enhanced agents produced ${lineWin} code lines (${comparison.coder.lineDiff >= 0 ? '+' : ''}${comparison.coder.lineDiff}), ${fnWin} PM functions (${comparison.pm.fnDiff >= 0 ? '+' : ''}${comparison.pm.fnDiff}), and ${testWin} test cases (${comparison.pm.testCaseDiff >= 0 ? '+' : ''}${comparison.pm.testCaseDiff}) compared to original.`;
    }

    return NextResponse.json(
      {
        mission,
        expertPromptWordCounts: allExpertPromptWordCounts(),
        original: originalResult,
        enhanced: enhancedResult,
        comparison,
        totalMs: Date.now() - t0,
      },
      { status: 200 }
    );
  } catch (err) {
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
        totalMs: Date.now() - t0,
      },
      { status: 500 }
    );
  }
}

// GET — quick usage hint
export async function GET(): Promise<Response> {
  return NextResponse.json({
    usage: 'POST { mission: string }',
    example: {
      mission: 'build a snake game',
    },
    note: 'Runs BOTH the original and enhanced NOVA pipelines (PM → Architect → Coder) in parallel and returns side-by-side comparison metrics. Enhanced agents use expert prompts (300-500 words each), chain-of-thought reasoning, higher token limits (Coder 4000→8000, PM 1500→2500, QA 3000→4000), and tuned temperatures (Coder 0.3→0.2 for precision).',
    enhancedTokenLimits: {
      pm: '2500 tokens @ temperature 0.6',
      architect: '2500 tokens @ temperature 0.6',
      coder: '8000 tokens @ temperature 0.2',
      qa: '4000 tokens @ temperature 0.3',
      sec: '2500 tokens @ temperature 0.3',
      rel: '1500 tokens @ temperature 0.4',
    },
  });
}
