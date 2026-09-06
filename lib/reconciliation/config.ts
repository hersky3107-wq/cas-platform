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

// ── Step-2 engine knobs ──────────────────────────────────────────────────────
// PII NOTE: every model in ADVISORY_MODELS is US/EU-hosted (OpenAI, Anthropic,
// Mistral via OpenRouter). This roster is reused for match inference, memo
// resolution and classification — personal financial data never goes to a
// Chinese-hosted model. Keep it that way when swapping slots.

/**
 * AI match inference (match-infer.ts) — bounded per run so token cost stays
 * sane: at most MAX_DEPOSITS deposits per run × ADVISORY_MODELS.length calls,
 * each carrying at most MAX_CANDIDATES candidate sales (compact one-line
 * JSON rows), never the whole table.
 */
export const INFER_MAX_DEPOSITS_PER_RUN = 8
export const INFER_MAX_CANDIDATES_PER_DEPOSIT = 40
export const INFER_MAX_COMPLETION_TOKENS = 700
/** Recent owner decisions (approve-with-edit / reject) shown to the models as learning context. */
export const INFER_MAX_CORRECTIONS_SHOWN = 5

/**
 * AI memo → issuer resolution (memo-resolve.ts). All unresolved memos of a
 * run are batched into ONE prompt per model (≤ MAX_PER_RUN rows), so a run
 * costs exactly ADVISORY_MODELS.length calls regardless of deposit count.
 */
export const MEMO_RESOLVE_MAX_PER_RUN = 60
export const MEMO_RESOLVE_MAX_COMPLETION_TOKENS = 1500

/** Unified ingest classification (classify.ts): 2-model cross-check. */
export const CLASSIFY_MAX_COMPLETION_TOKENS = 2000
export const CLASSIFY_MAX_TEXT_CHARS = 8000

/**
 * Deterministic window matching: a deposit with NO candidate sales in its
 * window is only flagged unmatched_deposit after this many days — younger
 * deposits stay open (the owner may simply not have entered the sales yet).
 */
export const UNMATCHED_DEPOSIT_AGE_DAYS = 14
