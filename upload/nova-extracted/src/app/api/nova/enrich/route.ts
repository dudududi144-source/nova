// ============================================================================
// POST /api/nova/enrich — Context Enrichment Endpoint
// ----------------------------------------------------------------------------
// Subagent T — SUB-T-CONTEXT-ENRICHMENT
//
// The "agents have real expertise" layer.
//
// Body: { mission: string, atlasIntel?: AtlasIntelPayload, classification?: ClassificationLike }
//
// Gathers four context sources in parallel and returns a single
// `enrichedContext` string (1500-3000 words) ready to inject into agent
// prompts. Also returns the structured intermediate results so callers can
// inspect each source.
//
// Sources:
//   1. ATLAS intel analysis    — LLM distills the 3 most relevant items
//   2. Domain knowledge        — static library for 9 mission types
//   3. Pattern library lookup  — reusable code from past successful missions
//   4. Mission research        — LLM generates 5 mission-specific insights
//
// Each source fails independently and falls back to a heuristic. The endpoint
// ALWAYS returns 200 with SOMETHING useful — never 500 on a single source
// failure.
//
// maxDuration = 60 — two LLM calls (atlas + research), each 25-30s timeout.
// ============================================================================

import type { NextRequest } from 'next/server';
import { enrichContext, type AtlasIntelPayload, type ClassificationLike } from '@/lib/context-enrichment';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

interface EnrichBody {
  mission?: string;
  atlasIntel?: AtlasIntelPayload;
  classification?: ClassificationLike;
  /** Skip the LLM calls — return only the instant sources (domain + patterns). */
  fast?: boolean;
}

// Inline keyword classifier fallback (used only if SUB-K's classifyMission
// is unavailable). Mirrors the fallback in /api/nova/multi-file/route.ts.
function classifyInline(mission: string): ClassificationLike {
  const lower = mission.toLowerCase();
  let type = 'utility';
  let subtype = 'generic';
  let deliveryFormat: string = 'nodejs';
  let runtime: string = 'js';
  let entryFile = 'index.js';
  let isPlayable = false;

  if (/snake|tetris|pong|chess|game|play|arcade/.test(lower)) {
    type = 'game';
    subtype = /snake/.test(lower) ? 'snake' : /tetris/.test(lower) ? 'tetris' : /pong/.test(lower) ? 'pong' : 'arcade';
    deliveryFormat = 'html';
    runtime = 'web';
    entryFile = 'index.html';
    isPlayable = true;
  } else if (/fib|factorial|sort|search|dp|dynamic prog|algorithm|leetcode/.test(lower)) {
    type = 'algorithm';
    subtype = /fib/.test(lower) ? 'fibonacci' : /factorial/.test(lower) ? 'factorial' : /sort/.test(lower) ? 'sorting' : 'general';
    deliveryFormat = 'nodejs';
    runtime = 'js';
    entryFile = 'src/index.js';
  } else if (/api|endpoint|server|rest|graphql/.test(lower)) {
    type = 'api';
    subtype = 'rest-crud';
    deliveryFormat = 'nodejs';
    runtime = 'js';
    entryFile = 'src/server.js';
  } else if (/stack|queue|linked list|tree|heap|trie|graph/.test(lower)) {
    type = 'data-structure';
    subtype = /stack/.test(lower) ? 'stack' : /queue/.test(lower) ? 'queue' : /tree/.test(lower) ? 'tree' : /heap/.test(lower) ? 'heap' : 'general';
    deliveryFormat = 'nodejs';
    runtime = 'js';
    entryFile = 'src/index.js';
  } else if (/cli|command line/.test(lower)) {
    type = 'cli-tool';
    subtype = 'cli';
    deliveryFormat = 'nodejs';
    runtime = 'js';
    entryFile = 'src/index.js';
  } else if (/web app|website|todo|dashboard|frontend|html app/.test(lower)) {
    type = 'web-app';
    subtype = /todo/.test(lower) ? 'todo-app' : 'web-app';
    deliveryFormat = 'html';
    runtime = 'web';
    entryFile = 'index.html';
    isPlayable = true;
  } else if (/library|package|npm/.test(lower)) {
    type = 'library';
    subtype = 'library';
    deliveryFormat = 'nodejs';
    runtime = 'js';
    entryFile = 'src/index.js';
  } else if (/script|automate|batch/.test(lower)) {
    type = 'script';
    subtype = 'script';
    deliveryFormat = 'nodejs';
    runtime = 'js';
    entryFile = 'index.js';
  }

  return {
    type,
    subtype,
    title: `${subtype} ${type}`,
    description: `Auto-detected ${type} mission`,
    deliveryFormat,
    runtime,
    entryFile,
    isPlayable,
    confidence: 0.6,
  };
}

