// ============================================================================
// POST /api/nova/lessons/record — Manual lesson recording endpoint
// ----------------------------------------------------------------------------
// SUB-W-ADAPTIVE-LEARNING-FEEDBACK
//
// Records lessons from a quality report. Used for:
//   1. MANUAL TESTING — call this with a fake quality report to verify the
//      learning loop without running the full pipeline.
//   2. INTEGRATION BY THE MAIN AGENT — after a mission completes and is
//      validated, the enhanced-unified-pipeline can call this endpoint (or
//      call recordLesson() directly) to persist lessons for future missions.
//
// Body:
//   {
//     mission:      string,                          // REQUIRED
//     classification?: { type?: string, subtype?: string },
//     qualityReport?: QualityReportInput,            // see adaptive-learning.ts
//     files?:        MissionFile[],                   // optional, for keyword/context
//     runValidator?: boolean                          // default false. When true,
//                                                     //   and qualityReport is null,
//                                                     //   and files are provided,
//                                                     //   run SUB-U's validateQuality
//                                                     //   on the files and record
//                                                     //   lessons from that report.
//   }
//
// Response:
//   {
//     ok: true,
//     recorded: Lesson[],     // the lessons that were saved
//     count: number,
//     retrieved?: Lesson[],   // when retrieveAfter=true, top-5 lessons for this mission
//     promptSection?: string, // when retrieveAfter=true, formatted lessons section
//     ms: number
//   }
//
// Errors:
//   - 400: missing 'mission'
//   - 500: DB write failure (rare — recordLesson swallows per-row errors)
// ============================================================================

import type { NextRequest } from 'next/server';
import {
  recordLesson,
  retrieveLessons,
  formatLessonsForPrompt,
  type QualityReportInput,
  type MissionFile,
  type ClassificationInput,
  type Lesson,
} from '@/lib/adaptive-learning';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
// recordLesson is a single batch INSERT — fast. But if runValidator=true we
// may invoke the LLM (validateQuality), which can take 10-60s.
export const maxDuration = 90;

interface RecordBody {
  mission?: string;
  classification?: ClassificationInput;
  qualityReport?: QualityReportInput;
  files?: MissionFile[];
  /** When true, after recording, retrieve top-5 lessons for this mission
   *  and return the formatted prompt section. Useful for one-shot testing. */
  retrieveAfter?: boolean;
  /** When true AND qualityReport is missing AND files are provided, run
   *  SUB-U's validateQuality on the files to produce a real report, then
   *  record lessons from THAT. Slow (LLM call). */
  runValidator?: boolean;
  /** Validation options forwarded to validateQuality when runValidator=true. */
  validatorOpts?: {
    threshold?: number;
    perDimThreshold?: number;
    temperature?: number;
    maxTokens?: number;
    timeoutMs?: number;
  };
}

export async function POST(request: NextRequest): Promise<Response> {
  const t0 = Date.now();
  try {
    const body = (await request.json().catch(() => ({}))) as RecordBody;

    if (!body.mission || typeof body.mission !== 'string' || body.mission.trim().length === 0) {
      return Response.json(
        { ok: false, error: 'Missing or empty "mission" field' },
        { status: 400 },
      );
    }

    const mission = body.mission.trim();
    const classification: ClassificationInput = body.classification || {};
    const files = Array.isArray(body.files) ? body.files : [];

    let qualityReport: QualityReportInput | null | undefined = body.qualityReport;

    // ── Optional: run SUB-U's validateQuality to produce a real report ──
    if (body.runValidator && !qualityReport && files.length > 0) {
      try {
        const validatorModule = await import('@/lib/quality-validator');
        if (typeof validatorModule.validateQuality === 'function') {
          const report = await validatorModule.validateQuality(
            mission,
            files.map(f => ({ path: f.path, content: f.content, language: f.language })),
            classification,
            undefined,
            {
              threshold: body.validatorOpts?.threshold,
              perDimThreshold: body.validatorOpts?.perDimThreshold,
              temperature: body.validatorOpts?.temperature,
              maxTokens: body.validatorOpts?.maxTokens,
              timeoutMs: body.validatorOpts?.timeoutMs,
            },
          );
          qualityReport = report as unknown as QualityReportInput;
        }
      } catch (err) {
        console.warn(
          '[/api/nova/lessons/record] validator dynamic import failed — recording from caller-supplied report only:',
          err instanceof Error ? err.message : String(err),
        );
      }
    }

    // ── Record lessons ──
    const recorded: Lesson[] = await recordLesson(
      mission,
      classification,
      qualityReport,
      files,
    );

    // ── Optional: retrieve + format (one-shot test of the loop) ──
    let retrieved: Lesson[] | undefined;
    let promptSection: string | undefined;
    if (body.retrieveAfter) {
      retrieved = await retrieveLessons(mission, classification, 5);
      promptSection = formatLessonsForPrompt(retrieved);
    }

    return Response.json({
      ok: true,
      recorded,
      count: recorded.length,
      retrieved,
      promptSection,
      ms: Date.now() - t0,
    });
  } catch (err) {
    console.error(
      '[/api/nova/lessons/record] failed:',
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

// GET on the record endpoint — returns metadata for discovery
export async function GET(): Promise<Response> {
  return Response.json({
    ok: true,
    endpoint: '/api/nova/lessons/record',
    method: 'POST',
    description:
      'Record lessons from a quality report. After a mission completes, ' +
      'the quality scores + specific issues are saved as AgentLesson rows ' +
      'so future missions can learn from them.',
    bodyShape: {
      mission: 'string (required)',
      classification: '{ type?: string, subtype?: string } (optional)',
      qualityReport:
        '{ overall, passed, dimensions: [{name, score, justification, issues}], feedback, staticHints, weakestDimension } (optional — required unless runValidator=true)',
      files: 'Array<{path, content, language?}> (optional — used when runValidator=true)',
      runValidator:
        'boolean (default false) — when true and qualityReport is missing, run SUB-U validateQuality on the files',
      retrieveAfter:
        'boolean (default false) — when true, also retrieve top-5 lessons + formatted prompt section for this mission',
      validatorOpts: '{ threshold?, perDimThreshold?, temperature?, maxTokens?, timeoutMs? }',
    },
    responseShape: {
      ok: 'boolean',
      recorded: 'Lesson[]',
      count: 'number',
      retrieved: 'Lesson[]? (only when retrieveAfter=true)',
      promptSection: 'string? (only when retrieveAfter=true)',
      ms: 'number',
    },
  });
}
