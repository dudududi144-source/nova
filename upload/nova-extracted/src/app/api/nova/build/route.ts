// POST /api/nova/build — REAL agent pipeline that does actual work
//
// This is NOT the regex/template pipeline. Agents:
// 1. PM writes spec.md to disk
// 2. Architect writes architecture.md to disk
// 3. Coder writes src/index.js + test/acceptance.test.js + package.json to disk
// 4. QA runs `node src/index.js` and `node test/acceptance.test.js`, iterates if fails
// 5. Security scans all JS files
//
// Returns: workspace path, all files, test results, agent transcript
import type { NextRequest } from 'next/server';
import { runRealPipeline } from '@/lib/nova-real-workspace';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(request: NextRequest): Promise<Response> {
  const t0 = Date.now();
  try {
    const { mission, atlasIntel } = await request.json();
    if (!mission || !mission.trim()) {
      return Response.json({ error: 'Missing mission' }, { status: 400 });
    }

    // Run the REAL pipeline — agents write files, execute commands, iterate
    const result = await runRealPipeline(mission, atlasIntel);

    return Response.json({
      mission,
      workspace: result.workspace,
      files: result.files,
      pipeline: result.pipeline.map(p => ({
        agent: p.agent,
        success: p.success,
        output: p.output,
        iterations: p.iterations,
        ms: p.ms,
        filesWritten: p.files?.length || 0,
      })),
      finalResult: result.finalResult,
      totalMs: Date.now() - t0,
    });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err), totalMs: Date.now() - t0 },
      { status: 500 }
    );
  }
}
