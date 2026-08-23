/**
 * Layer-1 provider call. This file is the only oracle AI module that imports
 * `lib/ai`. It is dynamically imported from the live adapter so stub mode
 * and unit tests never construct a network client.
 *
 * sessionId is passed as null to runSingleAiProvider so the core router does
 * not write ai_responses / model_cost_logs against the compare-session FK.
 * Cost is logged once per unit from layer1-adapter after all attempts finish.
 */
import { callPlatformModel } from '@/lib/ai/platform-providers'
import { runSingleAiProvider } from '@/lib/ai/router'
import { supabaseAdmin } from '@/lib/supabase/server'
import type { Layer1HttpBudget } from './http-budget'
import { estimateCostUsdFromPricing, getOpenRouterModelPricing } from './openrouter-pricing'
import { isEmptyModelText } from './parse-layer1'
import type { Layer1RegistryEntry } from './registry'

export type Layer1CallInput = {
  entry: Layer1RegistryEntry
  systemPrompt: string
  userPrompt: string
  timeoutMs: number
  sessionId: string
  /** Shared per-unit HTTP ceiling (adapter + platform). Oracle sets remaining: 2. */
  httpBudget?: Layer1HttpBudget
  /** True only for the structural retry after runaway visible content. */
  strictRetry?: boolean
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
  reasoningTokens: number | null
  contentTokens: number | null
  costUsd: number | null
  costIsEstimated: boolean
  finishReason: string | null
  httpAttempts: number
  finalAttemptMs: number | null
  strictRetry: boolean
  diagnostics: {
    errorClass: string | null
    httpStatus: number | null
    responseBody: string | null
    provider: string | null
  } | null
}

export type Layer1Call = (input: Layer1CallInput) => Promise<Layer1CallResult>

function telemetryFromBudget(
  httpBudget: Layer1HttpBudget | undefined,
  fallbackMs: number,
): { httpAttempts: number; finalAttemptMs: number | null } {
  return {
    httpAttempts: httpBudget?.attempts ?? 1,
    finalAttemptMs: httpBudget?.finalAttemptMs ?? fallbackMs,
  }
}

export async function callLayer1Model(input: Layer1CallInput): Promise<Layer1CallResult> {
  const { entry } = input
  const startedAt = Date.now()
  let coreAttemptStarted = false

  try {
    if (entry.caller.kind === 'platform') {
      const res = await callPlatformModel({
        id: entry.caller.platformId,
        systemPrompt: input.systemPrompt,
        userPrompt: input.userPrompt,
        maxCompletionTokens: entry.maxCompletionTokens,
        extraRequestParams: entry.caller.extraRequestParams,
        debugRequestLabel: entry.system,
        httpBudget: input.httpBudget,
        timeoutMs: Math.max(1, input.timeoutMs - 500),
      })
      const text = res.text ?? null
      const emptyContent = isEmptyModelText(text)
      const latencyMs = Date.now() - startedAt
      if (input.httpBudget && input.httpBudget.attempts === 0) {
        input.httpBudget.attempts = 1
        input.httpBudget.finalAttemptMs = latencyMs
      }
      const telemetry = telemetryFromBudget(input.httpBudget, latencyMs)
      return {
        text,
        emptyContent,
        error: res.error,
        tokensIn: res.usage?.promptTokens ?? 0,
        tokensOut: res.usage?.completionTokens ?? 0,
        latencyMs,
        brand: entry.brand,
        model: entry.model,
        reasoningTokens: res.usage?.reasoningTokens ?? null,
        contentTokens: res.usage?.contentTokens ?? null,
        costUsd: res.costUsd ?? null,
        costIsEstimated: res.costIsEstimated ?? false,
        finishReason: res.finishReason ?? null,
        ...telemetry,
        strictRetry: input.strictRetry ?? false,
        diagnostics: res.diagnostics ?? null,
      }
    }

    if (input.httpBudget && input.httpBudget.remaining <= 0) {
      throw new Error('HTTP budget exhausted for this unit')
    }
    if (input.httpBudget) input.httpBudget.remaining -= 1
    coreAttemptStarted = true

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
    const latencyMs = res.responseTimeMs || Date.now() - startedAt
    if (input.httpBudget) {
      input.httpBudget.attempts += 1
      input.httpBudget.finalAttemptMs = latencyMs
    }
    const pricing = entry.pricingModel
      ? await getOpenRouterModelPricing(entry.pricingModel)
      : null
    const estimatedCostUsd =
      pricing && (res.promptTokens != null || res.completionTokens != null)
        ? estimateCostUsdFromPricing(
            pricing,
            res.promptTokens ?? 0,
            res.completionTokens ?? 0,
          )
        : null
    return {
      text,
      emptyContent,
      error: res.error,
      tokensIn: res.promptTokens ?? 0,
      tokensOut: res.completionTokens ?? 0,
      latencyMs,
      brand: entry.brand,
      model: entry.model,
      reasoningTokens: null,
      contentTokens: res.completionTokens ?? null,
      costUsd: res.costUsd ?? estimatedCostUsd,
      costIsEstimated: res.costUsd == null && estimatedCostUsd != null,
      finishReason: null,
      ...telemetryFromBudget(input.httpBudget, latencyMs),
      strictRetry: input.strictRetry ?? false,
      diagnostics: res.error
        ? {
            errorClass: 'ProviderError',
            httpStatus: null,
            responseBody: res.error,
            provider: entry.caller.provider,
          }
        : null,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const latencyMs = Date.now() - startedAt
    if (coreAttemptStarted && input.httpBudget) {
      input.httpBudget.attempts += 1
      input.httpBudget.finalAttemptMs = latencyMs
    }
    const telemetry = telemetryFromBudget(input.httpBudget, latencyMs)
    return {
      text: null,
      emptyContent: false,
      error: message,
      tokensIn: 0,
      tokensOut: 0,
      latencyMs,
      brand: entry.brand,
      model: entry.model,
      reasoningTokens: null,
      contentTokens: null,
      costUsd: null,
      costIsEstimated: false,
      finishReason: null,
      ...telemetry,
      strictRetry: input.strictRetry ?? false,
      diagnostics: {
        errorClass: error instanceof Error ? error.name : 'UnknownError',
        httpStatus: null,
        responseBody: message,
        provider: entry.caller.kind === 'platform' ? 'openrouter' : entry.caller.provider,
      },
    }
  }
}
