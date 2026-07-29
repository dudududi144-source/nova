// POST /api/nova/deploy — Deploy generated HTML to a public URL
// Takes the HTML content + mission, saves it to public/deployed/<id>.html
// Returns the public URL the user can open.
//
// This is a simple, instant deploy — no servers, no build, no waiting.
// The HTML is saved to public/deployed/ and served by Next.js static serving.
import type { NextRequest } from 'next/server';
import * as fs from 'node:fs';
import * as path from 'node:path';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: NextRequest): Promise<Response> {
  let body: any;
  try { body = await request.json(); } catch {
    return Response.json({ ok: false, error: 'Invalid JSON' }, { status: 400 });
  }

  const html: string | undefined = body?.html;
  const mission: string | undefined = body?.mission;
  if (!html || !html.trim()) {
    return Response.json({ ok: false, error: 'Missing html content' }, { status: 400 });
  }

  try {
    // Generate a short ID from mission hash
    const id = `${Date.now().toString(36)}_${(mission || 'app').slice(0, 20).replace(/[^a-zA-Z0-9]/g, '_').toLowerCase()}`;
    const deployDir = path.join(process.cwd(), 'public', 'deployed');
    fs.mkdirSync(deployDir, { recursive: true });

    const filePath = path.join(deployDir, `${id}.html`);
    fs.writeFileSync(filePath, html, 'utf-8');

    // Build the public URL — use the request origin
    const origin = request.headers.get('origin') || request.headers.get('host') || 'http://localhost:3000';
    const protocol = origin.startsWith('http') ? '' : 'http://';
    const url = `${protocol}${origin}/deployed/${id}.html`;

    return Response.json({
      ok: true,
      id,
      url,
      deployedAt: new Date().toISOString(),
      size: html.length,
    });
  } catch (err) {
    return Response.json({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    }, { status: 500 });
  }
}
