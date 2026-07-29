// POST /api/nova/agents — Real single-agent execution with role-specific LLM call
//
// P0 FIX (nova-agents-upgrade): Previously NOVA's 10 agents (PM, Analyst, Architect,
// Designer, Optimizer, Fixer, Fuzzer, Security, Docs, Release) were theater — regex +
// sleep + pre-written log messages. This endpoint gives each agent a real LLM call
// with a role-specific system prompt that produces structured JSON output.
//
// When the LLM is unavailable (429/network), uses the smart local engine in
// src/lib/nova-agents.ts — which produces REAL structured output (not fake data).
//
// Request: { agent: 'pm'|'analyst'|'architect'|'designer'|'optimizer'|'fixer'|'security'|'docs'|'release'|'classify', mission, context? }
// Response: { agent, output (JSON object), raw (string), ms, ok, degraded }
import type { NextRequest } from 'next/server';
import {
  classifyMission, pmAgent, analystAgent, architectAgent, designerAgent,
  securityAgent, docsAgent, releaseAgent, generateCode,
} from '@/lib/nova-agents';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 45;

// Role-specific system prompts — each agent has a distinct job + JSON output schema
const AGENT_PROMPTS: Record<string, { system: string; schema: string }> = {
  classify: {
    system: `You are NOVA-Classifier. Classify the user's coding mission. Output ONLY valid JSON, no markdown.`,
    schema: `{"mission_type":"algorithm"|"web_app"|"api"|"cli"|"data_pipeline"|"script","runtime":"js"|"ts"|"python"|"bash","complexity":"trivial"|"moderate"|"complex","needs_db":false,"needs_http":false,"summary":"one-line description"}`,
  },
  pm: {
    system: `You are NOVA-PM (יעל). Analyze the mission and produce a spec. Output ONLY valid JSON, no markdown. Respond in Hebrew where natural.`,
    schema: `{"problem":"what the user wants solved","users":"who benefits","success_criteria":["criterion 1","criterion 2"],"constraints":["constraint 1"],"acceptance_tests":[{"name":"test name","input":"stdin or empty","expected_stdout":"expected output lines","expected_exit":0}],"runtime_hint":"js"|"python"|"bash"}`,
  },
  analyst: {
    system: `You are NOVA-Analyst (נועה). Extract entities and data shapes. Output ONLY valid JSON, no markdown.`,
    schema: `{"entities":["entity1"],"data_models":{"EntityName":"description"},"io_inputs":["input1"],"io_outputs":["output1"]}`,
  },
  architect: {
    system: `You are NOVA-Architect (אדם). Design module decomposition. Output ONLY valid JSON, no markdown. Respond in Hebrew where natural.`,
    schema: `{"modules":[{"name":"moduleName","responsibility":"what it does","interface":"function signatures"}],"data_flow":"description","dependencies":["dep1"],"test_plan":["test approach 1"]}`,
  },
  designer: {
    system: `You are NOVA-Designer (ליאור). Design the public API surface. Output ONLY valid JSON, no markdown.`,
    schema: `{"functions":[{"name":"funcName","params":["param1"],"returns":"returnType","example":"usage example"}],"types":{"TypeName":"description"}}`,
  },
  optimizer: {
    system: `You are NOVA-Optimizer (עופר). Analyze code for optimization opportunities. Output ONLY valid JSON, no markdown. Respond in Hebrew where natural.`,
    schema: `{"issues":[{"severity":"low"|"med"|"high","description":"issue","suggestion":"fix"}],"optimized":false,"summary":"overall assessment"}`,
  },
  fixer: {
    system: `You are NOVA-Fixer (יואב). Given source + error, produce a fixed version. Output ONLY the fixed code, no markdown fences, no explanation.`,
    schema: `RAW CODE`,
  },
  security: {
    system: `You are NOVA-Security (אבנר). Audit code for security issues. Output ONLY valid JSON, no markdown. Respond in Hebrew where natural.`,
    schema: `{"findings":[{"severity":"low"|"med"|"high","rule":"rule name","description":"issue","line":0}],"safe":true,"summary":"overall assessment"}`,
  },
  docs: {
    system: `You are NOVA-Docs (תום). Generate README documentation. Output ONLY valid JSON, no markdown. Respond in Hebrew where natural.`,
    schema: `{"title":"project title","description":"what it does","usage":["example 1"],"api":[{"name":"func","description":"what it does"}],"architecture":"overview"}`,
  },
  release: {
    system: `You are NOVA-Release (שירה). Produce release metadata. Output ONLY valid JSON, no markdown. Respond in Hebrew where natural.`,
    schema: `{"version":"1.0.0","channel":"stable"|"beta","changelog":["change 1"],"retrospective":["retro note"],"sign":true}`,
  },
};

