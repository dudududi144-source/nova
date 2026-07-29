// GET /api/nova/llm-status
// ─────────────────────────────────────────────────────────────────────────────
// Reports whether the real LLM (z-ai-web-dev-sdk) is available for NOVA
// agents. Pings the LLM with a 5-second budgeted "Say OK" call. Caches the
// result for 60s so we don't burn a request on every dashboard poll.
//
// Response: { llmAvailable, provider, lastChecked, latencyMs }
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server';
import { llmChat } from '@/lib/nova-llm-agents';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 15;

interface CachedStatus {
  llmAvailable: boolean;
  provider: string;
  lastChecked: number;
  latencyMs: number;
  error?: string;
}

// Module-level cache (HMR-safe via globalThis).
const CACHE_KEY = '__novaLlmStatusCache';
const CACHE_TTL_MS = 60_000;

function getCached(): CachedStatus | null {
  const g = globalThis as any;
  if (!g[CACHE_KEY]) return null;
  const c: CachedStatus = g[CACHE_KEY];
  if (Date.now() - c.lastChecked > CACHE_TTL_MS) return null;
  return c;
}

function setCached(c: CachedStatus): void {
  (globalThis as any)[CACHE_KEY] = c;
}

export async function GET(): Promise<Response> {
  const cached = getCached();
  if (cached) {
    return NextResponse.json({ ...cached, cached: true });
  }

  const t0 = Date.now();
  const probe = await llmChat(
    'You are a health-check endpoint. Reply with exactly: OK',
    'ping',
    { maxTokens: 10, temperature: 0, timeoutMs: 5_000 }
  );
  const latencyMs = Date.now() - t0;

  const status: CachedStatus = {
    llmAvailable: probe.ok,
    provider: probe.provider,
    lastChecked: Date.now(),
    latencyMs,
    error: probe.ok ? undefined : probe.error,
  };
  setCached(status);

  return NextResponse.json({ ...status, cached: false });
}
