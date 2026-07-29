// ============================================================================
// POST /api/nova/multi-file — SUB-P-MULTI-FILE-ARCHITECTURE
// ----------------------------------------------------------------------------
// The endpoint that drives the Multi-File Pipeline. The user complained
// "the agents executed but it's terribly simple." Root cause: the Coder
// emits 1-2 files. This endpoint produces 4-8 files per project — proper
// separation of concerns.
//
// Pipeline:
//   1. classify  (SUB-K classifyMission — dynamic import with fallback)
//   2. PM        (runPM — real LLM agent)
//   3. Architect (runArchitect — real LLM agent)
//   4. Architect → designFileStructure  (4-8 files, LLM-driven or template)
//   5. Coder → generateMultiFileProject (one LLM call per file, sequential)
//   6. combineHtmlFiles (for web missions — single self-contained HTML for
//      Arena srcdoc display)
//   7. Return: classification + structure + per-file content + combined HTML
//
// Body:
//   { mission: string, atlasIntel?: any }
//
// maxDuration = 180 — the pipeline makes 1 (classify) + 1 (PM) + 1 (Architect)
// + 1 (structure design) + N (per-file, where N is 4-8) LLM calls. With
// ~15-30s per call, the worst case is ~270s. We set 180s and rely on the
// per-call timeouts (15-45s) to keep us under the ceiling.
// ============================================================================

import type { NextRequest } from 'next/server';
import { runPM, runArchitect } from '@/lib/nova-llm-agents';
import { designFileStructure, type FileStructure } from '@/lib/multi-file-architect';
import { generateMultiFileProject, combineHtmlFiles } from '@/lib/multi-file-coder';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 180;

