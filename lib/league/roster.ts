import type { ExtendedAiProviderName } from '@/lib/ai/router'

/**
 * AI Prediction League — model roster (CONFIG, not code).
 *
 * A model changing tier, camp, or price is a data edit HERE ONLY — the
 * orchestrator never hardcodes any model. Add/remove/retier by editing this
 * array. Each entry declares WHICH existing calling utility runs it (`caller`),
 * so no new per-provider API client is ever written:
 *   - kind 'core'     → lib/ai/router.ts `runSingleAiProvider` (core-6 + opt-in
 *                       perplexity/meta). Uses env platform keys or admin BYOK.
 *   - kind 'platform' → lib/ai/platform-providers.ts `callPlatformModel`
 *                       (OpenRouter / Meta Muse / You.com), addressed by registry id.
 *
 * KEY ISOLATION: both callers already select the API key strictly by the
 * model's own provider (getEnvKey / getPlatformEnvKey), so a China-hosted model
 * only ever sees its own provider's key — the orchestrator adds nothing that
 * would cross that boundary.
 *
 * NOTE on CLOVA HCX-007: its platform league is 'sovereign', which is not one
 * of the four ledger tiers (premier/challenger/world/scout) and cannot be
 * stored in model_predictions.league_tier — so it is intentionally omitted here
 * until a tier is assigned. // v2
 */

export type LeagueTier = 'premier' | 'challenger' | 'world' | 'scout'
export type Camp = 'us' | 'china' | 'other'

export type LeagueCaller =
  | {
      kind: 'core'
      provider: ExtendedAiProviderName
      /** Pin an exact model; omit to use MODEL_BY_PROVIDER's current default. */
      modelOverride?: string
      /** Google-only: let reasoning models run in default thinking mode. */
      allowGeminiThinking?: boolean
    }
  | {
      kind: 'platform'
      /** PLATFORM_MODEL_REGISTRY id, e.g. 'openrouter:qwen3.8-max'. */
      platformId: string
    }

export type RosterEntry = {
  /** Canonical model string stored on model_predictions.model_id (the actual
   *  resolved model overrides this when the caller reports one). */
  model_id: string
  brand: string
  camp: Camp
  league_tier: LeagueTier
  /** Human-facing provider identity (openai, openrouter, youcom, …). */
  provider_key: string
  /** Reasoning-by-default model (affects budget/cost expectations, not routing). */
  reasoning: boolean
  /** Per-model completion-token override (e.g. Xiaomi needs extra headroom). */
  maxCompletionTokens?: number
  caller: LeagueCaller
  /**
   * FALLBACK per-token price, USD per 1,000,000 tokens (APPROX public list
   * price — edit to your contracts). Used ONLY when the provider does not report
   * a real billed cost. OpenRouter calls now return their actual usage.cost, so
   * for OpenRouter-routed models this estimate is not used. Core/Meta models
   * (no reported cost) still fall back to this. Unknown → 0.
   */
  price: { inputPerMTokens: number; outputPerMTokens: number }
}

