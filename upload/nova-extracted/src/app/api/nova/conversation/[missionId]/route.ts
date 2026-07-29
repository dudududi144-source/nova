// GET /api/nova/conversation/[missionId] — full agent conversation for a mission
// ----------------------------------------------------------------------------
// Returns the multi-turn agent-to-agent conversation stored in the
// AgentConversation table, with reply chains resolved.
//
// Query params:
//   format=full     (default) — returns { missionId, conversation: FormattedTurn[], raw: AgentConversationRow[], summary }
//   format=summary            — returns { missionId, summary } only (plaintext)
//
// Response (format=full):
//   {
//     ok: true,
//     missionId: string,
//     correlationId: string,
//     turnCount: number,
//     agentCount: number,
//     llmTurnCount: number,
//     durationMs: number,
//     conversation: FormattedTurn[],   // UI-ready with reply chains
//     raw: AgentConversationRow[],     // raw DB rows
//     summary: string                  // plaintext multi-line summary
//   }
//
// If no conversation exists for this mission, returns ok:true with empty arrays
// (so the UI can render an empty state without erroring).
import type { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { formatConversationForUI, type AgentConversationRow } from '@/lib/agent-conversation';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function rowToCanonical(r: any): AgentConversationRow {
  return {
    id: r.id,
    missionId: r.missionId,
    correlationId: r.correlationId,
    turn: r.turn,
    agentId: r.agentId,
    agentName: r.agentName,
    agentRole: r.agentRole,
    messageType: r.messageType,
    content: r.content,
    thinking: r.thinking,
    replyTo: r.replyTo,
    isLLM: r.isLLM,
    llmProvider: r.llmProvider,
    tokensUsed: r.tokensUsed,
    ts: r.ts instanceof Date ? r.ts : new Date(r.ts),
  };
}

function buildSummary(rows: AgentConversationRow[], missionId: string): string {
  if (rows.length === 0) return `=== Agent Conversation · mission ${missionId} · (empty) ===`;
  const correlationId = rows[0].correlationId || '';
  const agents = new Set(rows.map(r => r.agentName)).size;
  const llmTurns = rows.filter(r => r.isLLM).length;
  const lines: string[] = [];
  lines.push(`=== Agent Conversation · mission ${missionId} · corr ${correlationId} ===`);
  lines.push(`Turns: ${rows.length} · Agents: ${agents} · LLM: ${llmTurns} turns`);
  lines.push('');
  for (const r of rows) {
    const replyTag = r.replyTo ? ` (re:${r.replyTo})` : '';
    lines.push(`[${r.turn}] ${r.agentName} (${r.agentRole}) · ${r.messageType}${replyTag}`);
    lines.push(`    ${r.content}`);
    if (r.thinking) lines.push(`    _thinking: ${r.thinking}_`);
    lines.push('');
  }
  return lines.join('\n');
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ missionId: string }> },
): Promise<Response> {
  const t0 = Date.now();
  try {
    const { missionId } = await params;
    if (!missionId) {
      return Response.json({ ok: false, error: 'Missing missionId' }, { status: 400 });
    }

    const url = new URL(_request.url);
    const format = (url.searchParams.get('format') ?? 'full').toLowerCase();

    const rawRows = await db.agentConversation.findMany({
      where: { missionId },
      orderBy: { turn: 'asc' },
    });

    const rows = rawRows.map(rowToCanonical);
    const correlationId = rows[0]?.correlationId ?? '';
    const agentCount = new Set(rows.map(r => r.agentName)).size;
    const llmTurnCount = rows.filter(r => r.isLLM).length;

    // Duration: from first to last turn ts
    let durationMs = 0;
    if (rows.length >= 2) {
      const first = rows[0].ts instanceof Date ? rows[0].ts.getTime() : new Date(rows[0].ts).getTime();
      const last = rows[rows.length - 1].ts instanceof Date ? rows[rows.length - 1].ts.getTime() : new Date(rows[rows.length - 1].ts).getTime();
      durationMs = Math.max(0, last - first);
    }

    const summary = buildSummary(rows, missionId);

    if (format === 'summary') {
      return Response.json({
        ok: true,
        missionId,
        correlationId,
        turnCount: rows.length,
        agentCount,
        llmTurnCount,
        durationMs,
        summary,
      });
    }

    const conversation = formatConversationForUI(rows);

    return Response.json({
      ok: true,
      missionId,
      correlationId,
      turnCount: rows.length,
      agentCount,
      llmTurnCount,
      durationMs,
      conversation,
      raw: rows,
      summary,
      ms: Date.now() - t0,
    });
  } catch (err) {
    console.error('[/api/nova/conversation/[missionId]] failed:', err instanceof Error ? err.message : String(err));
    return Response.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        ms: Date.now() - t0,
      },
      { status: 500 },
    );
  }
}
