// POST /api/nova/master-mission — Master Pipeline (stream + sync)
// Security: per-IP rate limit + mission size cap + mission validation
import type { NextRequest } from 'next/server';
import { newCorrelationId, newMissionId } from '@/lib/mission-stream';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

// ── Simple per-IP rate limiting ──
const ipCalls = new Map<string, { count: number; resetAt: number }>();
const MAX_CALLS_PER_HOUR = 20;
const HOUR_MS = 3600000;

function checkRateLimit(ip: string): { ok: boolean; remaining: number; resetIn: number } {
  const now = Date.now();
  const entry = ipCalls.get(ip);
  if (!entry || entry.resetAt < now) {
    ipCalls.set(ip, { count: 1, resetAt: now + HOUR_MS });
    return { ok: true, remaining: MAX_CALLS_PER_HOUR - 1, resetIn: HOUR_MS };
  }
  if (entry.count >= MAX_CALLS_PER_HOUR) {
    return { ok: false, remaining: 0, resetIn: entry.resetAt - now };
  }
  entry.count++;
  return { ok: true, remaining: MAX_CALLS_PER_HOUR - entry.count, resetIn: entry.resetAt - now };
}

// ── Mission validation ──
const MAX_MISSION_LENGTH = 500;
const MIN_MISSION_LENGTH = 3;
const BANNED_WORDS = ['rm -rf', 'format', 'del /f', 'shutdown', 'hack', 'exploit'];

function validateMission(mission: string): { ok: boolean; error?: string } {
  if (mission.length < MIN_MISSION_LENGTH) return { ok: false, error: 'Mission too short (min 3 chars)' };
  if (mission.length > MAX_MISSION_LENGTH) return { ok: false, error: `Mission too long (max ${MAX_MISSION_LENGTH} chars)` };
  const lower = mission.toLowerCase();
  for (const word of BANNED_WORDS) {
    if (lower.includes(word)) return { ok: false, error: `Mission contains banned word: ${word}` };
  }
  return { ok: true };
}

// ── Mission similarity check (NO LLM) ──
// Find a previous successful build of a similar mission. Returns the best match
// if similarity > threshold, so the user can load the cached build instead.
function tokenize(s: string): Set<string> {
  return new Set(
    s.toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 2 && !['the', 'and', 'for', 'with', 'that', 'this', 'from', 'have', 'your', 'build', 'make', 'create', 'please'].includes(w))
  );
}
function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const w of a) if (b.has(w)) intersection++;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}
async function findSimilarBuild(mission: string): Promise<{ mission: string; subType: string; sourceCode: string; learnings: string; similarity: number; createdAt: Date } | null> {
  try {
    const candidates = await db.agentMemory.findMany({
      where: { success: true, category: { not: 'feedback' } },
      orderBy: { createdAt: 'desc' },
      take: 50, // scan recent builds (cheap, in-memory)
      select: { mission: true, subType: true, sourceCode: true, learnings: true, createdAt: true },
    });
    const targetTokens = tokenize(mission);
    let best: any = null;
    let bestSim = 0;
    for (const c of candidates) {
      const sim = jaccard(targetTokens, tokenize(c.mission));
      if (sim > bestSim) { bestSim = sim; best = c; }
    }
    // Require >0.6 similarity AND non-empty source code AND >=200 chars (real build)
    if (best && bestSim >= 0.6 && best.sourceCode && best.sourceCode.length > 200) {
      return { ...best, similarity: bestSim };
    }
    return null;
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest): Promise<Response> {
  // ── Rate limit check ──
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0] || request.headers.get('x-real-ip') || 'unknown';
  const rl = checkRateLimit(ip);
  if (!rl.ok) {
    return Response.json({
      ok: false,
      error: `Rate limit exceeded. Try again in ${Math.ceil(rl.resetIn / 60000)} minutes.`,
      retryAfter: rl.resetIn,
    }, { status: 429, headers: { 'Retry-After': String(Math.ceil(rl.resetIn / 1000)) } });
  }

  let body: any;
  try { body = await request.json(); } catch { return Response.json({ ok: false, error: 'Invalid JSON' }, { status: 400 }); }

  const mission: string | undefined = body?.mission;
  if (!mission || !mission.trim()) return Response.json({ ok: false, error: 'Missing mission' }, { status: 400 });

  // ── Mission validation ──
  const validation = validateMission(mission);
  if (!validation.ok) {
    return Response.json({ ok: false, error: validation.error }, { status: 400 });
  }

  // ── Mission dedup: check for a similar previous build BEFORE starting ──
  // If user passed `forceNew: true`, skip the cache check (they want a fresh build).
  const forceNew = !!body?.forceNew;
  if (!forceNew) {
    const similar = await findSimilarBuild(mission);
    if (similar) {
      return Response.json({
        ok: true,
        cachedBuild: {
          mission: similar.mission,
          subType: similar.subType,
          html: similar.sourceCode,
          learnings: similar.learnings,
          similarity: Number(similar.similarity.toFixed(2)),
          createdAt: similar.createdAt.toISOString(),
        },
        message: `Found a similar previous build (${Math.round(similar.similarity * 100)}% match). Load it instead?`,
      });
    }
  }

  const stream: boolean = !!body?.stream;
  const resumeMissionId: string | undefined = body?.resumeMissionId;
  // Optional user-specified quality target (default 7; range 6-9). Higher = more fix iterations.
  const qualityTarget: number = Math.min(9, Math.max(5, Number(body?.qualityTarget) || 7));
  // ── Auto-skip stages on cached build (OO) ──
  // If user clicks "Build fresh" after a cache hit, we can still skip the feasibility
  // check (we know it's buildable — they already built it once) by passing skipFeasibility=true.
  // The architect stage still runs (they want a fresh build, possibly different files).
  const skipFeasibility: boolean = !!body?.skipFeasibility;
  const missionId = newMissionId('mp');
  const correlationId = newCorrelationId('master-pipeline');

  if (stream) {
    setImmediate(() => {
      import('@/lib/pipeline').then(({ runPipeline }) => {
        return runPipeline(mission, {
          missionId, correlationId,
          resumeFromCheckpointId: resumeMissionId,
          qualityTarget,
          skipFeasibility,
        });
      }).then((r: any) => {
        console.log(`[master-mission] ${missionId} success=${r.success} files=${r.files?.length || 0} ${r.durationMs}ms resume=${!!resumeMissionId} qTarget=${qualityTarget} skipFeas=${skipFeasibility}`);
      }).catch((e: any) => console.error(`[master-mission] ${missionId} crashed:`, e));
    });
    return Response.json({
      ok: true, missionId, correlationId,
      streamUrl: `/api/nova/mission-events/${missionId}`,
      status: 'started', pipeline: 'nova-8stage',
      resumedFrom: resumeMissionId || null,
      qualityTarget,
      rateLimit: { remaining: rl.remaining, resetIn: rl.resetIn },
    });
  }

  // Sync mode
  try {
    const { runPipeline } = await import('@/lib/pipeline');
    const result = await runPipeline(mission, { missionId, correlationId, resumeFromCheckpointId: resumeMissionId, qualityTarget, skipFeasibility });
    return Response.json({ ok: result.success, result });
  } catch (err) {
    return Response.json({ ok: false, error: err instanceof Error ? err.message : String(err), missionId, correlationId }, { status: 500 });
  }
}
