// Mission Stream — real-time event streaming for missions
import { db as _db } from '@/lib/db';
// Safe db: if Prisma client is stale (missionStreamEvent missing), use no-op stub
const db: any = _db && _db.missionStreamEvent ? _db : {
  missionStreamEvent: { create: async () => ({}), findMany: async () => [], count: async () => 0 },
  agentMemory: { create: async () => ({}), findMany: async () => [], count: async () => 0 },
  missionCheckpoint: { create: async () => ({}), findMany: async () => [] },
};

export interface MissionStreamEvent {
  id: string;
  missionId: string;
  correlationId: string;
  seq: number;
  eventType: string;
  agentId?: string;
  agentName?: string;
  payload: any;
  severity?: string;
  ts: number;
}

const subscribers = new Map<string, Set<(event: MissionStreamEvent) => void>>();
const seqCounters = new Map<string, number>();

export function newMissionId(prefix: string = 'm'): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function newCorrelationId(prefix: string = 'cor'): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export async function emitMissionEvent(
  missionId: string,
  correlationId: string,
  eventType: string,
  payload: any,
  opts?: { agentId?: string; agentName?: string; severity?: string }
): Promise<MissionStreamEvent> {
  // Use per-mission counter instead of Date.now() (avoids Int overflow in SQLite)
  const seq = (seqCounters.get(missionId) || 0) + 1;
  seqCounters.set(missionId, seq);

  const event: MissionStreamEvent = {
    id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    missionId,
    correlationId,
    seq,
    eventType,
    agentId: opts?.agentId || '',
    agentName: opts?.agentName || '',
    payload,
    severity: opts?.severity || 'info',
    ts: Date.now(),
  };

  // Persist to DB (best-effort, with error logging for debugging)
  try {
    await db.missionStreamEvent.create({
      data: {
        missionId,
        correlationId,
        seq: event.seq,
        eventType,
        agentId: event.agentId,
        agentName: event.agentName,
        payload: JSON.stringify(payload),
        severity: event.severity,
      },
    });
  } catch (dbErr) {
    console.error('[mission-stream] DB write failed:', dbErr instanceof Error ? dbErr.message : String(dbErr));
  }

  // Notify in-memory subscribers
  const subs = subscribers.get(missionId);
  if (subs) {
    subs.forEach(cb => { try { cb(event); } catch {} });
  }

  return event;
}

export function subscribeToMission(missionId: string, callback: (event: MissionStreamEvent) => void): () => void {
  let set = subscribers.get(missionId);
  if (!set) { set = new Set(); subscribers.set(missionId, set); }
  set.add(callback);
  return () => { set!.delete(callback); if (set!.size === 0) subscribers.delete(missionId); };
}

export async function getMissionEvents(missionId: string, sinceSeq?: number): Promise<MissionStreamEvent[]> {
  try {
    const where: any = { missionId };
    if (sinceSeq) where.seq = { gt: sinceSeq };
    const events = await db.missionStreamEvent.findMany({ where, orderBy: { seq: 'asc' }, take: 100 });
    return events.map(e => ({
      id: e.id, missionId: e.missionId, correlationId: e.correlationId, seq: e.seq,
      eventType: e.eventType, agentId: e.agentId, agentName: e.agentName,
      payload: typeof e.payload === 'string' ? JSON.parse(e.payload) : e.payload,
      severity: e.severity, ts: e.ts.getTime(),
    }));
  } catch { return []; }
}

// Fetch ALL events for a mission (no take:100 limit) — used by Build Replay.
// Caps at 500 events to prevent unbounded memory use on pathological missions.
export async function getAllMissionEvents(missionId: string): Promise<MissionStreamEvent[]> {
  try {
    const events = await db.missionStreamEvent.findMany({
      where: { missionId },
      orderBy: { seq: 'asc' },
      take: 500,
    });
    return events.map(e => ({
      id: e.id, missionId: e.missionId, correlationId: e.correlationId, seq: e.seq,
      eventType: e.eventType, agentId: e.agentId, agentName: e.agentName,
      payload: typeof e.payload === 'string' ? JSON.parse(e.payload) : e.payload,
      severity: e.severity, ts: e.ts.getTime(),
    }));
  } catch { return []; }
}

export async function getActiveMissions(): Promise<any[]> {
  try {
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);
    return await db.missionStreamEvent.findMany({
      where: { ts: { gt: fiveMinAgo } },
      distinct: ['missionId'],
      select: { missionId: true, correlationId: true, eventType: true, ts: true },
      take: 20,
      orderBy: { ts: 'desc' },
    });
  } catch { return []; }
}

export function formatMissionSSE(event: MissionStreamEvent): string {
  const data = JSON.stringify({
    id: event.id, missionId: event.missionId, correlationId: event.correlationId,
    seq: event.seq, eventType: event.eventType, agentId: event.agentId,
    agentName: event.agentName, payload: event.payload, severity: event.severity, ts: event.ts,
  });
  return `id: ${event.seq}\nevent: ${event.eventType}\ndata: ${data}\n\n`;
}