export async function POST(request: NextRequest): Promise<Response> {
  const t0 = Date.now();

  let body: EnrichBody;
  try {
    body = (await request.json()) as EnrichBody;
  } catch {
    return Response.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  const mission: string | undefined = body?.mission;
  if (!mission || !mission.trim()) {
    return Response.json({ ok: false, error: 'Missing mission' }, { status: 400 });
  }

  const atlasIntel = body?.atlasIntel;
  const fast = Boolean(body?.fast);

  // ─────────────────────────────────────────────────────────────────────
  // Step 1: Get a classification (use provided, or classify now).
  // ─────────────────────────────────────────────────────────────────────
  let classification: ClassificationLike = body?.classification ?? {};
  if (!classification.type) {
    try {
      const mod: any = await import('@/lib/mission-classifier').catch(() => null);
      if (mod?.classifyMission) {
        const full = await mod.classifyMission(mission);
        classification = {
          type: full.type,
          subtype: full.subtype,
          title: full.title,
          description: full.description,
          deliveryFormat: full.deliveryFormat,
          runtime: full.runtime,
          entryFile: full.entryFile,
          isPlayable: full.isPlayable,
          confidence: full.confidence,
        };
      } else {
        classification = classifyInline(mission);
      }
    } catch (err) {
      console.error(
        '[/api/nova/enrich] classify failed, using inline:',
        err instanceof Error ? err.message : String(err),
      );
      classification = classifyInline(mission);
    }
  }

  // ─────────────────────────────────────────────────────────────────────
  // Step 2: Enrich.
  // ─────────────────────────────────────────────────────────────────────
  // In fast mode, skip the LLM calls and return only the domain knowledge +
  // patterns. Useful for instant UI feedback before the full enrichment
  // completes.
  if (fast) {
    try {
      const { getDomainKnowledge, formatDomainKnowledge } = await import('@/lib/domain-knowledge');
      const { retrievePatterns } = await import('@/lib/pattern-extraction');
      const dk = getDomainKnowledge(classification.type ?? 'utility');
      let patterns: any[] = [];
      try {
        patterns = await retrievePatterns(mission, classification.type ?? 'utility', 3);
      } catch {
        patterns = [];
      }
      const enrichedContext =
        '# ENRICHED CONTEXT BRIEF (fast mode)\n\n' +
        `Mission: ${mission}\n\n` +
        formatDomainKnowledge(dk) +
        '\n\n## Reusable Patterns\n\n' +
        (patterns.length > 0
          ? patterns
              .map(
                (p: any, i: number) =>
                  `### ${i + 1}. ${p.signature}\nApproach: ${p.approach}\nQuality: ${p.qualityScore}/10\n\`\`\`\n${(p.sourceCode ?? '').slice(0, 600)}\n\`\`\``,
              )
              .join('\n\n')
          : 'No matching patterns.');
      return Response.json({
        ok: true,
        mission,
        classification,
        atlasInsights: [],
        domainKnowledge: dk,
        reusablePatterns: patterns.map((p: any) => ({
          mission: p.mission,
          domain: p.domain,
          signature: p.signature,
          approach: p.approach,
          qualityScore: p.qualityScore,
          usageCount: p.usageCount,
          sourceCodePreview: (p.sourceCode ?? '').slice(0, 800),
        })),
        researchInsights: [],
        enrichedContext,
        timing: { atlas: 0, domain: 0, patterns: 0, research: 0, total: Date.now() - t0 },
        totalMs: Date.now() - t0,
        sources: { atlas: false, domain: true, patterns: patterns.length > 0, research: false },
        fastMode: true,
      });
    } catch (err) {
      console.error('[/api/nova/enrich] fast mode failed:', err);
      // fall through to full mode
    }
  }

  try {
    const result = await enrichContext(mission, classification, atlasIntel);
    return Response.json({
      ok: true,
      ...result,
      fastMode: false,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[/api/nova/enrich] enrichContext failed:', msg);
    return Response.json(
      {
        ok: false,
        error: 'Context enrichment failed: ' + msg,
        mission,
        classification,
        totalMs: Date.now() - t0,
      },
      { status: 500 },
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET — quick smoke test for the endpoint
// ─────────────────────────────────────────────────────────────────────────────

export async function GET(): Promise<Response> {
  return Response.json({
    ok: true,
    endpoint: '/api/nova/enrich',
    method: 'POST',
    body: {
      mission: 'string (required)',
      atlasIntel: 'AtlasIntelPayload (optional)',
      classification: 'ClassificationLike (optional — auto-classified if missing)',
      fast: 'boolean (optional — skip LLM calls)',
    },
    sources: [
      'ATLAS intel analysis (LLM, temp 0.4, maxTokens 1000)',
      'Domain knowledge (static, instant) — 9 mission types covered',
      'Pattern library lookup (DB-backed via retrievePatterns)',
      'Mission research (LLM, temp 0.5, maxTokens 1500) — 5 insights',
    ],
    maxDuration: 60,
  });
}
