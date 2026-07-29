// POST /api/nova/build-step — incremental build step (LLM-driven)
import type { NextRequest } from 'next/server';
import { llmChat, extractJSON } from '@/lib/nova-llm-agents';
import { buildIncrementally, applyIncremental } from '@/lib/incremental-builder';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 120;

export async function POST(request: NextRequest): Promise<Response> {
  let body: any;
  try { body = await request.json(); } catch {
    return Response.json({ ok: false, error: 'Invalid JSON' }, { status: 400 });
  }

  const project = body?.project;
  const userRequest: string | undefined = body?.request;

  if (!project || !userRequest || !userRequest.trim()) {
    return Response.json({ ok: false, error: 'Missing project or request' }, { status: 400 });
  }

  try {
    // Truncate file contents to prevent context overflow
    const truncatedProject = {
      ...project,
      files: project.files.map((f: any) => ({
        ...f,
        content: f.content.length > 2000 ? f.content.slice(0, 2000) + '\n// ... (truncated for context)' : f.content,
      })),
    };
    const result = await buildIncrementally(truncatedProject, userRequest, llmChat, extractJSON);
    const updatedProject = applyIncremental(project, result, userRequest);

    return Response.json({
      ok: true,
      project: updatedProject,
      step: updatedProject.history[updatedProject.history.length - 1],
    });
  } catch (err) {
    return Response.json({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    }, { status: 500 });
  }
}
