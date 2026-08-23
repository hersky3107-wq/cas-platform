import { getPlatformModelEntry } from '@/lib/ai/platform-providers'
import { oracleInsertCostLog } from '../oracle-db'
import type { Layer1HttpBudget } from './http-budget'
import { estimateCostUsdFromPricing, getOpenRouterModelPricing } from './openrouter-pricing'
import type { Layer1RegistryEntry } from './registry'

export type Layer1CostInput = {
  sessionId: string
  entry: Layer1RegistryEntry
  promptTokens: number
  completionTokens: number
  /** Provider-reported USD when available (OpenRouter `usage.cost`). */
  providerCostUsd: number | null
  costIsEstimated: boolean
  cumulativeMs: number
  httpBudget: Layer1HttpBudget
  errorText?: string | null
}

export async function resolveLayer1CostUsd(input: {
  entry: Layer1RegistryEntry
  promptTokens: number
  completionTokens: number
  providerCostUsd: number | null
  costIsEstimated: boolean
}): Promise<{ costUsd: number | null; isEstimated: boolean | null }> {
  if (typeof input.providerCostUsd === 'number' && Number.isFinite(input.providerCostUsd)) {
    return { costUsd: input.providerCostUsd, isEstimated: input.costIsEstimated }
  }

  const platformId =
    input.entry.caller.kind === 'platform' ? input.entry.caller.platformId : null
  const registryModel =
    input.entry.pricingModel ??
    (platformId != null ? (getPlatformModelEntry(platformId)?.model ?? input.entry.model) : input.entry.model)

  const pricing = await getOpenRouterModelPricing(registryModel)
  if (!pricing || (input.promptTokens <= 0 && input.completionTokens <= 0)) {
    return { costUsd: null, isEstimated: null }
  }

  return {
    costUsd: estimateCostUsdFromPricing(pricing, input.promptTokens, input.completionTokens),
    isEstimated: true,
  }
}

export async function logLayer1UnitCost(input: Layer1CostInput): Promise<void> {
  const { costUsd, isEstimated } = await resolveLayer1CostUsd({
    entry: input.entry,
    promptTokens: input.promptTokens,
    completionTokens: input.completionTokens,
    providerCostUsd: input.providerCostUsd,
    costIsEstimated: input.costIsEstimated,
  })

  try {
    await oracleInsertCostLog({
      sessionId: null,
      oracleSessionId: input.sessionId,
      aiName: input.entry.brand,
      modelName: input.entry.model,
      promptTokens: input.promptTokens || null,
      completionTokens: input.completionTokens || null,
      totalTokens: input.promptTokens + input.completionTokens || null,
      responseTimeMs: input.cumulativeMs,
      costUsd,
      isEstimated,
      httpAttempts: input.httpBudget.attempts || null,
      finalAttemptMs: input.httpBudget.finalAttemptMs,
      errorText: input.errorText ?? null,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn('[oracle] layer1 unit cost log failed:', message)
  }
}