export const LEAGUE_ROSTER: RosterEntry[] = [
  // ── Premier: US frontier (core) + China frontier (platform/OpenRouter) ──
  { model_id: 'gpt-4o', brand: 'OpenAI', camp: 'us', league_tier: 'premier', provider_key: 'openai', reasoning: false, caller: { kind: 'core', provider: 'openai' }, price: { inputPerMTokens: 2.5, outputPerMTokens: 10 } },
  { model_id: 'claude-sonnet-4-6', brand: 'Anthropic', camp: 'us', league_tier: 'premier', provider_key: 'anthropic', reasoning: false, caller: { kind: 'core', provider: 'anthropic' }, price: { inputPerMTokens: 3, outputPerMTokens: 15 } },
  { model_id: 'gemini-3.5-flash', brand: 'Google', camp: 'us', league_tier: 'premier', provider_key: 'google', reasoning: false, caller: { kind: 'core', provider: 'google' }, price: { inputPerMTokens: 0.3, outputPerMTokens: 2.5 } },
  { model_id: 'grok-3', brand: 'xAI', camp: 'us', league_tier: 'premier', provider_key: 'xai', reasoning: false, caller: { kind: 'core', provider: 'xai' }, price: { inputPerMTokens: 3, outputPerMTokens: 15 } },
  { model_id: 'qwen/qwen3.8-max', brand: 'Qwen', camp: 'china', league_tier: 'premier', provider_key: 'openrouter', reasoning: true, caller: { kind: 'platform', platformId: 'openrouter:qwen3.8-max' }, price: { inputPerMTokens: 1.2, outputPerMTokens: 6 } },
  { model_id: 'moonshotai/kimi-k3', brand: 'Moonshot AI', camp: 'china', league_tier: 'premier', provider_key: 'openrouter', reasoning: true, caller: { kind: 'platform', platformId: 'openrouter:kimi-k3' }, price: { inputPerMTokens: 0.6, outputPerMTokens: 2.5 } },
  { model_id: 'z-ai/glm-5.2', brand: 'Z.ai', camp: 'china', league_tier: 'premier', provider_key: 'openrouter', reasoning: true, caller: { kind: 'platform', platformId: 'openrouter:glm-5.2' }, price: { inputPerMTokens: 0.6, outputPerMTokens: 2.2 } },
  { model_id: 'minimax/minimax-m3', brand: 'MiniMax', camp: 'china', league_tier: 'premier', provider_key: 'openrouter', reasoning: true, caller: { kind: 'platform', platformId: 'openrouter:minimax-m3' }, price: { inputPerMTokens: 0.5, outputPerMTokens: 2.2 } },
  { model_id: 'muse-spark-1.2', brand: 'Meta', camp: 'us', league_tier: 'premier', provider_key: 'meta-muse', reasoning: true, caller: { kind: 'platform', platformId: 'meta-muse:muse-spark-1.2' }, price: { inputPerMTokens: 0, outputPerMTokens: 0 } },

  // ── Challenger ──
  { model_id: 'deepseek-chat', brand: 'DeepSeek', camp: 'china', league_tier: 'challenger', provider_key: 'deepseek', reasoning: false, caller: { kind: 'core', provider: 'deepseek' }, price: { inputPerMTokens: 0.27, outputPerMTokens: 1.1 } },
  { model_id: 'mistral-large-latest', brand: 'Mistral', camp: 'other', league_tier: 'challenger', provider_key: 'mistral', reasoning: false, caller: { kind: 'core', provider: 'mistral' }, price: { inputPerMTokens: 2, outputPerMTokens: 6 } },
  { model_id: 'nvidia/nemotron-3-ultra-550b-a55b', brand: 'NVIDIA', camp: 'us', league_tier: 'challenger', provider_key: 'openrouter', reasoning: true, caller: { kind: 'platform', platformId: 'openrouter:nemotron-3-ultra-550b' }, price: { inputPerMTokens: 0.6, outputPerMTokens: 2.4 } },
  { model_id: 'cohere/command-a', brand: 'Cohere', camp: 'other', league_tier: 'challenger', provider_key: 'openrouter', reasoning: false, caller: { kind: 'platform', platformId: 'openrouter:command-a' }, price: { inputPerMTokens: 2.5, outputPerMTokens: 10 } },

  // ── World (first cheap cost test targets this tier: all OpenRouter) ──
  { model_id: 'xiaomi/mimo-v2.5', brand: 'Xiaomi', camp: 'china', league_tier: 'world', provider_key: 'openrouter', reasoning: true, maxCompletionTokens: 2500, caller: { kind: 'platform', platformId: 'openrouter:mimo-v2.5' }, price: { inputPerMTokens: 0.2, outputPerMTokens: 0.6 } },
  { model_id: 'bytedance-seed/seed-1.6', brand: 'ByteDance', camp: 'china', league_tier: 'world', provider_key: 'openrouter', reasoning: false, caller: { kind: 'platform', platformId: 'openrouter:seed-1.6' }, price: { inputPerMTokens: 0.3, outputPerMTokens: 1.2 } },
  { model_id: 'baidu/ernie-4.5-vl-424b-a47b', brand: 'Baidu', camp: 'china', league_tier: 'world', provider_key: 'openrouter', reasoning: false, caller: { kind: 'platform', platformId: 'openrouter:ernie-4.5-vl' }, price: { inputPerMTokens: 0.28, outputPerMTokens: 1.1 } },
  { model_id: 'amazon/nova-2-lite-v1', brand: 'Amazon', camp: 'us', league_tier: 'world', provider_key: 'openrouter', reasoning: false, caller: { kind: 'platform', platformId: 'openrouter:nova-2-lite' }, price: { inputPerMTokens: 0.06, outputPerMTokens: 0.24 } },
  { model_id: 'meta-llama/llama-4-maverick', brand: 'Meta', camp: 'us', league_tier: 'world', provider_key: 'openrouter', reasoning: false, caller: { kind: 'platform', platformId: 'openrouter:llama-4-maverick' }, price: { inputPerMTokens: 0.2, outputPerMTokens: 0.6 } },
  { model_id: 'microsoft/phi-4', brand: 'Microsoft', camp: 'us', league_tier: 'world', provider_key: 'openrouter', reasoning: false, caller: { kind: 'platform', platformId: 'openrouter:phi-4' }, price: { inputPerMTokens: 0.07, outputPerMTokens: 0.14 } },

  // ── Scout (research agents; scored on citation accuracy, not direction —
  //     reconciliation leaves is_correct null for this tier). ──
  { model_id: 'research-agent', brand: 'You.com', camp: 'us', league_tier: 'scout', provider_key: 'youcom', reasoning: true, caller: { kind: 'platform', platformId: 'youcom:research' }, price: { inputPerMTokens: 0, outputPerMTokens: 0 } },
  { model_id: 'sonar', brand: 'Perplexity', camp: 'us', league_tier: 'scout', provider_key: 'perplexity', reasoning: false, caller: { kind: 'core', provider: 'perplexity' }, price: { inputPerMTokens: 1, outputPerMTokens: 1 } },
]

/** Roster subset by tier (e.g. run only 'world' first to keep the cost test cheap). */
export function getRoster(tiers?: LeagueTier[]): RosterEntry[] {
  if (!tiers || tiers.length === 0) return LEAGUE_ROSTER
  const set = new Set(tiers)
  return LEAGUE_ROSTER.filter((m) => set.has(m.league_tier))
}

/** cost (USD) = tokens × per-model price. Missing tokens/price → 0. */
export function computeCostUsd(
  entry: RosterEntry,
  promptTokens: number | null,
  completionTokens: number | null
): number {
  const pt = typeof promptTokens === 'number' ? promptTokens : 0
  const ct = typeof completionTokens === 'number' ? completionTokens : 0
  return (pt / 1_000_000) * entry.price.inputPerMTokens + (ct / 1_000_000) * entry.price.outputPerMTokens
}
