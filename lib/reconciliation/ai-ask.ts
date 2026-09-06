import 'server-only'

import { callPlatformModel } from '@/lib/ai/platform-providers'
import { runSingleAiProvider, type ExtendedAiProviderName } from '@/lib/ai/router'
import { supabaseAdmin } from '@/lib/supabase/server'
import { ADVISORY_MODEL_TIMEOUT_MS, type AdvisoryModelSpec } from '@/lib/reconciliation/config'
import type { OwnedScope } from '@/lib/reconciliation/scope'

/**
 * Shared strict-JSON multi-model asker for the Step-2 AI layer (match
 * inference, memo resolution, classification). Same provider plumbing as
 * explain-discrepancy.ts's askOneModel, generalized: the caller owns the
 * prompt and parses the JSON payload; this module owns transport, timeout,
 * extraction and never-throw semantics.
 *
 * SERVER-ONLY by import; models come from ADVISORY_MODELS-style specs
 * (US/EU-hosted only — this path carries personal financial data).
 */

export type ModelJsonAnswer = {
  model: string
  /** Parsed top-level JSON value (object or array), or null on any failure. */
  json: unknown | null
  elapsed_ms: number
  ok: boolean
}

/** Extract the first top-level JSON object OR array from model text. */
export function extractJsonValue(text: string): unknown | null {
  const cleaned = text.replace(/```(?:json)?/gi, '').trim()
  for (const [open, close] of [
    ['{', '}'],
    ['[', ']'],
  ] as const) {
    const start = cleaned.indexOf(open)
    const end = cleaned.lastIndexOf(close)
    if (start < 0 || end <= start) continue
    try {
      return JSON.parse(cleaned.slice(start, end + 1)) as unknown
    } catch {
      /* try the other shape */
    }
  }
  return null
}

/** One model, one strict-JSON question. Never throws. */
export async function askModelJson(
  scope: OwnedScope,
  spec: AdvisoryModelSpec,
  systemPrompt: string,
  userPrompt: string,
  maxCompletionTokens: number
): Promise<ModelJsonAnswer> {
  const t0 = Date.now()
  try {
    if (spec.platformId || spec.provider === 'clova') {
      const platformId = spec.platformId ?? `clova:${spec.model.toLowerCase()}`
      const res = await callPlatformModel({
        id: platformId,
        systemPrompt,
        userPrompt,
        maxCompletionTokens,
        timeoutMs: ADVISORY_MODEL_TIMEOUT_MS,
      })
      const elapsed_ms = Date.now() - t0
      const json = res.text ? extractJsonValue(res.text) : null
      if (json == null) {
        console.warn(
          `[reconciliation:ai] ${spec.model} no-json finishReason=${res.finishReason ?? 'n/a'} error=${res.error ?? 'none'} elapsed_ms=${elapsed_ms}`
        )
      }
      return { model: spec.model, json, elapsed_ms, ok: json != null }
    }

    const result = await runSingleAiProvider({
      supabase: supabaseAdmin,
      sessionId: null,
      userId: scope.userId,
      provider: spec.provider as ExtendedAiProviderName,
      modelOverride: spec.model,
      // Omit temperature: gpt-5.6-terra rejects 0, claude-sonnet-5 rejects the field.
      systemPrompt,
      prompt: userPrompt,
      maxCompletionTokens,
      skipLanguageInjection: true,
      timeoutMs: ADVISORY_MODEL_TIMEOUT_MS,
    })
    const elapsed_ms = result.responseTimeMs
    const json = result.text ? extractJsonValue(result.text) : null
    if (json == null) {
      console.warn(
        `[reconciliation:ai] ${spec.model} no-json finishReason=${result.finishReason ?? 'n/a'} error=${result.error ?? 'none'} elapsed_ms=${elapsed_ms}`
      )
    }
    return { model: result.model || spec.model, json, elapsed_ms, ok: json != null }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    console.warn(`[reconciliation:ai] ${spec.model} THROWN elapsed_ms=${Date.now() - t0}:`, msg)
    return { model: spec.model, json: null, elapsed_ms: Date.now() - t0, ok: false }
  }
}

/** Ask several models the same question in parallel. */
export async function askModelsJson(
  scope: OwnedScope,
  specs: readonly AdvisoryModelSpec[],
  systemPrompt: string,
  userPrompt: string,
  maxCompletionTokens: number
): Promise<ModelJsonAnswer[]> {
  return Promise.all(
    specs.map((spec) => askModelJson(scope, spec, systemPrompt, userPrompt, maxCompletionTokens))
  )
}
