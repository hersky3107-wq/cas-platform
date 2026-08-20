/**
 * Layer-1 provider call. This file is the only oracle AI module that imports
 * `lib/ai`. It is dynamically imported from the live adapter so stub mode
 * and unit tests never construct a network client.
 *
 * sessionId is passed as null to runSingleAiProvider so the core router does
 * not write ai_responses / model_cost_logs against the compare-session FK.
 * Cost is logged here via oracleInsertCostLog after each attempt.
 */
import { callPlatformModel } from '@/lib/ai/platform-providers'
import { runSingleAiProvider } from '@/lib/ai/router'
import { supabaseAdmin } from '@/lib/supabase/server'
import { oracleInsertCostLog } from '../oracle-db'
import { isEmptyModelText } from './parse-layer1'
import type { Layer1RegistryEntry } from './registry'

export type Layer1CallInput = {
  entry: Layer1RegistryEntry
  systemPrompt: string
  userPrompt: string
  timeoutMs: number
  sessionId: string
}

export type Layer1CallResult = {
  text: string | null
  emptyContent: boolean
  error?: string
  tokensIn: number
  tokensOut: number
  latencyMs: number
  brand: string
  model: string
}

export type Layer1Call = (input: Layer1CallInput) => Promise<Layer1CallResult>

async function logCost(input: {
  sessionId: string
  brand: string
  model: string
  tokensIn: number
  tokensOut: number
  latencyMs: number
  error?: string
}): Promise<void> {
  try {
    await oracleInsertCostLog({
      sessionId: input.sessionId,
      aiName: input.brand,
      modelName: input.model,
      promptTokens: input.tokensIn || null,
      completionTokens: input.tokensOut || null,
      totalTokens: input.tokensIn + input.tokensOut || null,
      responseTimeMs: input.latencyMs,
      errorText: input.error ?? null,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn('[oracle] layer1 cost log failed:', message)
  }
}

export async function callLayer1Model(input: Layer1CallInput): Promise<Layer1CallResult> {
  const { entry } = input
  const startedAt = Date.now()

  try {
    if (entry.caller.kind === 'platform') {
      // TRAP (a): generous max_tokens is on the registry entry. Reasoning
      // effort:'minimal' is already on PLATFORM_MODEL_REGISTRY extraRequestParams
      // for the reasoners we use — we do not add a second copy here.
      // TRAP (b): Qwen REJECTS reasoning.enabled=false. Do not send a disable.
      // TRAP (c): Amazon Nova is not in this twelve; if it is added, omit any
      // reasoning option entirely.
      // TRAP (e): MiniMax provider pin lives on the registry extraRequestParams
      // (order:['minimax'], allow_fallbacks:true). Inherited via platformId.
      const res = await callPlatformModel({
        id: entry.caller.platformId,
        systemPrompt: input.systemPrompt,
        userPrompt: input.userPrompt,
        maxCompletionTokens: entry.maxCompletionTokens,
      })
      const text = res.text ?? null
      const emptyContent = isEmptyModelText(text)
      const result: Layer1CallResult = {
        text,
        emptyContent,
        error: res.error,
        tokensIn: res.usage?.promptTokens ?? 0,
        tokensOut: res.usage?.completionTokens ?? 0,
        latencyMs: Date.now() - startedAt,
        brand: entry.brand,
        model: entry.model,
      }
      await logCost({
        sessionId: input.sessionId,
        brand: result.brand,
        model: result.model,
        tokensIn: result.tokensIn,
        tokensOut: result.tokensOut,
        latencyMs: result.latencyMs,
        error: result.error ?? (emptyContent ? 'empty content' : undefined),
      })
      return result
    }

    // TRAP (d): Gemini 3.6 Flash requires thinking — thinkingBudget:0 is an
    // error, not a degrade. allowGeminiThinking is set on the tarot entry.
    const res = await runSingleAiProvider({
      supabase: supabaseAdmin,
      authSupabase: supabaseAdmin,
      sessionId: null,
      userId: null,
      provider: entry.caller.provider,
      prompt: input.userPrompt,
      systemPrompt: input.systemPrompt,
      skipLanguageInjection: true,
      modelOverride: entry.caller.modelOverride,
      allowGeminiThinking: entry.caller.allowGeminiThinking,
      maxCompletionTokens: entry.maxCompletionTokens,
      timeoutMs: input.timeoutMs,
    })
    const text = res.text ?? null
    const emptyContent = isEmptyModelText(text)
    const result: Layer1CallResult = {
      text,
      emptyContent,
      error: res.error,
      tokensIn: res.promptTokens ?? 0,
      tokensOut: res.completionTokens ?? 0,
      latencyMs: res.responseTimeMs || Date.now() - startedAt,
      brand: entry.brand,
      model: entry.model,
    }
    await logCost({
      sessionId: input.sessionId,
      brand: result.brand,
      model: result.model,
      tokensIn: result.tokensIn,
      tokensOut: result.tokensOut,
      latencyMs: result.latencyMs,
      error: result.error ?? (emptyContent ? 'empty content' : undefined),
    })
    return result
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const latencyMs = Date.now() - startedAt
    await logCost({
      sessionId: input.sessionId,
      brand: entry.brand,
      model: entry.model,
      tokensIn: 0,
      tokensOut: 0,
      latencyMs,
      error: message,
    })
    return {
      text: null,
      emptyContent: false,
      error: message,
      tokensIn: 0,
      tokensOut: 0,
      latencyMs,
      brand: entry.brand,
      model: entry.model,
    }
  }
}
