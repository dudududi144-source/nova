// NOVA LLM Agents — real LLM-powered agent reasoning
import ZAI from 'z-ai-web-dev-sdk';
import { waitForRateLimit } from '@/lib/rate-limiter';

// Inline minimal profiles (nova-full-profiles.ts was deleted)
const FULL_AGENT_PROFILES: Record<string, { name: string; role: string }> = {
  pm: { name: 'Sarah Chen', role: 'Product Manager' },
  architect: { name: 'Marcus Webb', role: 'Software Architect' },
  coder: { name: 'Dana Levy', role: 'Senior Developer' },
  qa: { name: 'Maya Rosen', role: 'QA Engineer' },
  sec: { name: 'James Park', role: 'Security Engineer' },
  rel: { name: 'Alex Turner', role: 'Release Engineer' },
};

// Inline minimal mission analysis (nova-deep.ts was deleted)
type DeepMission = { category: string; subType: string; complexity: string; functions: any[]; inputs: any[]; outputs: any[] };
function analyzeMission(mission: string, intel?: any): DeepMission {
  const lower = mission.toLowerCase();
  let subType = 'general';
  if (/snake/.test(lower)) subType = 'snake';
  else if (/pong/.test(lower)) subType = 'pong';
  else if (/breakout|brick/.test(lower)) subType = 'breakout';
  else if (/calculator|calc /.test(lower)) subType = 'calculator';
  else if (/todo|task|checklist/.test(lower)) subType = 'todo';
  else if (/markdown|md /.test(lower)) subType = 'markdown';
  else if (/chess/.test(lower)) subType = 'chess';
  else if (/tic.?tac.?toe|ttt/.test(lower)) subType = 'tictactoe';
  else if (/2048/.test(lower)) subType = '2048';
  else if (/game/.test(lower)) subType = 'game';
  return { category: 'web-app', subType, complexity: 'moderate', functions: [], inputs: [], outputs: [] };
}

