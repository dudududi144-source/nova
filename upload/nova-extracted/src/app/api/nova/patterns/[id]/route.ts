// GET /api/nova/patterns/[id] — single pattern with full source code
// ---------------------------------------------------------------------------
// Subagent I — Pattern Extraction & Code Reuse
//
// Returns the complete CodePattern row, including full sourceCode and testCode
// (these are intentionally NOT truncated on this endpoint — use this for the
// "view code" detail view, or for the Coder agent to fetch a complete template).
//
// Query params: none.
//
// Response:
//   {
//     ok: true,
//     pattern: CodePatternRow (full),  // includes sourceCode, testCode,
//                                       // keywords[], fileStructure[]
//     formatted: string                // pattern as a prompt section ready
//                                       // to feed to the Coder agent
//   }
import type { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import {
  formatPatternForCoder,
  markPatternUsed,
  type CodePatternRow,
} from '@/lib/pattern-extraction';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function safeJson<T>(s: string | null | undefined, fallback: T): T {
  if (!s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}

function serializeFull(p: CodePatternRow) {
  return {
    id: p.id,
    mission: p.mission,
    domain: p.domain,
    signature: p.signature,
    approach: p.approach,
    sourceCode: p.sourceCode,
    testCode: p.testCode,
    fileStructure: safeJson(p.fileStructure, []),
    success: p.success,
    usageCount: p.usageCount,
    qualityScore: p.qualityScore,
    keywords: safeJson(p.keywords, []),
    extractedFrom: p.extractedFrom,
    createdAt: p.createdAt,
    lastUsedAt: p.lastUsedAt,
  };
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const t0 = Date.now();
  try {
    const { id } = await params;
    if (!id) {
      return Response.json({ ok: false, error: 'Missing pattern id' }, { status: 400 });
    }

    const raw = await db.codePattern.findUnique({ where: { id } });
    if (!raw) {
      return Response.json(
        { ok: false, error: `Pattern not found: ${id}` },
        { status: 404 },
      );
    }

    const pattern = raw as unknown as CodePatternRow;

    // Fire-and-forget usage tracking — fetching a full pattern counts as a
    // "use" (the Coder agent is about to consult it). We don't await this.
    void markPatternUsed(id).catch(() => {
      /* swallow — usage tracking is best-effort */
    });

    // Pre-format the pattern as a prompt section so callers can directly
    // inject it into a Coder agent prompt without re-formatting.
    const formatted = formatPatternForCoder([pattern]);

    return Response.json({
      ok: true,
      pattern: serializeFull(pattern),
      formatted,
      ms: Date.now() - t0,
    });
  } catch (err) {
    console.error(
      '[/api/nova/patterns/[id]] failed:',
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
