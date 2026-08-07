// LLM Fallback — multi-model executor with circuit breaker integration.
//
// NOVA's primary LLM is Z.AI (via z-ai-web-dev-sdk). When Z.AI is unavailable
// (circuit breaker tripped after 5 consecutive failures, or rate-limited),
// we fall back to TokenRouter (Kimi K3).
//
// This module orchestrates that fallback:
// 1. Check if the primary model is available (circuit breaker).
// 2. If available, try the primary. On success, record success. Done.
// 3. On failure, record the failure. Check if the secondary is available.
// 4. If the secondary is available, try it. On success, record success. Done.
// 5. If both fail (or are unavailable), return the primary's error.
//
// The caller doesn't need to know which model served the request — the result
// shape is the same LlmResult interface used by llm.ts.
//
// Server-side only — uses fetch() (via tokenrouter.ts) and the Z.AI SDK (via llm.ts).

import { llmChat, type LlmResult, type LlmOptions } from './llm'
import { tokenRouterChat } from './tokenrouter'
import { recordSuccess, recordFailure, isModelAvailable, type ModelId } from './model-circuit-breaker'
import { logger } from './logger'

// ── Types ──

/** The set of models NOVA can use, in priority order. */
export type FallbackModelId = ModelId | 'tokenrouter'

/** Options for executeWithFallback. Extends LlmOptions with prompts. */
export interface FallbackOptions extends LlmOptions {
  /** The system prompt (architect/coder/refine instructions). */
  systemPrompt: string
  /** The user prompt (mission + context). */
  userPrompt: string
  /**
   * Which model to try first. Defaults to 'z-ai'.
   * The other model is used as fallback.
   */
  primaryModel?: FallbackModelId
  /**
   * If false, only the primary model is tried (no fallback).
   * Useful when you specifically want a particular model's characteristics
   * (e.g., Kimi K3's reasoning for critiqueHtml).
   * Defaults to true.
   */
  allowFallback?: boolean
}

// ── Main executor ──

/**
 * Execute an LLM chat call with automatic fallback.
 *
 * Flow:
 * 1. Try the primary model (default: Z.AI).
 *    - If the circuit breaker says it's unavailable, skip to step 2.
 *    - On success: record success, return the result.
 *    - On failure: record failure, continue to step 2.
 * 2. If fallback is allowed and the secondary model is available, try it.
 *    - On success: record success, return the result.
 *    - On failure: record failure.
 * 3. Return whichever result we have (prefer the primary's error if both failed,
 *    since the primary is the "preferred" model and its error is more actionable).
 *
 * The result shape matches llm.ts's LlmResult so callers can swap
 * `llmChat(...)` for `executeWithFallback(...)` without changes.
 *
 * @param opts Prompts + standard LLM options (timeout, signal, etc.)
 * @returns LlmResult with ok/text/tokens/ms/error.
 */
export async function executeWithFallback(opts: FallbackOptions): Promise<LlmResult> {
  const primary = opts.primaryModel ?? 'z-ai'
  const allowFallback = opts.allowFallback ?? true
  const secondary: FallbackModelId = primary === 'z-ai' ? 'tokenrouter' : 'z-ai'

  const t0 = Date.now()

  // ── Try primary ──
  const primaryAvailable = isModelAvailable(primary)
  let primaryError: string | null = null
  if (primaryAvailable) {
    const result = await callModel(primary, opts)
    if (result.ok) {
      recordSuccess(primary)
      logger.info('fallback.primary_ok', { model: primary, ms: result.ms, tokens: result.tokens })
      return result
    }
    // Primary failed — record and try fallback
    primaryError = result.error ?? 'unknown error'
    recordFailure(primary, primaryError)
    logger.warn('fallback.primary_failed', { model: primary, error: result.error, ms: result.ms })

    if (!allowFallback) {
      return result
    }
  } else {
    logger.info('fallback.primary_unavailable', { model: primary })
  }

  // ── Try secondary ──
  if (!allowFallback) {
    // Primary was unavailable and fallback isn't allowed — return a clear error
    return {
      ok: false,
      text: '',
      tokens: 0,
      ms: Date.now() - t0,
      error: `The primary model (${primary}) is temporarily unavailable. Please try again in a minute.`,
    }
  }

  const secondaryAvailable = isModelAvailable(secondary)
  if (!secondaryAvailable) {
    // Both unavailable — return a clear error
    logger.warn('fallback.both_unavailable', { primary, secondary })
    return {
      ok: false,
      text: '',
      tokens: 0,
      ms: Date.now() - t0,
      error: 'All AI models are temporarily unavailable. Please try again in a minute.',
    }
  }

  const secondaryResult = await callModel(secondary, opts)
  if (secondaryResult.ok) {
    recordSuccess(secondary)
    logger.info('fallback.secondary_ok', { model: secondary, primary, ms: secondaryResult.ms, tokens: secondaryResult.tokens })
    return secondaryResult
  }

  // Both failed — record secondary failure and return the primary's error
  // (the primary is the "preferred" model; its error is more actionable)
  recordFailure(secondary, secondaryResult.error ?? 'unknown error')
  logger.error('fallback.both_failed', { primary, secondary, primaryError: primaryAvailable ? 'failed' : 'unavailable', secondaryError: secondaryResult.error })

  // If primary was unavailable (not tried), return the secondary's error
  if (!primaryAvailable) {
    return secondaryResult
  }

  // Return the primary's error (we tried it first — its error is more actionable)
  return {
    ok: false,
    text: '',
    tokens: 0,
    ms: Date.now() - t0,
    error: primaryError ?? secondaryResult.error ?? `Both ${primary} and ${secondary} failed.`,
  }
}

// ── Per-model dispatch ──

/**
 * Call a specific model with the given options.
 * Routes to the appropriate backend (Z.AI SDK or TokenRouter fetch).
 */
async function callModel(model: FallbackModelId, opts: FallbackOptions): Promise<LlmResult> {
  switch (model) {
    case 'z-ai':
      return llmChat(opts.systemPrompt, opts.userPrompt, {
        maxTokens: opts.maxTokens,
        temperature: opts.temperature,
        timeoutMs: opts.timeoutMs,
        signal: opts.signal,
      })
    case 'tokenrouter': {
      // TokenRouter is a reasoning model — give it more tokens by default
      // since some may be consumed by chain-of-thought.
      const maxTokens = opts.maxTokens ?? 16000
      const result = await tokenRouterChat(opts.systemPrompt, opts.userPrompt, {
        maxTokens: Math.max(maxTokens, 16000),
        temperature: opts.temperature,
        timeoutMs: opts.timeoutMs,
        signal: opts.signal,
      })
      // Convert TokenRouterResult → LlmResult (drop reasoning field — LlmResult doesn't have it)
      return {
        ok: result.ok,
        text: result.text,
        tokens: result.tokens,
        ms: result.ms,
        error: result.error,
      }
    }
    default: {
      // Exhaustiveness check — if a new model is added to FallbackModelId,
      // this default branch forces a compile error if it's not handled.
      const _exhaustive: never = model
      void _exhaustive
      return {
        ok: false,
        text: '',
        tokens: 0,
        ms: 0,
        error: `Unknown model: ${String(model)}`,
      }
    }
  }
}

// ── Health check ──

/**
 * Get the current availability of all fallback models.
 * Useful for status displays and debugging.
 */
export function getFallbackHealth(): Record<FallbackModelId, boolean> {
  return {
    'z-ai': isModelAvailable('z-ai'),
    'tokenrouter': true, // TokenRouter doesn't have its own circuit breaker — always "available" if configured
  }
}