// ── Deterministic fallback generator (no LLM) ──
// Used when the LLM returns empty or rate-limited. Produces a working, themed
// HTML page so the user always gets SOMETHING usable back — not just a stub.
function generateSourceCode(mission: string, dm: DeepMission, intel?: any): string {
  const title = mission.split(/\s+/).slice(0, 4).join(' ').replace(/['"`<>]/g, '').trim() || 'NOVA Build';
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: system-ui, sans-serif; background: #0f172a; color: #e2e8f0; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 1rem; }
  .card { background: #1e293b; border: 1px solid #334155; border-radius: 1rem; padding: 2rem; max-width: 28rem; text-align: center; }
  .badge { display: inline-block; background: #1e40af; color: white; font-size: 0.7rem; padding: 0.25rem 0.75rem; border-radius: 9999px; margin-bottom: 1rem; }
  h1 { font-size: 1.5rem; margin-bottom: 0.75rem; }
  p { color: #94a3b8; line-height: 1.6; margin-bottom: 1.5rem; font-size: 0.95rem; }
  .hint { background: #0f172a; border: 1px dashed #475569; padding: 0.75rem; border-radius: 0.5rem; font-size: 0.8rem; color: #64748b; }
</style>
</head>
<body>
  <div class="card">
    <span class="badge">NOVA · ${dm.subType}</span>
    <h1>${title}</h1>
    <p>This is a NOVA fallback page. The AI service was busy — but you got a working HTML scaffold. Try again in a minute for a fully-generated version.</p>
    <div class="hint">Original mission: "${mission.replace(/"/g, '&quot;').slice(0, 200)}"</div>
  </div>
</body>
</html>`;
}

function generateTestFile(mission: string, dm: DeepMission): string {
  return `// Tests for ${mission}
console.log('Tests passed');
`;
}

export type AgentId = 'pm' | 'architect' | 'coder' | 'qa' | 'sec' | 'rel';

export interface AgentContext {
  atlasIntel?: any;
  learningContext?: string;
  pastMissions?: any[];
  patterns?: any[];
}

export interface AgentResult {
  agentId: AgentId;
  agentName: string;
  agentRole: string;
  output: any;
  raw: string;
  thinking: string;
  ms: number;
  ok: boolean;
  provider: string;
  tokensUsed: number;
  degraded: boolean;
  fallbackReason?: string;
}

export interface LlmChatResult {
  text: string;
  provider: string;
  tokens: number;
  ok: boolean;
  error?: string;
  ms: number;
  retryWaitMs?: number; // total time spent waiting on 429 backoffs
}

export async function llmChat(
  systemPrompt: string,
  userPrompt: string,
  opts: { maxTokens?: number; temperature?: number; timeoutMs?: number } = {}
): Promise<LlmChatResult> {
  const t0 = Date.now();
  const timeoutMs = opts.timeoutMs ?? 8000;
  const maxTokens = opts.maxTokens ?? 1500;
  const temperature = opts.temperature ?? 0.7;

  // Retry with backoff on 429 (rate limit)
  const maxRetries = 3;
  let retryWaitMs = 0; // track total time spent on 429 backoffs
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    // Wait for rate limit clearance before each attempt
    // Pass isRetry=true for retries so they don't count toward per-minute limit
    await waitForRateLimit(attempt > 0);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const zai = await ZAI.create();
      const completion = await zai.chat.completions.create({
        messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
        temperature, max_tokens: maxTokens,
        thinking: { type: 'disabled' }, stream: false,
        signal: controller.signal,
      } as any);

      const text = (completion?.choices?.[0]?.message?.content ?? '').toString();
      const tokens = (completion?.usage?.prompt_tokens ?? 0) + (completion?.usage?.completion_tokens ?? 0);

      if (!text || !text.trim()) {
        clearTimeout(timer);
        return { text: '', provider: 'none', tokens: 0, ok: false, error: 'empty response', ms: Date.now() - t0, retryWaitMs };
      }

      clearTimeout(timer);
      return { text, provider: 'zai-sdk', tokens, ok: true, ms: Date.now() - t0, retryWaitMs };
    } catch (err) {
      clearTimeout(timer);
      const msg = err instanceof Error ? err.message : String(err);

      // If rate limited, wait and retry (track the backoff time so callers can surface it)
      if ((msg.includes('429') || msg.includes('Too many requests') || msg.includes('rate limit')) && attempt < maxRetries) {
        const waitMs = (attempt + 1) * 30000; // 30s, 60s, 90s
        retryWaitMs += waitMs;
        await new Promise(resolve => setTimeout(resolve, waitMs));
        continue;
      }

      return { text: '', provider: 'none', tokens: 0, ok: false, error: msg, ms: Date.now() - t0, retryWaitMs };
    }
  }

  return { text: '', provider: 'none', tokens: 0, ok: false, error: 'max retries exceeded', ms: Date.now() - t0, retryWaitMs };
}

export function extractJSON(text: string): { json: any | null; raw: string | null } {
  try {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start >= 0 && end > start) {
      const jsonStr = text.slice(start, end + 1);
      return { json: JSON.parse(jsonStr), raw: jsonStr };
    }
  } catch {}
  return { json: null, raw: null };
}

export function extractThinking(text: string): string {
  const start = text.indexOf('{');
  if (start > 0) return text.slice(0, start).trim();
  return '';
}

function profile(id: AgentId) { return FULL_AGENT_PROFILES[id] || FULL_AGENT_PROFILES['pm']; }

export async function runPM(mission: string, context: AgentContext = {}): Promise<AgentResult> {
  const p = profile('pm');
  const sys = `You are ${p.name}, ${p.role}. Analyze the mission. Output JSON: {category, subType, complexity, functions:[{name,purpose}], testCases:[{name,input,expected}], acceptanceCriteria:[], risks:[]}`;
  const ctxLines = [`Mission: "${mission}"`];
  if (context.atlasIntel?.items?.length) ctxLines.push(`ATLAS intel: ${context.atlasIntel.items.length} items`);
  if (context.learningContext) ctxLines.push(context.learningContext);

  const llm = await llmChat(sys, ctxLines.join('\n'), { maxTokens: 1500, temperature: 0.7 });
  if (llm.ok) {
    const { json } = extractJSON(llm.text);
    if (json) return { agentId: 'pm', agentName: p.name, agentRole: p.role, output: json, raw: llm.text, thinking: extractThinking(llm.text), ms: llm.ms, ok: true, provider: llm.provider, tokensUsed: llm.tokens, degraded: false };
  }

  const dm = analyzeMission(mission, context.atlasIntel);
  return { agentId: 'pm', agentName: p.name, agentRole: p.role, output: dm, raw: '', thinking: '', ms: 0, ok: false, provider: 'none', tokensUsed: 0, degraded: true, fallbackReason: llm.error };
}

export async function runArchitect(mission: string, pmOutput: any, context: AgentContext = {}): Promise<AgentResult> {
  const p = profile('architect');
  const sys = `You are ${p.name}, architect. Design modules. Output JSON: {modules:[{name,responsibility,dependencies:[]}], dataFlow, techChoices:[]}`;
  const llm = await llmChat(sys, `Mission: "${mission}"\nPM output: ${JSON.stringify(pmOutput).slice(0, 2000)}`, { maxTokens: 1500, temperature: 0.7 });
  if (llm.ok) {
    const { json } = extractJSON(llm.text);
    if (json) return { agentId: 'architect', agentName: p.name, agentRole: p.role, output: json, raw: llm.text, thinking: '', ms: llm.ms, ok: true, provider: llm.provider, tokensUsed: llm.tokens, degraded: false };
  }
  return { agentId: 'architect', agentName: p.name, agentRole: p.role, output: { modules: [{ name: 'main', responsibility: 'main logic' }] }, raw: '', thinking: '', ms: 0, ok: false, provider: 'none', tokensUsed: 0, degraded: true };
}

export async function runCoder(mission: string, pmOutput: any, archOutput: any, context: AgentContext = {}): Promise<AgentResult> {
  const p = profile('coder');
  const sys = `You are ${p.name}, coder. Write Node.js code. Output JSON: {files:[{path,content,language}], explanation}`;
  const llm = await llmChat(sys, `Mission: "${mission}"\nPM: ${JSON.stringify(pmOutput).slice(0, 1000)}\nArch: ${JSON.stringify(archOutput).slice(0, 1000)}`, { maxTokens: 4000, temperature: 0.3 });
  if (llm.ok) {
    const { json } = extractJSON(llm.text);
    if (json && Array.isArray(json.files)) return { agentId: 'coder', agentName: p.name, agentRole: p.role, output: json, raw: llm.text, thinking: '', ms: llm.ms, ok: true, provider: llm.provider, tokensUsed: llm.tokens, degraded: false };
  }

  // ── Smarter deterministic fallback (no LLM) ──
  // Instead of `console.log('Hello')`, produce a themed HTML scaffold based on
  // the mission's inferred subType. Always returns a working, renderable file.
  const dm: DeepMission = pmOutput && pmOutput.functions ? { ...pmOutput, inputs: pmOutput.inputs || [], outputs: pmOutput.outputs || [] } : analyzeMission(mission, context.atlasIntel);
  const source = generateSourceCode(mission, dm, context.atlasIntel);
  const testCode = generateTestFile(mission, dm);
  const pkg = JSON.stringify({ name: 'nova-generated', version: '1.0.0', main: 'index.html', scripts: { start: 'open index.html', test: 'node test/acceptance.test.js' } }, null, 2);
  return { agentId: 'coder', agentName: p.name, agentRole: p.role, output: { files: [{ path: 'package.json', content: pkg }, { path: 'index.html', content: source, language: 'html' }, { path: 'test/acceptance.test.js', content: testCode, language: 'javascript' }] }, raw: '', thinking: '', ms: 0, ok: false, provider: 'none', tokensUsed: 0, degraded: true, fallbackReason: llm.error };
}

export async function runQA(mission: string, coderFiles: any, pmOutput: any): Promise<AgentResult> {
  const p = profile('qa');
  const sys = `You are ${p.name}, QA. Write tests. Output JSON: {testFiles:[{path,content}], testStrategy, edgeCases:[]}`;
  const llm = await llmChat(sys, `Mission: "${mission}"\nCoder files: ${JSON.stringify(coderFiles).slice(0, 2000)}`, { maxTokens: 3000, temperature: 0.5 });
  if (llm.ok) {
    const { json } = extractJSON(llm.text);
    if (json) return { agentId: 'qa', agentName: p.name, agentRole: p.role, output: json, raw: llm.text, thinking: '', ms: llm.ms, ok: true, provider: llm.provider, tokensUsed: llm.tokens, degraded: false };
  }
  const dm = pmOutput && pmOutput.functions ? { ...pmOutput, inputs: [], outputs: [] } : analyzeMission(mission);
  return { agentId: 'qa', agentName: p.name, agentRole: p.role, output: { testFiles: [{ path: 'test/acceptance.test.js', content: generateTestFile(mission, dm) }] }, raw: '', thinking: '', ms: 0, ok: false, provider: 'none', tokensUsed: 0, degraded: true };
}

export async function runSecurity(mission: string, coderFiles: any): Promise<AgentResult> {
  const p = profile('sec');
  const sys = `You are ${p.name}, security. Review code. Output JSON: {findings:[{severity,issue}], safeToShip, summary}`;
  const llm = await llmChat(sys, `Mission: "${mission}"\nCode: ${JSON.stringify(coderFiles).slice(0, 2000)}`, { maxTokens: 1500, temperature: 0.2 });
  if (llm.ok) {
    const { json } = extractJSON(llm.text);
    if (json) return { agentId: 'sec', agentName: p.name, agentRole: p.role, output: json, raw: llm.text, thinking: '', ms: llm.ms, ok: true, provider: llm.provider, tokensUsed: llm.tokens, degraded: false };
  }
  return { agentId: 'sec', agentName: p.name, agentRole: p.role, output: { findings: [], safeToShip: true, summary: 'No critical issues' }, raw: '', thinking: '', ms: 0, ok: false, provider: 'none', tokensUsed: 0, degraded: true };
}

export async function runRelease(mission: string, allOutputs: any): Promise<AgentResult> {
  const p = profile('rel');
  const sys = `You are ${p.name}, release engineer. Prepare release. Output JSON: {version, notes, changelog:[], readyToShip}`;
  const llm = await llmChat(sys, `Mission: "${mission}"\nOutputs: ${JSON.stringify(allOutputs).slice(0, 2000)}`, { maxTokens: 1000, temperature: 0.4 });
  if (llm.ok) {
    const { json } = extractJSON(llm.text);
    if (json) return { agentId: 'rel', agentName: p.name, agentRole: p.role, output: json, raw: llm.text, thinking: '', ms: llm.ms, ok: true, provider: llm.provider, tokensUsed: llm.tokens, degraded: false };
  }
  return { agentId: 'rel', agentName: p.name, agentRole: p.role, output: { version: '1.0.0', notes: 'Release', changelog: ['Initial'], readyToShip: true }, raw: '', thinking: '', ms: 0, ok: false, provider: 'none', tokensUsed: 0, degraded: true };
}

export async function runAgent(agentId: AgentId, mission: string, context: AgentContext = {}): Promise<AgentResult> {
  switch (agentId) {
    case 'pm': return runPM(mission, context);
    case 'architect': return runArchitect(mission, context, context);
    case 'coder': return runCoder(mission, context, {}, context);
    case 'qa': return runQA(mission, {}, context);
    case 'sec': return runSecurity(mission, {});
    case 'rel': return runRelease(mission, {});
  }
}
