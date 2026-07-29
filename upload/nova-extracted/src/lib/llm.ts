// LLM wrapper — server-side, uses z-ai-web-dev-sdk
// Used by build pipeline + chat API for real AI code generation.
import ZAI from 'z-ai-web-dev-sdk';

export interface LlmResult {
  ok: boolean;
  text: string;
  tokens: number;
  ms: number;
  error?: string;
}

let zaiInstance: any = null;

async function getZai() {
  if (zaiInstance) return zaiInstance;
  try {
    zaiInstance = await ZAI.create();
    return zaiInstance;
  } catch (err) {
    return null;
  }
}

export async function llmChat(
  systemPrompt: string,
  userPrompt: string,
  opts: { maxTokens?: number; temperature?: number; timeoutMs?: number } = {}
): Promise<LlmResult> {
  const t0 = Date.now();
  const timeoutMs = opts.timeoutMs ?? 30000;
  const maxTokens = opts.maxTokens ?? 2000;
  const temperature = opts.temperature ?? 0.3;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const zai = await getZai();
    if (!zai) {
      clearTimeout(timer);
      return { ok: false, text: '', tokens: 0, ms: Date.now() - t0, error: 'ZAI SDK not initialized' };
    }

    const completion = await zai.chat.completions.create({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature,
      max_tokens: maxTokens,
      thinking: { type: 'disabled' },
      stream: false,
      signal: controller.signal,
    } as any);

    const text = (completion?.choices?.[0]?.message?.content ?? '').toString();
    const tokens = (completion?.usage?.prompt_tokens ?? 0) + (completion?.usage?.completion_tokens ?? 0);

    clearTimeout(timer);
    if (!text || !text.trim()) {
      return { ok: false, text: '', tokens: 0, ms: Date.now() - t0, error: 'empty response' };
    }
    return { ok: true, text, tokens, ms: Date.now() - t0 };
  } catch (err) {
    clearTimeout(timer);
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, text: '', tokens: 0, ms: Date.now() - t0, error: msg };
  }
}

// Extract JSON from LLM response (handles ```json fences + partial JSON)
export function extractJSON(text: string): { json: any | null; raw: string | null } {
  // Try fenced JSON
  const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (fenceMatch) {
    try { return { json: JSON.parse(fenceMatch[1].trim()), raw: fenceMatch[1] } } catch {}
  }
  // Try raw JSON
  try { return { json: JSON.parse(text.trim()), raw: text } } catch {}
  // Try finding first { to last }
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try { return { json: JSON.parse(text.slice(start, end + 1)), raw: text.slice(start, end + 1) } } catch {}
  }
  return { json: null, raw: null };
}
