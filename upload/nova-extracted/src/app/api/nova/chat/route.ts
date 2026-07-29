// POST /api/nova/chat — Per-project AI Chat with live code changes
import type { NextRequest } from 'next/server';
import { llmChat, extractJSON } from '@/lib/llm';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(request: NextRequest): Promise<Response> {
  let body: any;
  try { body = await request.json(); } catch {
    return Response.json({ ok: false, error: 'Invalid JSON' }, { status: 400 });
  }

  const mission: string = String(body?.mission || '').trim();
  const files: any[] = Array.isArray(body?.files) ? body.files : [];
  const message: string = String(body?.message || '').trim();
  const history: any[] = Array.isArray(body?.history) ? body.history : [];

  if (!message) {
    return Response.json({ ok: false, error: 'Missing message' }, { status: 400 });
  }

  // Build project context
  const MAX_INLINE = 800;
  const fileCtx = files.map(f => {
    const content = String(f?.content || '');
    if (content.length <= MAX_INLINE) return `--- ${f.path} (${content.split('\n').length} lines) ---\n${content}`;
    const head = content.split('\n').slice(0, 40).join('\n');
    return `--- ${f.path} (${content.split('\n').length} lines, showing first 40) ---\n${head}\n...`;
  }).join('\n\n');

  const histText = history.slice(-16).map((m: any) => {
    const role = m?.role === 'user' ? 'User' : 'Assistant';
    return `${role}: ${String(m?.content || '').slice(0, 800)}`;
  }).join('\n\n');

  const changeWords = /\b(make|change|add|remove|update|fix|rename|refactor|implement|create|build|replace|convert|redesign|modify)\b/i;
  const questionWords = /\b(what|why|how|explain|which|is|are|does|do|can|should|would|tell me)\b/i;
  const wantsChange = changeWords.test(message) && message.length < 200 && !questionWords.test(message.split(' ').slice(0, 3).join(' '));

  const sys = `You are NOVA, an AI pair programmer in a code IDE.
The user has an active project. You see their files + chat history.

When the user asks for a CODE CHANGE ("make it blue", "add dark mode"):
- Return JSON ONLY: {"reply": "short summary", "files": [{"path": "name", "content": "COMPLETE updated file"}]}
- Only include files that changed. Each file must have COMPLETE content.

When the user asks a QUESTION ("explain", "what does X do"):
- Return plain text (markdown ok). Be clear and concise.`;

  const user = `# Project: "${mission}"

# Current files (${files.length}):
${fileCtx || '(no files)'}

${history.length > 0 ? `# Conversation\n${histText}\n` : ''}

# User message
${message}`;

  const result = await llmChat(sys, user, { maxTokens: 6000, temperature: 0.4, timeoutMs: 45000 });

  if (!result.ok) {
    return Response.json({ ok: false, error: `LLM error: ${result.error}` }, { status: 502 });
  }

  const text = result.text.trim();
  let reply: string | null = null;
  let updatedFiles: any[] = [];

  const { json } = extractJSON(text);
  if (json && typeof json.reply === 'string') {
    reply = json.reply;
    if (Array.isArray(json.files)) {
      updatedFiles = json.files.filter((f: any) => f.path && typeof f.content === 'string');
    }
  }

  if (reply === null) {
    reply = text;
  }

  return Response.json({
    ok: true,
    reply,
    files: updatedFiles,
    appliedChanges: updatedFiles.length > 0,
    tokens: result.tokens,
    ms: result.ms,
  });
}
