// POST /api/nova/patterns/extract — manual pattern extraction
// ---------------------------------------------------------------------------
// Subagent I — Pattern Extraction & Code Reuse
//
// Triggers extractPattern() on demand, for testing/inspection/integration.
// In production, /api/nova/forge-build calls extractPattern() automatically
// after a successful mission; this endpoint exists for ad-hoc extraction
// (e.g., backfilling patterns from old AgentMemory rows, or manual testing).
//
// Request body:
//   {
//     mission:    string,            // mission description
//     sourceCode: string,            // the working code
//     testCode:   string (optional), // the tests that passed
//     domain:     string (optional), // domain — auto-detected if omitted
//     testPassed: boolean (optional, default true),
//     memoryId:   string (optional)  // links to AgentMemory row
//   }
//
// Response:
//   {
//     ok: true,
//     pattern: CodePatternRow (full),
//     analysis: {                       // debug info — what the extractor saw
//       signature, approach, keywords, qualityScore, fileStructure
//     }
//   }
import type { NextRequest } from 'next/server';
import {
  extractPattern,
  type CodePatternRow,
} from '@/lib/pattern-extraction';
import { detectDomain } from '@/lib/nova-learning';

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

interface ExtractRequestBody {
  mission?: string;
  sourceCode?: string;
  testCode?: string;
  domain?: string;
  testPassed?: boolean;
  memoryId?: string;
}

export async function POST(request: NextRequest): Promise<Response> {
  const t0 = Date.now();
  try {
    const body = (await request.json()) as ExtractRequestBody;

    // Validate required fields
    if (!body || typeof body !== 'object') {
      return Response.json(
        { ok: false, error: 'Request body must be a JSON object' },
        { status: 400 },
      );
    }
    if (!body.mission || typeof body.mission !== 'string' || body.mission.trim().length === 0) {
      return Response.json(
        { ok: false, error: 'Field "mission" is required (non-empty string)' },
        { status: 400 },
      );
    }
    if (
      !body.sourceCode ||
      typeof body.sourceCode !== 'string' ||
      body.sourceCode.trim().length === 0
    ) {
      return Response.json(
        { ok: false, error: 'Field "sourceCode" is required (non-empty string)' },
        { status: 400 },
      );
    }

    const domain = body.domain || detectDomain(body.mission);
    const testPassed = body.testPassed !== undefined ? !!body.testPassed : true;

    const pattern = await extractPattern(body.mission, body.sourceCode, body.testCode || '', domain, {
      memoryId: body.memoryId,
      testPassed,
    });

    const response = {
      ok: true,
      pattern: {
        id: pattern.id,
        mission: pattern.mission,
        domain: pattern.domain,
        signature: pattern.signature,
        approach: pattern.approach,
        sourceCode: pattern.sourceCode,
        testCode: pattern.testCode,
        fileStructure: safeJson(pattern.fileStructure, []),
        success: pattern.success,
        usageCount: pattern.usageCount,
        qualityScore: pattern.qualityScore,
        keywords: safeJson(pattern.keywords, []),
        extractedFrom: pattern.extractedFrom,
        createdAt: pattern.createdAt,
        lastUsedAt: pattern.lastUsedAt,
      },
      analysis: {
        signature: pattern.signature,
        approach: pattern.approach,
        keywords: safeJson(pattern.keywords, []),
        qualityScore: pattern.qualityScore,
        fileStructure: safeJson(pattern.fileStructure, []),
        detectedDomain: domain,
      },
      ms: Date.now() - t0,
    };

    return Response.json(response);
  } catch (err) {
    console.error(
      '[/api/nova/patterns/extract] failed:',
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
