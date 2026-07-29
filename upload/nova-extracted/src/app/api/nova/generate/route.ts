// NOVA — Real LLM code generation with AUTO-FIX loop + graceful fallback
// Uses /api/atlas/ai internally (which has multi-provider + local fallback)
// so NOVA never hard-fails when AI is rate-limited.
import type { NextRequest } from 'next/server';
import { getAiConfigStatus } from '@/lib/ai-config';
import { sanitizeCode } from '@/lib/sanitize';
import { pmAgent, architectAgent, generateCode as novaGenerateCode } from '@/lib/nova-agents';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const maxDuration = 60;

const MAX_RETRIES = 3;

// Security: validate generated code
const DANGEROUS = [
  /require\s*\(\s*['"]child_process['"]\s*\)/,
  /require\s*\(\s*['"]fs['"]\s*\)/,
  /process\.exit\s*\(/,
  /execSync\s*\(/,
  /spawnSync\s*\(/,
];

function isSafe(code: string): boolean {
  return !DANGEROUS.some(p => p.test(code));
}

// Run code in ARENA and get result
async function runInArena(source: string): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  try {
    const res = await fetch('http://localhost:3000/api/arena/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'js', source, timeoutMs: 5000 }),
    });
    return await res.json();
  } catch {
    return { exitCode: -1, stdout: '', stderr: 'ARENA unavailable' };
  }
}

// Call /api/atlas/ai (which has multi-provider fallback built in)
async function callAi(systemPrompt: string, userPrompt: string): Promise<string> {
  try {
    const res = await fetch('http://localhost:3000/api/atlas/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [
          { role: 'assistant', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      }),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`atlas/ai ${res.status}: ${errText.slice(0, 100)}`);
    }
    const data = await res.json();
    return data.text || '';
  } catch (err) {
    throw err;
  }
}

// Local fallback code generator — uses the smart NOVA agent engine
// Produces REAL code from mission analysis (not fake "AI unavailable" messages)
function localCodeFallback(mission: string, architect_spec?: any, acceptance_tests?: any[]): string {
  // Use the smart local engine to generate real code
  const pmSpec = pmAgent(mission);
  const archSpec = architect_spec || architectAgent(mission, pmSpec);
  return novaGenerateCode(mission, pmSpec, archSpec);
}

export async function POST(request: NextRequest): Promise<Response> {
  try {
    const { mission, architect_spec, acceptance_tests } = await request.json();
    if (!mission || !mission.trim()) {
      return Response.json({ error: 'Missing mission' }, { status: 400 });
    }

    const cfg = getAiConfigStatus();
    let source = '';
    let lastError = '';
    let attempts = 0;
    let succeeded = false;
    let usedFallback = false;
    let engine = 'z-ai-llm';

    // Build context-rich system prompt if architect spec + acceptance tests provided
    const contextBlock = (architect_spec || acceptance_tests)
      ? `\n\nARCHITECT SPEC:\n${JSON.stringify(architect_spec || {}).slice(0, 800)}\n\nACCEPTANCE TESTS (code must pass these):\n${JSON.stringify(acceptance_tests || []).slice(0, 800)}`
      : '';

    // Generate → Validate → Run → Fix loop (only if AI is configured)
    if (cfg.ok) {
      for (attempts = 1; attempts <= MAX_RETRIES; attempts++) {
        const prompt = attempts === 1
          ? `Generate JavaScript code for this mission:\n\n${mission}${contextBlock}\n\nThe code MUST pass all acceptance tests. Output ONLY the JavaScript code, nothing else.`
          : `The previous code had an error. Fix it.\n\nMission: ${mission}\n\nPrevious code:\n${source}\n\nError:\n${lastError}\n\nOutput ONLY the fixed JavaScript code, nothing else.`;

        try {
          const text = await callAi(
            'You are NOVA, an expert code generator. Write CLEAN, RUNNABLE JavaScript (Node.js). Rules: 1) Only output JavaScript code, no explanations. 2) Use console.log() for output. 3) Keep it under 50 lines. 4) Handle edge cases. 5) Use modern ES6+ syntax. 6) Do NOT use require() for fs, child_process, or net. 7) Do NOT use process.exit(). 8) If acceptance tests are provided, the code MUST produce output that matches expected_stdout.',
            prompt
          );
          source = text.replace(/```javascript\n?/g, '').replace(/```\n?/g, '').trim();
          source = sanitizeCode(source);
        } catch (err) {
          lastError = err instanceof Error ? err.message : String(err);
          if (attempts === MAX_RETRIES) break;
          continue;
        }

        if (!source || source.length < 10) {
          lastError = 'Empty response from LLM';
          continue;
        }

        if (!isSafe(source)) {
          lastError = 'Security: code contains blocked patterns';
          continue;
        }

        const result = await runInArena(source);

        if (result.exitCode === 0) {
          succeeded = true;
          break;
        }
        lastError = result.stderr || `exit code ${result.exitCode}`;
      }
    } else {
      // AI not configured — skip generation loop
      lastError = 'AI not configured';
    }

    // If AI failed or not configured, use local fallback
    if (!succeeded) {
      source = localCodeFallback(mission, architect_spec, acceptance_tests);
      const result = await runInArena(source);
      succeeded = result.exitCode === 0;
      usedFallback = true;
      engine = succeeded ? 'local-fallback' : 'local-fallback-failed';
      attempts = attempts || 1;
    }

    return Response.json({
      source,
      lines: source.split('\n').length,
      chars: source.length,
      generated: true,
      engine,
      attempts,
      succeeded,
      usedFallback,
      lastError: succeeded ? null : lastError,
      degraded: usedFallback,
    });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