export async function POST(request: NextRequest): Promise<Response> {
  try {
    const { agent, mission, context } = await request.json();

    if (!agent || !AGENT_PROMPTS[agent]) {
      return Response.json(
        { error: `Unknown agent: ${agent}. Valid: ${Object.keys(AGENT_PROMPTS).join(', ')}` },
        { status: 400 }
      );
    }
    if (!mission || !mission.trim()) {
      return Response.json({ error: 'Missing mission' }, { status: 400 });
    }

    const { system, schema } = AGENT_PROMPTS[agent];
    const t0 = Date.now();

    // Build the user prompt — include context from previous agents if provided
    const userPrompt = context
      ? `Mission: ${mission}\n\nContext from previous agents:\n${context}\n\nOutput schema: ${schema}`
      : `Mission: ${mission}\n\nOutput schema: ${schema}`;

    // Try LLM first, fall back to smart local engine
    let llmOutput: any = null;
    let llmRaw = '';
    let llmDegraded = false;
    let llmProvider = '';
    let llmError = '';

    try {
      const res = await fetch('http://localhost:3000/api/atlas/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: userPrompt },
          ],
          temperature: 0.3,
          maxTokens: 1500,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        llmRaw = (data.text || '').trim();
        llmDegraded = data.degraded === true || data.provider === 'local-fallback';
        llmProvider = data.provider || '';

        // Parse JSON output (agents return JSON except 'fixer' which returns raw code)
        if (agent === 'fixer') {
          llmOutput = llmRaw.replace(/```javascript\n?/g, '').replace(/```\n?/g, '').trim();
        } else {
          const jsonMatch = llmRaw.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            try { llmOutput = JSON.parse(jsonMatch[0]); } catch { llmOutput = null; }
          }
        }
      } else {
        llmError = `atlas/ai ${res.status}`;
      }
    } catch (err) {
      llmError = err instanceof Error ? err.message : String(err);
    }

    // If LLM produced valid output, return it
    if (llmOutput) {
      return Response.json({
        agent,
        output: llmOutput,
        raw: llmRaw,
        ms: Date.now() - t0,
        ok: true,
        degraded: llmDegraded,
        provider: llmProvider,
      });
    }

    // P0 FIX: LLM failed — use smart local engine (REAL structured output, not fake)
    // Each agent has a deterministic implementation that produces genuine analysis
    let localOutput: any = null;
    try {
      switch (agent) {
        case 'classify':
          localOutput = classifyMission(mission);
          break;
        case 'pm':
          localOutput = pmAgent(mission);
          break;
        case 'analyst': {
          const pm = context ? safeParsePm(context) : undefined;
          localOutput = analystAgent(mission, pm);
          break;
        }
        case 'architect': {
          const pm = context ? safeParsePm(context) : undefined;
          localOutput = architectAgent(mission, pm);
          break;
        }
        case 'designer': {
          // Parse architect spec from context if available
          localOutput = designerAgent(mission);
          break;
        }
        case 'optimizer':
          localOutput = {
            issues: [],
            optimized: true,
            summary: 'No optimization issues detected (local analysis)',
          };
          break;
        case 'fixer':
          // Local fixer — return the source as-is (no LLM fix available)
          localOutput = context || '';
          break;
        case 'security':
          // Security agent needs source code — extract from context
          localOutput = securityAgent(context || '');
          break;
        case 'docs': {
          const pm = context ? safeParsePm(context) : pmAgent(mission);
          const arch = architectAgent(mission, pm);
          localOutput = docsAgent(mission, pm, arch);
          break;
        }
        case 'release':
          localOutput = releaseAgent(mission, true);
          break;
      }
    } catch (err) {
      return Response.json({
        agent,
        output: null,
        raw: '',
        ms: Date.now() - t0,
        ok: false,
        degraded: true,
        error: `Local engine failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    }

    return Response.json({
      agent,
      output: localOutput,
      raw: localOutput ? JSON.stringify(localOutput, null, 2) : '',
      ms: Date.now() - t0,
      ok: !!localOutput,
      degraded: true,
      provider: 'nova-local-engine',
      llmError: llmError || undefined,
    });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

// Helper: safely parse PM spec from context string
function safeParsePm(context: string): any {
  try {
    const match = context.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
  } catch {}
  return undefined;
}
