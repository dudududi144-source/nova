// POST /api/nova/refine — Iterative Refinement
// Takes an existing mission + files + a refinement request (e.g. "make it blue")
// and runs the LLM to modify the existing files. Returns the updated files.
//
// This is NOT a full rebuild — it's a targeted modification of existing code.
// The LLM receives the existing files + the refinement request and produces
// updated versions of only the affected files.
import type { NextRequest } from 'next/server';
import { newMissionId, newCorrelationId, emitMissionEvent } from '@/lib/mission-stream';
import { llmChat, extractJSON } from '@/lib/nova-llm-agents';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 120;

export async function POST(request: NextRequest): Promise<Response> {
  let body: any;
  try { body = await request.json(); } catch {
    return Response.json({ ok: false, error: 'Invalid JSON' }, { status: 400 });
  }

  const mission: string | undefined = body?.mission;
  const files: any[] | undefined = body?.files; // existing files [{path, content}]
  const refineRequest: string | undefined = body?.refineRequest; // "make it blue"

  if (!mission || !files || !Array.isArray(files) || files.length === 0) {
    return Response.json({ ok: false, error: 'Missing mission, files, or refineRequest' }, { status: 400 });
  }
  if (!refineRequest || !refineRequest.trim()) {
    return Response.json({ ok: false, error: 'Missing refineRequest' }, { status: 400 });
  }

  const missionId = newMissionId('rf');
  const correlationId = newCorrelationId('refine');

  // Stream events for UI
  const emit = async (eventType: string, payload: any) => {
    try { await emitMissionEvent(missionId, correlationId, eventType, payload, {}); } catch {}
  };

  // Run in background
  setImmediate(async () => {
    await emit('mission.start', { mission: `Refine: ${refineRequest}`, pipeline: 'nova-refine', stages: 2 });

    try {
      await emit('agent.thinking', { agentId: 'refiner', agentName: 'Refiner', detail: `Refining: ${refineRequest}` });

      // Build the refinement prompt
      const filesSummary = files.map(f => `- ${f.path} (${(f.content || '').split('\n').length} lines)`).join('\n');
      const filesContent = files.map(f => `--- ${f.path} ---\n${f.content}\n`).join('\n\n');

      const sys = `You are a senior developer. The user has an existing project and wants to refine it.
Your job: modify ONLY the files that need to change based on the refinement request.
Keep all other files unchanged. Return the COMPLETE updated content for each modified file.

Output JSON ONLY:
{
  "files": [
    {"path": "filename", "content": "complete updated file content", "modified": true}
  ],
  "summary": "what you changed and why"
}`;

      const user = `Original mission: "${mission}"

Refinement request: "${refineRequest}"

Existing files:
${filesSummary}

Full file contents:
${filesContent}

Apply the refinement request. Return the COMPLETE content of each file that needs to change.
If a file doesn't need to change, don't include it in the output.`;

      const result = await llmChat(sys, user, { maxTokens: 8000, temperature: 0.3, timeoutMs: 60000 });

      if (!result.ok) {
        await emit('mission.fail', { error: `LLM error: ${result.error}`, missionId });
        await emit('mission.complete', { missionId, success: false, error: result.error, files: [], pipeline: 'nova-refine' });
        return;
      }

      // Extract files from LLM response
      let updatedFiles: any[] = [];
      const { json } = extractJSON(result.text);
      if (json && Array.isArray(json.files)) {
        updatedFiles = json.files.filter((f: any) => f.path && f.content);
      } else {
        // Try to parse as raw files (LLM might return without JSON)
        // Fallback: if LLM returned raw text, treat it as a single file update
        const text = result.text.trim();
        if (text.length > 50) {
          updatedFiles = [{ path: files[0].path, content: text, modified: true }];
        }
      }

      // Merge: keep unchanged files, replace modified ones
      const finalFiles = files.map(orig => {
        const updated = updatedFiles.find((u: any) => u.path === orig.path);
        return updated ? { ...orig, content: updated.content } : orig;
      });

      // Add any new files from the refinement
      for (const u of updatedFiles) {
        if (!finalFiles.find(f => f.path === u.path)) {
          finalFiles.push({ path: u.path, content: u.content, language: 'text' });
        }
      }

      await emit('agent.message', {
        agentId: 'refiner', agentName: 'Refiner',
        message: `Refined ${updatedFiles.length} file(s): ${json?.summary || refineRequest}`,
      });

      // Emit file.built events for each modified file
      for (const f of finalFiles) {
        await emit('file.built', { path: f.path, lines: (f.content || '').split('\n').length, content: f.content });
      }

      await emit('mission.complete', {
        missionId,
        success: true,
        files: finalFiles,
        allRepoFiles: finalFiles,
        qualityScore: 7.0, // refinement doesn't re-evaluate quality
        durationMs: 0,
        pipeline: 'nova-refine',
        classification: { title: `Refined: ${refineRequest}` },
      });
    } catch (err: any) {
      await emit('mission.fail', { error: err.message, missionId });
      await emit('mission.complete', { missionId, success: false, error: err.message, files: [], pipeline: 'nova-refine' });
    }
  });

  return Response.json({
    ok: true,
    missionId,
    correlationId,
    streamUrl: `/api/nova/mission-events/${missionId}`,
    status: 'started',
    pipeline: 'nova-refine',
  });
}
