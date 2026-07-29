// ============================================================================
// Rate Limiter — ensures we don't spam the LLM API and hit 429 errors
// ----------------------------------------------------------------------------
// Tracks calls per minute + enforces minimum delay between calls.
// The Z.AI API allows ~20 calls per minute, so we target 15 to be safe.
// PROACTIVE WAIT: when we're at SOFT_LIMIT (13/15), we wait for the window to
// expire BEFORE firing — this avoids the 30/60/90s backoff penalty after a 429.
// ============================================================================

let lastCallTime = 0;
const MIN_DELAY_MS = 3000; // 3 seconds between calls (20/min max)
const MAX_CALLS_PER_MIN = 15;
const SOFT_LIMIT = 13; // start waiting proactively at 13/15 to avoid hitting 429
const callsThisMinute: number[] = []; // timestamps of recent calls

/**
 * Wait for rate limit clearance before making an LLM call.
 * Only successful calls count toward the per-minute limit.
 */
export async function waitForRateLimit(isRetry = false): Promise<void> {
  const now = Date.now();

  // Retries (429) don't count toward the per-minute limit
  if (!isRetry) {
    // Clean old entries (older than 60s)
    while (callsThisMinute.length > 0 && callsThisMinute[0] < now - 60000) {
      callsThisMinute.shift();
    }

    // If we're past the SOFT_LIMIT, wait until the oldest call expires.
    // This is the PROACTIVE wait — we'd rather wait 5-30s now than 30-90s after a 429.
    if (callsThisMinute.length >= SOFT_LIMIT) {
      const waitUntil = callsThisMinute[0] + 60000;
      const waitMs = waitUntil - now;
      if (waitMs > 0) {
        // Cap the proactive wait at 30s — if the window is older than that, the
        // 429 retry path will handle it (and we don't want to stall forever).
        await new Promise(r => setTimeout(r, Math.min(waitMs, 30000)));
      }
      // Clean again after waiting
      const now2 = Date.now();
      while (callsThisMinute.length > 0 && callsThisMinute[0] < now2 - 60000) {
        callsThisMinute.shift();
      }
    }

    // Hard limit: if somehow we're already at MAX, definitely wait (safety net)
    if (callsThisMinute.length >= MAX_CALLS_PER_MIN) {
      const waitUntil = callsThisMinute[0] + 60000;
      const waitMs = waitUntil - Date.now();
      if (waitMs > 0) {
        await new Promise(r => setTimeout(r, waitMs));
      }
      const now3 = Date.now();
      while (callsThisMinute.length > 0 && callsThisMinute[0] < now3 - 60000) {
        callsThisMinute.shift();
      }
    }
  }

  // Enforce minimum delay between ALL calls (including retries)
  const elapsed = now - lastCallTime;
  const delayWait = Math.max(0, MIN_DELAY_MS - elapsed);
  if (delayWait > 0) {
    await new Promise(r => setTimeout(r, delayWait));
  }

  // Record this call (only non-retries count toward per-minute limit)
  lastCallTime = Date.now();
  if (!isRetry) {
    callsThisMinute.push(lastCallTime);
  }
}

/**
 * Get rate limit status for display.
 */
export function getRateLimitStatus(): {
  callsLastMinute: number;
  maxCallsPerMinute: number;
  nextAvailableIn: number;
  queueLength: number;
} {
  const now = Date.now();
  // Clean old entries
  while (callsThisMinute.length > 0 && callsThisMinute[0] < now - 60000) {
    callsThisMinute.shift();
  }
  const elapsed = now - lastCallTime;
  return {
    callsLastMinute: callsThisMinute.length,
    maxCallsPerMinute: MAX_CALLS_PER_MIN,
    nextAvailableIn: Math.max(0, MIN_DELAY_MS - elapsed),
    queueLength: 0,
  };
}
