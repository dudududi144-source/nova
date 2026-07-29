// ============================================================================
// POST /api/nova/distill
// ----------------------------------------------------------------------------
// SUB-AA-DISTILLATION-ENGINE
//
// Manually trigger distillation of a high-quality mission output into a
// reusable fallback template. After a mission completes with quality >= 8.0,
// the pipeline (or a developer) can POST here to permanently save the
// output as a DistilledFallback row.
//
// Request body:
//   {
//     mission:       string,                    // the original mission text
//     files:         [{path, content, language?}],
//     qualityScore:  number,                    // 0-10
//     classification?: {                         // optional, from mission-classifier
//       type?:        string,
//       subtype?:     string,
//       title?:       string,
//       description?: string,
//     } | null,
//     approach?:     string                     // optional, from PM/Architect
//   }
//
// Response:
//   200 OK — {
//     ok: true,
//     distilled: boolean,                       // true if a row was created
//     fallback:  DistilledFallback | null,      // the created row, or null
//     reason:    string,                        // why it was/wasn't distilled
//     ms:        number
//   }
//
//   400 — malformed request (missing mission / files / qualityScore)
//   500 — DB error (returns ok:false with error message, never throws)
//
// Notes:
//   - If qualityScore < 8.0 (DISTILLATION_THRESHOLD), no row is created and
//     `distilled: false` is returned with `reason: "quality below threshold"`.
//   - The full file contents are stored UNTRUNCATED — these get reused
//     verbatim when the LLM is unavailable, so we need every byte.
// ============================================================================

import { NextRequest, NextResponse } from 'next/server';
import {
  distillOutput,
  DISTILLATION_THRESHOLD,
  type DistillInput,
} from '@/lib/distillation-engine';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

export async function POST(request: NextRequest): Promise<Response> {
  const t0 = Date.now();

  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return NextResponse.json(
        { ok: false, error: 'Request body must be JSON.' },
        { status: 400 },
      );
    }

    const mission = typeof body.mission === 'string' ? body.mission : '';
    const filesRaw = Array.isArray(body.files) ? body.files : null;
    const qualityScore =
      typeof body.qualityScore === 'number' ? body.qualityScore : NaN;
    const classification =
      body.classification && typeof body.classification === 'object'
        ? body.classification
        : null;
    const approach =
      typeof body.approach === 'string' ? body.approach : undefined;

    if (!mission.trim()) {
      return NextResponse.json(
        { ok: false, error: 'Missing "mission" string.' },
        { status: 400 },
      );
    }
    if (!filesRaw || filesRaw.length === 0) {
      return NextResponse.json(
        { ok: false, error: 'Missing or empty "files" array.' },
        { status: 400 },
      );
    }
    if (Number.isNaN(qualityScore)) {
      return NextResponse.json(
        { ok: false, error: 'Missing or invalid "qualityScore" number.' },
        { status: 400 },
      );
    }

    // Normalize files: enforce {path, content} shape.
    const files: { path: string; content: string; language?: string }[] = [];
    for (const f of filesRaw) {
      if (!f || typeof f !== 'object') continue;
      const path = typeof f.path === 'string' ? f.path : '';
      const content = typeof f.content === 'string' ? f.content : '';
      if (!path) continue;
      files.push({
        path,
        content,
        language: typeof f.language === 'string' ? f.language : undefined,
      });
    }

    if (files.length === 0) {
      return NextResponse.json(
        { ok: false, error: 'No valid file objects in "files" array.' },
        { status: 400 },
      );
    }

    // Pre-check threshold so we can return a clear reason without hitting the DB.
    if (qualityScore < DISTILLATION_THRESHOLD) {
      return NextResponse.json({
        ok: true,
        distilled: false,
        fallback: null,
        reason: `quality below threshold (${qualityScore.toFixed(2)} < ${DISTILLATION_THRESHOLD})`,
        threshold: DISTILLATION_THRESHOLD,
        ms: Date.now() - t0,
      });
    }

    const input: DistillInput = {
      mission,
      files,
      qualityScore,
      classification,
      approach,
    };

    const fallback = await distillOutput(input);

    if (!fallback) {
      return NextResponse.json({
        ok: true,
        distilled: false,
        fallback: null,
        reason: 'distillOutput returned null (files empty or DB error)',
        ms: Date.now() - t0,
      });
    }

    return NextResponse.json({
      ok: true,
      distilled: true,
      fallback,
      reason: 'distilled',
      threshold: DISTILLATION_THRESHOLD,
      ms: Date.now() - t0,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[/api/nova/distill] error:', err);
    return NextResponse.json(
      { ok: false, error: msg, ms: Date.now() - t0 },
      { status: 500 },
    );
  }
}

// GET on the distill root returns a tiny help message (the real listing
// endpoint is /api/nova/distill/list).
export async function GET(): Promise<Response> {
  return NextResponse.json({
    ok: true,
    endpoint: 'POST /api/nova/distill',
    description:
      'Distill a high-quality mission output (quality >= 8.0) into a reusable fallback template.',
    threshold: DISTILLATION_THRESHOLD,
    bodyShape: {
      mission: 'string',
      files: '[{path: string, content: string, language?: string}]',
      qualityScore: 'number (0-10)',
      classification: '{type?, subtype?, title?, description?} | null',
      approach: 'string?',
    },
    seeAlso: 'GET /api/nova/distill/list',
  });
}
