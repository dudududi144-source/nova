// POST /api/nova/forge-build — REAL pipeline that uses FORGE for everything
//
// NOVA generates code → sends to FORGE → FORGE creates project → runs real workflows → publishes to VAULT
// Everything is REAL: real project, real build, real test, real release.
//
// Request: { mission, atlasIntel? }
// Response: { project, runs, release, files, pipeline }
import type { NextRequest } from 'next/server';
import { pmAgentReal, architectAgentReal, coderAgentReal } from '@/lib/nova-real-workspace';

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

    const pipeline: any[] = [];

    // ══ 1. PM — analyze mission ══
    const pmResult = pmAgentReal(mission, atlasIntel);
    pipeline.push({ agent: 'pm', ...pmResult });

    // ══ 2. Architect — design structure ══
    const archResult = architectAgentReal(pmResult, mission);
    pipeline.push({ agent: 'architect', ...archResult });

    // ══ 3. Coder — generate code ══
    const coderResult = coderAgentReal(mission, pmResult, archResult);
    pipeline.push({ agent: 'coder', ...coderResult });

    // Get the source code
    const sourceFile = coderResult.files?.find(f => f.path === 'src/index.js');
    const source = sourceFile?.content || '';

    // ══ 4. FORGE — create REAL project ══
    pipeline.push({ agent: 'forge-create', success: false, output: 'starting', ms: 0 });

    let project: any = null;
    let forgeProjectId: string | null = null;

    try {
      const forgeRes = await fetch('http://localhost:3000/api/forge/from-source', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source,
          name: `nova-${Date.now()}`,
          origin: 'nova',
          template: 'node',
        }),
      });
      const forgeData = await forgeRes.json();
      project = forgeData.project;
      forgeProjectId = project?.id || null;

      pipeline[pipeline.length - 1] = {
        agent: 'forge-create',
        success: !!project,
        output: project ? `FORGE created project: ${project.id} · ${project.fileCount} files · kind: ${project.kind}` : `FORGE failed: ${forgeData.error}`,
        ms: Date.now() - t0,
        projectId: forgeProjectId,
      };
    } catch (err) {
      pipeline[pipeline.length - 1] = {
        agent: 'forge-create',
        success: false,
        output: `FORGE error: ${err instanceof Error ? err.message : String(err)}`,
        ms: Date.now() - t0,
      };
    }

    if (!forgeProjectId) {
      return Response.json({
        mission,
        pipeline,
        error: 'FORGE project creation failed',
        totalMs: Date.now() - t0,
      });
    }

    // ══ 5. FORGE — run REAL build workflow ══
    const buildResult = await runForgeWorkflow(forgeProjectId, 'build');
    pipeline.push({ agent: 'forge-build', ...buildResult });

    // ══ 6. FORGE — run REAL test workflow ══
    const testResult = await runForgeWorkflow(forgeProjectId, 'test');
    pipeline.push({ agent: 'forge-test', ...testResult });

    // ══ 7. FORGE — run REAL lint workflow ══
    const lintResult = await runForgeWorkflow(forgeProjectId, 'lint');
    pipeline.push({ agent: 'forge-lint', ...lintResult });

    // ══ 8. FORGE — run REAL security-scan ══
    const secResult = await runForgeWorkflow(forgeProjectId, 'security-scan');
    pipeline.push({ agent: 'forge-security', ...secResult });

    // ══ 9. VAULT — publish REAL release ══
    let release: any = null;
    const allPassed = buildResult.success && testResult.success;

    if (allPassed) {
      try {
        // Find the build run to publish from
        const runsRes = await fetch(`http://localhost:3000/api/forge/runs/list?projectId=${forgeProjectId}`);
        const runsData = await runsRes.json();
        const buildRun = runsData.runs?.find((r: any) => r.workflow === 'build' && r.status === 'success');

        if (buildRun) {
          const vaultRes = await fetch('http://localhost:3000/api/vault/releases', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              runId: buildRun.id,
              version: '1.0.0',
              channel: 'stable',
              autoSign: true,
              origin: 'nova',
              notes: `NOVA generated · ${mission.slice(0, 80)}\n\nBuild: success\nTest: ${testResult.success ? 'success' : 'failed'}\nLint: ${lintResult.success ? 'success' : 'failed'}`,
            }),
          });
          const vaultData = await vaultRes.json();
          release = vaultData.release;
          pipeline.push({
            agent: 'vault-publish',
            success: !!release,
            output: release ? `VAULT published: ${release.version} · signed: ${release.signed} · ${release.artifactCount} artifacts` : `VAULT failed: ${vaultData.error}`,
            ms: Date.now() - t0,
          });
        } else {
          pipeline.push({ agent: 'vault-publish', success: false, output: 'No successful build run to publish', ms: 0 });
        }
      } catch (err) {
        pipeline.push({ agent: 'vault-publish', success: false, output: `VAULT error: ${err}`, ms: 0 });
      }
    } else {
      pipeline.push({ agent: 'vault-publish', success: false, output: 'Skipped — build/test failed', ms: 0 });
    }

    // ══ Result ══
    return Response.json({
      mission,
      project: { id: forgeProjectId, name: project?.name, kind: project?.kind, fileCount: project?.fileCount },
      runs: {
        build: buildResult,
        test: testResult,
        lint: lintResult,
        security: secResult,
      },
      release,
      files: coderResult.files,
      pipeline,
      allPassed,
      totalMs: Date.now() - t0,
    });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err), totalMs: Date.now() - t0 },
      { status: 500 }
    );
  }
}

// Helper: run a FORGE workflow and wait for result
async function runForgeWorkflow(projectId: string, workflow: string): Promise<{ success: boolean; output: string; runId: string | null; status: string; exitCode: number | null; ms: number }> {
  const t0 = Date.now();
  try {
    // Start the run
    const startRes = await fetch('http://localhost:3000/api/forge/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId, workflow }),
    });
    const startData = await startRes.json();
    const runId = startData.runId;

    if (!runId) {
      return { success: false, output: `Failed to start ${workflow}: ${startData.error}`, runId: null, status: 'failed', exitCode: null, ms: Date.now() - t0 };
    }

    // Poll for completion (max 15 seconds)
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 500));
      try {
        const checkRes = await fetch(`http://localhost:3000/api/forge/runs/${runId}`);
        const checkData = await checkRes.json();
        const run = checkData.run || checkData;
        const status = run.status;

        if (status === 'success' || status === 'failed' || status === 'error') {
          const success = status === 'success';
          return {
            success,
            output: `${workflow}: ${status} · exit=${run.exitCode} · ${run.durationMs || 0}ms`,
            runId,
            status,
            exitCode: run.exitCode,
            ms: Date.now() - t0,
          };
        }
      } catch {
        // continue polling
      }
    }

    return { success: false, output: `${workflow}: timeout (15s)`, runId, status: 'timeout', exitCode: null, ms: Date.now() - t0 };
  } catch (err) {
    return { success: false, output: `${workflow}: error — ${err}`, runId: null, status: 'error', exitCode: null, ms: Date.now() - t0 };
  }
}
