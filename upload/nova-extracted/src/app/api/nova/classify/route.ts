// POST /api/nova/classify — classify a mission
import type { NextRequest } from 'next/server';
import { classifyMission } from '@/lib/mission-classifier';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

export async function POST(request: NextRequest): Promise<Response> {
  try {
    const { mission } = await request.json();
    if (!mission) return Response.json({ ok: false, error: 'mission required' }, { status: 400 });
    const classification = await classifyMission(mission);
    return Response.json({ ok: true, classification });
  } catch (e) {
    return Response.json({ ok: false, error: String(e) }, { status: 500 });
  }
}

export async function GET(): Promise<Response> {
  return Response.json({ ok: true, endpoint: 'POST /api/nova/classify with {mission}' });
}