export async function POST(request: NextRequest): Promise<Response> {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  const mission: string | undefined = body?.mission;
  if (!mission || !mission.trim()) {
    return Response.json({ ok: false, error: 'Missing mission' }, { status: 400 });
  }

  const atlasIntel = body?.atlasIntel;
  const t0 = Date.now();

  try {
    // ─────────────────────────────────────────────────────────────────────
    // Stage 1: Classify the mission (SUB-K with inline fallback)
    // ─────────────────────────────────────────────────────────────────────
    let classification: any;
    let classificationSource: 'sub-k' | 'fallback' = 'fallback';
    try {
      const mod: any = await import('@/lib/mission-classifier').catch(() => null);
      if (mod && typeof mod.classifyMission === 'function') {
        classification = await mod.classifyMission(mission);
        classificationSource = 'sub-k';
      }
    } catch (err) {
      console.warn('[multi-file] SUB-K classifier failed, using inline fallback:', err instanceof Error ? err.message : String(err));
    }

    if (!classification) {
      // Inline keyword fallback — minimal shape compatible with downstream
      classification = inlineClassify(mission);
      classificationSource = 'fallback';
    }

    // ─────────────────────────────────────────────────────────────────────
    // Stage 2: PM agent (real LLM)
    // ─────────────────────────────────────────────────────────────────────
    const pmResult = await runPM(mission, { atlasIntel }).catch((err) => ({
      ok: false,
      degraded: true,
      output: null,
      error: err instanceof Error ? err.message : String(err),
    }));

    // ─────────────────────────────────────────────────────────────────────
    // Stage 3: Architect agent (real LLM)
    // ─────────────────────────────────────────────────────────────────────
    const archResult = await runArchitect(mission, (pmResult as any)?.output || {}, { atlasIntel }).catch((err) => ({
      ok: false,
      degraded: true,
      output: null,
      error: err instanceof Error ? err.message : String(err),
    }));

    // ─────────────────────────────────────────────────────────────────────
    // Stage 4: Design the multi-file structure (LLM or template)
    // ─────────────────────────────────────────────────────────────────────
    const fileStructure: FileStructure = await designFileStructure(
      classification,
      (pmResult as any)?.output,
    );

    // ─────────────────────────────────────────────────────────────────────
    // Stage 5: Generate every file (one LLM call per file, sequential)
    // ─────────────────────────────────────────────────────────────────────
    const coderResult = await generateMultiFileProject(
      mission,
      fileStructure,
      (pmResult as any)?.output,
      (archResult as any)?.output,
      { atlasIntel },
    );

    // ─────────────────────────────────────────────────────────────────────
    // Stage 6: For HTML missions, combine into a single self-contained
    // HTML for Arena srcdoc display (FORGE/VAULT keep files separate).
    // ─────────────────────────────────────────────────────────────────────
    let combinedHtml: string | null = null;
    const isWeb = classification.deliveryFormat === 'html' || classification.runtime === 'web';
    if (isWeb) {
      combinedHtml = combineHtmlFiles(coderResult.files.map((f) => ({ path: f.path, content: f.content })));
    }

    const durationMs = Date.now() - t0;

    return Response.json({
      ok: true,
      result: {
        mission,
        classification,
        classificationSource,
        pm: {
          ok: !!(pmResult as any)?.ok,
          degraded: !!(pmResult as any)?.degraded,
          output: (pmResult as any)?.output,
          ms: (pmResult as any)?.ms,
        },
        architect: {
          ok: !!(archResult as any)?.ok,
          degraded: !!(archResult as any)?.degraded,
          output: (archResult as any)?.output,
          ms: (archResult as any)?.ms,
        },
        fileStructure: {
          files: fileStructure.files,
          directories: fileStructure.directories,
          entryFile: fileStructure.entryFile,
          totalEstimatedLines: fileStructure.totalEstimatedLines,
          source: fileStructure.source,
          provider: fileStructure.provider,
          ms: fileStructure.ms,
        },
        files: coderResult.files.map((f) => ({
          path: f.path,
          content: f.content,
          language: f.language,
          lines: f.lines,
          chars: f.chars,
          source: f.source,
          ms: f.ms,
        })),
        totalLines: coderResult.totalLines,
        totalChars: coderResult.totalChars,
        fallbackCount: coderResult.fallbackCount,
        coderLog: coderResult.log,
        combinedHtml,
        isPlayable: !!classification.isPlayable,
        durationMs,
      },
    });
  } catch (err) {
    console.error('[multi-file] pipeline crashed:', err instanceof Error ? err.message : String(err));
    return Response.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - t0,
      },
      { status: 500 },
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Inline keyword classifier — used only if SUB-K's classifyMission fails.
// Same shape as MissionClassification so downstream code keeps working.
// ─────────────────────────────────────────────────────────────────────────────

function inlineClassify(mission: string): any {
  const m = mission.toLowerCase();
  const has = (kw: string[]) => kw.some((k) => m.includes(k));

  if (has(['snake', 'pong', 'tetris', 'breakout', 'chess', 'game', '2048', 'משחק', 'נחש', 'פונג', 'טטריס', 'שחמט'])) {
    return {
      type: 'game',
      subtype: m.includes('snake') || m.includes('נחש') ? 'snake'
        : m.includes('pong') || m.includes('פונג') ? 'pong'
        : m.includes('tetris') || m.includes('טטריס') ? 'tetris'
        : m.includes('chess') || m.includes('שחמט') ? 'chess'
        : 'general',
      deliveryFormat: 'html',
      runtime: 'web',
      title: 'Game',
      description: 'Browser game on HTML5 canvas.',
      controls: 'Arrow Keys / WASD · Space to pause · R to restart',
      entryFile: 'index.html',
      isPlayable: true,
      confidence: 0.6,
      llmReasoning: 'Inline keyword classifier — matched game keyword.',
      source: 'fallback',
      provider: 'none',
    };
  }

  if (has(['todo', 'app', 'application', 'calculator', 'notes', 'dashboard', 'website', 'page', 'frontend'])) {
    return {
      type: 'web-app',
      subtype: 'general',
      deliveryFormat: 'html',
      runtime: 'web',
      title: 'Web App',
      description: 'Interactive web application.',
      entryFile: 'index.html',
      isPlayable: true,
      confidence: 0.6,
      llmReasoning: 'Inline keyword classifier — matched web-app keyword.',
      source: 'fallback',
      provider: 'none',
    };
  }

  if (has(['api', 'rest', 'endpoint', 'server', 'http'])) {
    return {
      type: 'api',
      subtype: 'rest-crud',
      deliveryFormat: 'nodejs',
      runtime: 'js',
      title: 'API Server',
      description: 'Node.js HTTP API server.',
      entryFile: 'src/server.js',
      isPlayable: false,
      confidence: 0.6,
      llmReasoning: 'Inline keyword classifier — matched api keyword.',
      source: 'fallback',
      provider: 'none',
    };
  }

  if (has(['library', 'package', 'module', 'sdk'])) {
    return {
      type: 'library',
      subtype: 'general',
      deliveryFormat: 'nodejs',
      runtime: 'js',
      title: 'Library',
      description: 'Reusable Node.js library.',
      entryFile: 'src/index.js',
      isPlayable: false,
      confidence: 0.6,
      llmReasoning: 'Inline keyword classifier — matched library keyword.',
      source: 'fallback',
      provider: 'none',
    };
  }

  // Default: algorithm
  return {
    type: 'algorithm',
    subtype: 'general',
    deliveryFormat: 'nodejs',
    runtime: 'js',
    title: 'Algorithm',
    description: 'Node.js algorithm with stdout demo.',
    entryFile: 'src/index.js',
    isPlayable: false,
    confidence: 0.5,
    llmReasoning: 'Inline keyword classifier — default to algorithm.',
    source: 'fallback',
    provider: 'none',
  };
}
