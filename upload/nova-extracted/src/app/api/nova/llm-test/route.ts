// POST /api/nova/llm-test
// ─────────────────────────────────────────────────────────────────────────────
// Run a SINGLE NOVA agent with the real LLM and return the full result —
// including thinking, raw output, provider, and tokens. This lets the user
// test individual agents in isolation and PROVE that the agents are actually
// thinking, not pattern-matching.
//
// Request body:
//   { agent: 'pm'|'architect'|'coder'|'qa'|'sec'|'rel', mission: string }
//
// Response: the full AgentResult
//   {
//     agentId, agentName, agentRole, employeeId,
//     output: <parsed JSON object — NOT a stringified blob>,
//     raw: <full LLM text>,
//     thinking: <reasoning before the JSON>,
//     ms, ok, provider, tokensUsed, degraded, fallbackReason, model
//   }
//
// The proof: when the LLM is available, `provider==='zai-sdk'`,
// `tokensUsed > 0`, `degraded===false`, and `output` is a parsed JSON object
// (not a string).
// ─────────────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server';
import { runAgent, type AgentId, type AgentContext } from '@/lib/nova-llm-agents';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 45;

const VALID_AGENTS: AgentId[] = ['pm', 'architect', 'coder', 'qa', 'sec', 'rel'];

export async function POST(request: NextRequest): Promise<Response> {
  const t0 = Date.now();

  try {
    const body = await request.json().catch(() => ({}));
    const agent = String(body?.agent || '').toLowerCase() as AgentId;
    const mission = String(body?.mission || '').trim();
    const atlasIntel = body?.atlasIntel || undefined;
    const learningContext = body?.learningContext
      ? String(body.learningContext)
      : undefined;
    const patterns = Array.isArray(body?.patterns) ? body.patterns : undefined;

    if (!VALID_AGENTS.includes(agent)) {
      return NextResponse.json(
        {
          error: `Invalid agent. Must be one of: ${VALID_AGENTS.join(', ')}`,
          received: agent || '(empty)',
        },
        { status: 400 }
      );
    }

    if (!mission) {
      return NextResponse.json(
        { error: 'Missing "mission" field in request body.' },
        { status: 400 }
      );
    }

    const context: AgentContext = {
      atlasIntel,
      learningContext,
      patterns,
    };

    const result = await runAgent(agent, mission, context);

    return NextResponse.json(
      {
        ...result,
        totalMs: Date.now() - t0,
        mission,
      },
      { status: 200 }
    );
  } catch (err) {
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
        totalMs: Date.now() - t0,
      },
      { status: 500 }
    );
  }
}

// GET — quick usage hint
export async function GET(): Promise<Response> {
  return NextResponse.json({
    usage: 'POST { agent: "pm"|"architect"|"coder"|"qa"|"sec"|"rel", mission: string }',
    example: {
      agent: 'pm',
      mission: 'fibonacci to 8',
    },
    note: 'When the LLM is available, the response will have provider="zai-sdk", tokensUsed > 0, degraded=false, and output will be a parsed JSON object.',
  });
}
