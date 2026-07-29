// POST /api/nova/query-atlas — NOVA queries ATLAS for mid-mission intel
import type { NextRequest } from 'next/server';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: NextRequest): Promise<Response> {
  try {
    const { domain, keywords, correlationId } = await request.json();
    if (!domain && !keywords) return Response.json({ ok: false, error: 'domain or keywords required' }, { status: 400 });

    // Retrieve relevant intel from AgentMemory
    const memories = await db.agentMemory.findMany({
      where: { OR: [{ category: domain }, { category: 'vault-feedback' }] },
      orderBy: { createdAt: 'desc' }, take: 5,
      select: { mission: true, category: true, subType: true, learnings: true, createdAt: true },
    });

    // Also query ATLAS sync for live intel
    let liveIntel: any[] = [];
    try {
      const res = await fetch('http://localhost:3000/api/atlas/sources?src=all', { signal: AbortSignal.timeout(5000) });
      const data = await res.json();
      liveIntel = (data.items || []).slice(0, 3).map((item: any) => ({ title: item.title, source: item.source, category: item.category }));
    } catch {}

    // Store the query
    await db.crossToolQuery.create({
      data: {
        fromTool: 'nova', toTool: 'atlas', queryType: 'request-intel',
        payload: JSON.stringify({ domain, keywords: keywords || [], correlationId: correlationId || '' }),
        status: 'answered',
        response: JSON.stringify({ memories: memories.length, liveIntel: liveIntel.length }),
      },
    });

    return Response.json({ ok: true, items: memories, liveIntel, total: memories.length + liveIntel.length });
  } catch (e) {
    return Response.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
