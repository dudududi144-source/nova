// ============================================================================
// POST /api/nova/visual-quality — Visual Quality Assessment Endpoint
// ----------------------------------------------------------------------------
// SUB-DD-VISUAL-QUALITY-ASSESSMENT
//
// Body: { mission, files: [{path, content}], classification? }
// Returns: VisualQualityReport — 8 visual design dimensions + recommendations
//
// This is the "system cares about DESIGN, not just code" layer.
// Pure static analysis — no LLM call, sub-100ms latency.
//
// Example (good HTML):
//   POST { mission: "snake game",
//          files: [{ path: "index.html", content: "<full snake game w/ CSS>" }],
//          classification: { type: "game", deliveryFormat: "html" } }
//   → overallVisual: 7-9, screenshotWorthy: true
//
// Example (bad HTML):
//   POST { mission: "hello world",
//          files: [{ path: "index.html", content: "<html><body>hello</body></html>" }],
//          classification: { type: "game", deliveryFormat: "html" } }
//   → overallVisual: 1-3, screenshotWorthy: false
//
// Example (non-visual):
//   POST { mission: "fibonacci",
//          files: [{ path: "fib.js", content: "function fib(n){...}" }],
//          classification: { type: "algorithm", deliveryFormat: "node" } }
//   → overallVisual: 5.0 (neutral — not applicable), mode: "non-visual"
//
// GET /api/nova/visual-quality → info endpoint
// ============================================================================

import type { NextRequest } from 'next/server';
import {
  assessVisualQuality,
  combineQualityScores,
  type VisualQualityReport,
  type VisualFile,
} from '@/lib/visual-quality';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
// Pure static analysis — no LLM, no network. Sub-100ms.
export const maxDuration = 10;

interface VisualQualityBody {
  mission?: string;
  files?: { path: string; content: string; language?: string }[];
  classification?: {
    type?: string;
    deliveryFormat?: string;
    isPlayable?: boolean;
    [k: string]: any;
  } | null;
  /** Optional: existing SUB-U code quality score, to combine with visual. */
  codeQualityScore?: number;
  /** Optional: weight of visual score in the combined (default 0.5 = 50/50). */
  visualWeight?: number;
}

export async function POST(request: NextRequest): Promise<Response> {
  const t0 = Date.now();

  try {
    const body = (await request.json().catch(() => ({}))) as VisualQualityBody;

    // Validate files
    if (!Array.isArray(body.files) || body.files.length === 0) {
      return Response.json(
        { ok: false, error: 'Missing "files" array (required: at least one {path, content})' },
        { status: 400 },
      );
    }

    const validFiles: VisualFile[] = body.files.filter(
      (f): f is VisualFile =>
        !!f &&
        typeof f.path === 'string' &&
        typeof f.content === 'string',
    );

    if (validFiles.length === 0) {
      return Response.json(
        { ok: false, error: 'files[] provided but no valid {path, content} entries' },
        { status: 400 },
      );
    }

    const mission = (body.mission ?? '').slice(0, 200);
    console.log(
      `[nova/visual-quality] mission="${mission}" files=${validFiles.length} ` +
      `type=${body.classification?.type ?? 'unknown'} format=${body.classification?.deliveryFormat ?? 'unknown'}`,
    );

    // Run the visual assessment
    const report: VisualQualityReport = await assessVisualQuality(
      validFiles,
      body.classification ?? null,
    );

    // Optionally combine with SUB-U code quality score
    let combined: ReturnType<typeof combineQualityScores> | null = null;
    if (typeof body.codeQualityScore === 'number' && !Number.isNaN(body.codeQualityScore)) {
      combined = combineQualityScores(
        body.codeQualityScore,
        report,
        body.visualWeight,
      );
    }

    return Response.json({
      ok: true,
      mission,
      classification: body.classification ?? null,
      report,
      combined: combined ?? null,
      totalMs: Date.now() - t0,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : null;
    console.error('[nova/visual-quality] FATAL:', msg, stack);
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
    endpoint: '/api/nova/visual-quality',
    method: 'POST',
    description:
      'Visual design quality assessment — 8 dimensions, pure static analysis, no LLM. ' +
      'Pairs with SUB-U code quality (averaged 50/50) to produce true overall quality.',
    dimensions: [
      {
        name: 'colorScheme',
        description: 'Color palette — gradients, rgba/oklch, CSS variables, dark mode',
        signals: ['linear-gradient()', 'rgba()', 'oklch()', 'var(--*)', 'prefers-color-scheme: dark'],
      },
      {
        name: 'layout',
        description: 'Layout system — flexbox, grid, padding/margin, max-width containers',
        signals: ['display: flex', 'display: grid', 'gap:', 'max-width:', 'max-w-*'],
      },
      {
        name: 'typography',
        description: 'Type system — font-family, size hierarchy, line-height, web fonts',
        signals: ['font-family:', 'font-size:', 'line-height:', 'fonts.googleapis.com', 'text-{xs..9xl}'],
      },
      {
        name: 'responsiveness',
        description: 'Mobile-friendly — viewport meta, @media queries, relative units',
        signals: ['<meta viewport>', '@media ()', 'rem/em/vw', 'sm:/md:/lg:'],
      },
      {
        name: 'accessibility',
        description: 'A11y — aria-label, alt, role, semantic HTML, aria-live',
        signals: ['aria-label=', 'alt=', 'role=', '<main>/<nav>/<section>', 'aria-live='],
      },
      {
        name: 'modernAesthetics',
        description: 'Modern look — backdrop-filter, box-shadow, border-radius, animations',
        signals: ['backdrop-filter:', 'box-shadow:', 'border-radius:', '@keyframes', 'transition:'],
      },
      {
        name: 'visualPolish',
        description: 'Polish — SVG icons, icon library, :hover, :focus, cursor:pointer',
        signals: ['<svg>', 'lucide', ':hover', ':focus-visible', 'cursor: pointer'],
      },
      {
        name: 'userExperience',
        description: 'UX flow — CTAs, loading states, error states, toasts, disabled',
        signals: ['<button>', 'loading', 'error', 'toast', 'disabled'],
      },
    ],
    rubric: {
      '0-2': 'completely missing (no CSS / no responsive / no a11y)',
      '3-4': 'basic (some styling, but amateur — default fonts, raw colors)',
      '5-6': 'decent (proper layout, some modern features)',
      '7-8': 'good (responsive, accessible, modern, polished)',
      '9-10': 'exceptional (gradients, animations, perfect a11y, premium feel)',
    },
    screenshotWorthyRule: 'overallVisual >= 7.5 AND modernAesthetics >= 7',
    combinationRule:
      'combined = codeQuality × (1 - w) + visualQuality × w (default w = 0.5). ' +
      'Non-visual output (algorithm/api): combined = codeQuality unchanged.',
    example: {
      goodSnakeGame: {
        mission: 'build a snake game',
        files: [{ path: 'index.html', content: '<!DOCTYPE html>...<style>gradient, flex, @media...</style>...' }],
        classification: { type: 'game', deliveryFormat: 'html' },
        codeQualityScore: 8.5,
        visualWeight: 0.5,
      },
      bareHtml: {
        mission: 'hello world',
        files: [{ path: 'index.html', content: '<html><body>hello</body></html>' }],
        classification: { type: 'game', deliveryFormat: 'html' },
      },
      algorithm: {
        mission: 'fibonacci',
        files: [{ path: 'fib.js', content: 'function fib(n){ return n<2?n:fib(n-1)+fib(n-2) }' }],
        classification: { type: 'algorithm', deliveryFormat: 'node' },
      },
    },
  });
}
