// ============================================================================
// Retry Queue (AA) — auto-retry missions that failed due to 429 rate limit
// ----------------------------------------------------------------------------
// When a build dies because of 429 (after exhausting the 30/60/90s backoffs),
// the mission is enqueued here. A single monitor checks the rate-limit status
// every 10s and, when the per-minute window has cleared (callsThisMinute < 5),
// re-runs the pipeline.
//
// Design:
// - In-memory only (no DB persistence — a server restart drops the queue).
// - At most ONE retry in flight at a time (we don't want to spam the API).
// - Each mission retried up to 3 times with 60s gaps.
// - The user can also drain the queue via the /api/nova/retry-queue endpoint.
// ============================================================================

import { runPipeline } from '@/lib/pipeline';
import { getRateLimitStatus } from '@/lib/rate-limiter';

interface QueuedMission {
  missionId: string;        // original mission ID (for status tracking)
  mission: string;
  qualityTarget: number;
  attempts: number;         // retry attempts so far (capped at 3)
  queuedAt: number;          // Date.now()
  nextAttemptAt: number;    // earliest next attempt (now + 60s gap)
  lastError?: string;
}

const queue: QueuedMission[] = [];
let monitorRunning = false;
const MAX_ATTEMPTS = 3;
const RETRY_GAP_MS = 60 * 1000; // 60s between retries

// Listeners for UI polling — gets called when the queue changes
type QueueListener = (snapshot: { queued: any[]; inFlight: boolean }) => void;
const listeners = new Set<QueueListener>();
function notify() {
  const snapshot = {
    queued: queue.map(q => ({
      missionId: q.missionId, mission: q.mission, attempts: q.attempts,
      queuedAt: q.queuedAt, nextAttemptAt: q.nextAttemptAt, lastError: q.lastError,
    })),
    inFlight: monitorRunning,
  };
  for (const l of listeners) { try { l(snapshot) } catch {} }
}
export function subscribeQueue(listener: QueueListener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener) };
}
export function getQueueSnapshot() {
  return {
    queued: queue.map(q => ({
      missionId: q.missionId, mission: q.mission, attempts: q.attempts,
      queuedAt: q.queuedAt, nextAttemptAt: q.nextAttemptAt, lastError: q.lastError,
    })),
    inFlight: monitorRunning,
  };
}

/** Enqueue a mission for retry. Called by pipeline catch block when 429. */
export function enqueueForRetry(mission: string, qualityTarget: number, missionId: string, error: string) {
  // Don't double-enqueue the same missionId
  if (queue.find(q => q.missionId === missionId)) return;
  queue.push({
    missionId, mission, qualityTarget,
    attempts: 0,
    queuedAt: Date.now(),
    nextAttemptAt: Date.now() + RETRY_GAP_MS,
    lastError: error,
  });
  console.log(`[retry-queue] enqueued mission ${missionId} ("${mission.slice(0, 50)}") — queue size ${queue.length}`);
  notify();
  // Kick the monitor in case it wasn't running
  void runMonitor();
}

/** Remove a mission from the queue (e.g. user manually cancelled). */
export function dequeue(missionId: string) {
  const idx = queue.findIndex(q => q.missionId === missionId);
  if (idx >= 0) { queue.splice(idx, 1); notify(); }
}

/** Drain the entire queue. */
export function clearQueue() {
  queue.length = 0;
  notify();
}

// ── Monitor: try to drain the queue when rate limit is healthy ──
async function runMonitor() {
  if (monitorRunning) return;
  monitorRunning = true;
  try {
    // Loop until queue empty OR no missions ready to retry
    while (queue.length > 0) {
      const now = Date.now();
      // Find a mission that's ready (nextAttemptAt <= now)
      const readyIdx = queue.findIndex(q => q.nextAttemptAt <= now);
      if (readyIdx < 0) {
        // None ready — wait 10s and check again
        await new Promise(r => setTimeout(r, 10000));
        continue;
      }
      const q = queue[readyIdx];
      // Check rate limit health — only fire if we have plenty of headroom
      const status = getRateLimitStatus();
      if (status.callsLastMinute > 5) {
        // Still too many calls — wait 30s and re-check
        await new Promise(r => setTimeout(r, 30000));
        continue;
      }
      // Remove from queue and start the retry
      queue.splice(readyIdx, 1);
      q.attempts++;
      console.log(`[retry-queue] retrying mission ${q.missionId} (attempt ${q.attempts}/${MAX_ATTEMPTS})`);
      notify();
      try {
        const result = await runPipeline(q.mission, {
          missionId: q.missionId, // reuse the same ID for stream continuity
          qualityTarget: q.qualityTarget,
        });
        console.log(`[retry-queue] mission ${q.missionId} retry done: success=${result.success} files=${result.files?.length || 0}`);
        if (!result.success && result.error?.includes('429') && q.attempts < MAX_ATTEMPTS) {
          // Hit 429 again — re-queue with a longer delay
          queue.push({
            ...q,
            nextAttemptAt: Date.now() + RETRY_GAP_MS * (q.attempts + 1),
            lastError: result.error,
          });
        }
      } catch (err: any) {
        // If 429 again and attempts remain, re-queue
        const msg = err?.message || String(err);
        if (msg.includes('429') && q.attempts < MAX_ATTEMPTS) {
          queue.push({
            ...q,
            nextAttemptAt: Date.now() + RETRY_GAP_MS * (q.attempts + 1),
            lastError: msg,
          });
        }
        console.error(`[retry-queue] mission ${q.missionId} retry crashed:`, msg);
      }
      notify();
      // Gap between retries to let the API breathe
      await new Promise(r => setTimeout(r, 5000));
    }
  } finally {
    monitorRunning = false;
    notify();
  }
}
