/**
 * 대사기 — named knobs that are not settlement rules (those live in
 * channel-rules.ts). Swap a model here; aggregation in
 * explain-discrepancy.ts does not change.
 *
 * Model ids are the exact catalog strings this repo already pins in
 * lib/league/roster.ts (challenger slots) and lib/oracle/ai/registry.ts.
 */
import type { ExtendedAiProviderName } from '@/lib/ai/router'
import type { PlatformProviderId } from '@/lib/ai/platform-providers'

export type AdvisoryModelSpec = {
  provider: ExtendedAiProviderName | PlatformProviderId
  /** Exact catalog id passed as modelOverride (core) or platform model name. */
  model: string
  /** Set when routing through callPlatformModel (e.g. 'openrouter:mistral-medium-3.5'). */
  platformId?: string
}

/**
 * Multi-AI discrepancy advisory roster. One-line swap per slot.
 * Order is also the tie-break order when aggregating.
 */
export const ADVISORY_MODELS: readonly AdvisoryModelSpec[] = [
  { provider: 'openai', model: 'gpt-5.6-terra' },
  { provider: 'anthropic', model: 'claude-sonnet-5' },
  {
    provider: 'openrouter',
    model: 'mistral-medium-3.5',
    platformId: 'openrouter:mistral-medium-3.5',
  },
]

/** A slow provider should not hold the whole advisory hostage. */
export const ADVISORY_MODEL_TIMEOUT_MS = 30_000

/**
 * Per-model completion ceiling. 250 was enough for a 1-line JSON vote from
 * Terra/HCX, but claude-sonnet-5 hits finish_reason=max_tokens on that
 * budget (empty text, or JSON cut mid-`reasoning`). 700 is the same
 * ceiling this repo already pins for claude-sonnet-5 in the oracle
 * registry (lib/oracle/ai/registry.ts prism). Aggregation is unchanged.
 */
export const ADVISORY_MAX_COMPLETION_TOKENS = 700
