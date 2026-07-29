// GET /api/nova/learning — agent skill profiles + aggregate stats
//
// Query params:
//   agentId (optional) — return only this agent's profile. If omitted, returns all 6 agents.
//
// Response shape:
//   {
//     agents: AgentSkillProfile[],
//     aggregate: { totalMissions, averageLevel, topDomain, totalXp, agentCount }
//   }
import type { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { getAgentSkillProfile, type AgentSkillProfile } from '@/lib/nova-learning';
import { FULL_AGENT_PROFILES } from '@/lib/nova-full-profiles';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// All known NOVA agent IDs (in canonical order)
const ALL_AGENT_IDS = ['pm', 'architect', 'coder', 'qa', 'sec', 'rel'];

export async function GET(request: NextRequest): Promise<Response> {
  try {
    const { searchParams } = new URL(request.url);
    const agentId = searchParams.get('agentId');

    const ids = agentId ? [agentId] : ALL_AGENT_IDS;

    // Fetch skill profiles in parallel for speed
    const profiles = await Promise.all(ids.map(id => getAgentSkillProfile(id)));

    // Augment with display metadata from FULL_AGENT_PROFILES (icon, role)
    const enriched: Array<AgentSkillProfile & { icon: string; role: string; color: string }> = profiles.map(p => {
      const meta = FULL_AGENT_PROFILES[p.agentId];
      return {
        ...p,
        agentName: p.agentName || meta?.name || p.agentId,
        icon: meta?.icon ?? '🤖',
        role: meta?.role ?? '',
        color: meta?.color ?? '#6b7280',
      };
    });

    // Aggregate stats across all agents (even when filtering by agentId, we
    // compute aggregates across the whole fleet so the widget can show the
    // team context).
    const allRows = await db.agentSkill.findMany();
    const totalMissions = allRows.reduce((s, r) => s + r.totalMissions, 0);
    const totalXp = allRows.reduce((s, r) => s + r.xp, 0);
    const averageLevel = allRows.length > 0
      ? Math.round((allRows.reduce((s, r) => s + r.level, 0) / allRows.length) * 10) / 10
      : 0;

    // Top domain = the domain with the most total missions across all agents
    const domainCounts = new Map<string, number>();
    for (const r of allRows) {
      domainCounts.set(r.domain, (domainCounts.get(r.domain) ?? 0) + r.totalMissions);
    }
    let topDomain: string | null = null;
    let topCount = 0;
    for (const [d, c] of domainCounts) {
      if (c > topCount) {
        topCount = c;
        topDomain = d;
      }
    }

    return Response.json({
      agents: enriched,
      aggregate: {
        totalMissions,
        totalXp,
        averageLevel,
        topDomain,
        agentCount: allRows.length > 0 ? new Set(allRows.map(r => r.agentId)).size : 0,
        domainCount: domainCounts.size,
      },
    });
  } catch (err) {
    console.error('[/api/nova/learning] failed:', err instanceof Error ? err.message : String(err));
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
