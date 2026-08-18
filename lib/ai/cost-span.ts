import { AsyncLocalStorage } from 'node:async_hooks'

/**
 * Process-local cost accumulator for one in-flight league (or other) run.
 * `runSingleAiProvider` taps this after each call. Callers wrap their work
 * in `withCostSpan` and read the summed USD afterwards.
 *
 * Additive, never changes provider behavior. Used to instrument the real
 * upstream cost of a deep-analysis run so the 50/70 credit prices can be
 * checked against dollars spent — not to change those prices.
 */

type CostStore = { billedUsd: number; estimatedUsd: number; calls: number }

const als = new AsyncLocalStorage<CostStore>()

/** Conservative mid-flagship fallback when a provider reports tokens but no billed USD. */
const FALLBACK_PER_M = { input: 2.5, output: 12.5 }

export function recordProviderCost(usage: {
  costUsd?: number | null
  promptTokens?: number | null
  completionTokens?: number | null
}): void {
  const store = als.getStore()
  if (!store) return
  store.calls += 1
  if (typeof usage.costUsd === 'number' && usage.costUsd > 0) {
    store.billedUsd += usage.costUsd
    return
  }
  const inTok = usage.promptTokens ?? 0
  const outTok = usage.completionTokens ?? 0
  if (inTok > 0 || outTok > 0) {
    store.estimatedUsd += (inTok / 1_000_000) * FALLBACK_PER_M.input + (outTok / 1_000_000) * FALLBACK_PER_M.output
  }
}

export async function withCostSpan<T>(fn: () => Promise<T>): Promise<{ result: T; billedUsd: number; estimatedUsd: number; calls: number }> {
  const store: CostStore = { billedUsd: 0, estimatedUsd: 0, calls: 0 }
  const result = await als.run(store, fn)
  return { result, billedUsd: store.billedUsd, estimatedUsd: store.estimatedUsd, calls: store.calls }
}

/** Prefer billed dollars; fall back to the token estimate when nothing billed. */
export function combinedCostUsd(span: { billedUsd: number; estimatedUsd: number }): number {
  return span.billedUsd > 0 ? span.billedUsd + span.estimatedUsd : span.estimatedUsd
}
