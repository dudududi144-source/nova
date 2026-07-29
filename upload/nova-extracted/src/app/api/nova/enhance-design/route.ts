// ============================================================================
// POST /api/nova/enhance-design — Forward-Thinking Design Generator
// ----------------------------------------------------------------------------
// SUB-FF-FORWARD-THINKING-DESIGN
//
// The "system thinks ahead about UX" layer. Takes a set of generated files
// (HTML game, web app, Node.js API, script, etc.) and SURGICALLY injects
// modern UX patterns that most AI code generators miss:
//
//   - Loading state (spinner + skeleton + progress bar)
//   - Error boundary (window.onerror + retry button)
//   - Empty state (no-data illustration + CTA)
//   - Micro-interactions (button hover/press, card lift, focus rings)
//   - Animations (fade-in, slide-up, scale-in, shimmer — reduced-motion aware)
//   - Dark mode (prefers-color-scheme + manual toggle with localStorage)
//   - Responsive breakpoints (@media, 44px touch targets, safe-area insets)
//   - Accessibility (skip-link, sr-only, focus management, ARIA labels)
//   - Game UX: pause-on-blur, keyboard shortcuts (Esc/R/M), restart confirm,
//     high-score confetti
//   - Node.js: graceful shutdown, env validation, input sanitization reminder,
//     health check endpoint, request logging
//
// No LLM is used — this is pure template injection. Fast (<5ms) and 100%
// reliable. Each enhancement is prefixed (`nova-`) so it never clashes with
// the host page's existing styles.
//
// Request:
//   POST /api/nova/enhance-design
//   {
//     mission: string,                                  // optional, for context
//     files: [{ path, content, language? }],           // REQUIRED
//     classification?: MissionClassificationLike        // optional
//   }
//
// Response (200):
//   {
//     ok: true,
//     mission: string,
//     files: [{ path, content, language }],
//     enhancements: string[],                          // human-readable list
//     enhancementCount: number,
//     assessment: { score, present, missing, perFile? },
//     checklist: [{ category, items: [{ name, applied }] }]
//   }
//
// Errors:
//   400 { ok: false, error: 'Missing or invalid "files"' }
//   500 { ok: false, error: string }
// ============================================================================

import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import {
  enhanceWithForwardThinking,
  getEnhancementChecklist,
  assessForwardThinking,
  formatEnhancementSummary,
  type InputFile,
  type MissionClassificationLike,
} from '@/lib/forward-thinking';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

interface EnhanceDesignRequest {
  mission?: unknown;
  files?: unknown;
  classification?: unknown;
}

