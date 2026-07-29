// POST /api/nova/feedback — save user feedback (thumbs up/down)
import type { NextRequest } from 'next/server';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: NextRequest): Promise<Response> {
  let body: any;
  try { body = await request.json(); } catch {
    return Response.json({ ok: false, error: 'Invalid JSON' }, { status: 400 });
  }

  const { missionId, rating, note } = body;
  if (!missionId || !rating) {
    return Response.json({ ok: false, error: 'Missing missionId or rating' }, { status: 400 });
  }

  try {
    // Save feedback as an agent memory with special category
    await db.agentMemory.create({
      data: {
        mission: `FEEDBACK: ${note || rating}`,
        category: 'feedback',
        subType: rating === 'up' ? 'positive' : 'negative',
        agentId: 'user-feedback',
        agentName: 'User',
        success: rating === 'up',
        sourceCode: '',
        learnings: note || '',
      },
    });

    return Response.json({ ok: true });
  } catch (err) {
    return Response.json({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    }, { status: 500 });
  }
}