export async function POST(request: NextRequest): Promise<Response> {
  try {
    const body: EnhanceDesignRequest = await request.json().catch(() => ({}) as EnhanceDesignRequest);

    // Validate files
    if (!Array.isArray(body.files) || body.files.length === 0) {
      return NextResponse.json(
        { ok: false, error: 'Missing or invalid "files" (expected non-empty array of { path, content })' },
        { status: 400 }
      );
    }

    const files: InputFile[] = [];
    for (const f of body.files) {
      if (!f || typeof f !== 'object') continue;
      const path = typeof (f as { path?: unknown }).path === 'string' ? (f as { path: string }).path : '';
      const content = typeof (f as { content?: unknown }).content === 'string' ? (f as { content: string }).content : '';
      const language = typeof (f as { language?: unknown }).language === 'string' ? (f as { language: string }).language : undefined;
      if (!path) continue;
      files.push({ path, content, language });
    }

    if (files.length === 0) {
      return NextResponse.json(
        { ok: false, error: 'No valid files provided (each file needs a "path" and "content" string)' },
        { status: 400 }
      );
    }

    const mission = typeof body.mission === 'string' ? body.mission : '';
    const classification = (body.classification && typeof body.classification === 'object'
      ? (body.classification as MissionClassificationLike)
      : null);

    // Pre-enhancement assessment (for the "before/after" diff)
    const beforeAssessment = assessForwardThinking(files);

    // Run the enhancer
    const { files: enhancedFiles, enhancements, assessment: afterAssessment } =
      await enhanceWithForwardThinking(files, classification);

    // Build the checklist with applied flags based on the after-assessment
    const checklistRaw = getEnhancementChecklist(classification);
    const presentSet = new Set(afterAssessment.present);
    const checklist = checklistRaw.map((cat) => ({
      category: cat.category,
      items: cat.items.map((it) => ({ name: it.name, applied: presentSet.has(it.name), description: it.description })),
    }));

    const delta = afterAssessment.score - beforeAssessment.score;

    return NextResponse.json({
      ok: true,
      mission,
      files: enhancedFiles,
      enhancements,
      enhancementCount: enhancements.length,
      enhancementSummary: formatEnhancementSummary(enhancements),
      assessment: afterAssessment,
      before: { score: beforeAssessment.score, presentCount: beforeAssessment.present.length, missingCount: beforeAssessment.missing.length },
      after: { score: afterAssessment.score, presentCount: afterAssessment.present.length, missingCount: afterAssessment.missing.length },
      delta,
      checklist,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { ok: false, error: `Enhance-design crashed: ${msg}` },
      { status: 500 }
    );
  }
}

// GET — usage hint for humans hitting the URL in a browser.
export async function GET(): Promise<Response> {
  return NextResponse.json({
    ok: true,
    endpoint: 'POST /api/nova/enhance-design',
    description:
      'Forward-Thinking Design Generator — surgically injects modern UX patterns (loading state, error boundary, empty state, micro-interactions, animations, dark mode, responsive, accessibility, game UX, graceful shutdown, env validation) into generated files. NO LLM used — pure template injection. Fast and reliable.',
    usage: {
      method: 'POST',
      body: {
        mission: 'string (optional, for context)',
        files: 'array of { path: string, content: string, language?: string } (REQUIRED, non-empty)',
        classification: 'MissionClassificationLike (optional — improves targeting: isGame, isWebApp, isApi)',
      },
      response: {
        ok: 'boolean',
        mission: 'echoed input',
        files: 'enhanced array of { path, content, language }',
        enhancements: 'array of human-readable strings describing each applied enhancement',
        enhancementCount: 'number',
        enhancementSummary: 'string — multi-line summary',
        assessment: { score: '0-10', present: 'string[]', missing: 'string[]', perFile: 'array of per-file assessments' },
        before: 'assessment of input files',
        after: 'assessment of enhanced files',
        delta: 'after.score - before.score',
        checklist: 'array of { category, items: [{ name, applied, description }] }',
      },
    },
    enhancementTypes: [
      'HTML: loading state, error boundary, empty state, micro-interactions, animations, dark mode, responsive, accessibility',
      'Game: pause-on-blur, keyboard shortcuts (Esc/R/M), restart confirmation, high-score confetti, shortcut hint',
      'Web App: performance polyfills (requestIdleCallback, debounce, throttle)',
      'Node.js: graceful shutdown (SIGINT/SIGTERM), env validation, input sanitization reminder',
      'API: health check endpoint (/health), request logging middleware',
      'Python: graceful shutdown via signal module',
    ],
    example: {
      request: {
        mission: 'build a snake game',
        files: [
          {
            path: 'index.html',
            content: '<!DOCTYPE html><html><head><title>Snake</title></head><body><canvas id="game"></canvas><script>/* game loop */</script></body></html>',
          },
        ],
        classification: { type: 'game', subtype: 'snake', deliveryFormat: 'html', isPlayable: true },
      },
      expect: 'enhanced index.html with loading state, dark mode toggle, keyboard shortcuts (Esc/R/M), pause-on-blur, error boundary, animations, accessibility, responsive, high-score confetti',
    },
    notes: [
      'All injected CSS uses the `nova-` prefix to avoid clashing with existing styles.',
      'Features that already exist are skipped (no duplication).',
      'Non-HTML/Node files are passed through unchanged.',
      'All animations respect prefers-reduced-motion.',
    ],
  });
}
