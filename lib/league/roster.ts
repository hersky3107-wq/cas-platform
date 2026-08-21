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
 *                       (OpenRouter / Meta Muse / You.com / CLOVA / Upstage /
 *                       Friendli), addressed by registry id.
 *
 * KEY ISOLATION: both callers already select the API key strictly by the
 * model's own provider (getEnvKey / getPlatformEnvKey), so a China-hosted model
 * only ever sees its own provider's key — the orchestrator adds nothing that
 * would cross that boundary.
 *
 * OFFICIAL ROSTER (locked 2026-08-16): 40 models — 10 premier / 10 challenger
 * / 14 world (incl. all three Korean models, world tier per owner decision —
 * no sovereign tier exists in the ledger schema) / 6 scout (all genuinely
 * search-capable endpoints, no padding). Model strings were mapped to the
 * provider catalogs live on 2026-08-16 (scripts/probe-model-catalogs.ts);
 * deviations from the requested version labels are noted inline per entry.
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
      /**
       * Scout only: enable the provider's server-side web search (xAI Live
       * Search / Anthropic web_search / Google grounding). No-op elsewhere.
       */
      searchTool?: boolean
    }
  | {
      kind: 'platform'
      /** PLATFORM_MODEL_REGISTRY id, e.g. 'openrouter:qwen3.8-max'. */
      platformId: string
    }

export type RosterEntry = {
  /** Canonical id stored on model_predictions.model_id. Chosen per SLOT (not
   *  per provider model string) so two slots that resolve to the same actual
   *  model — e.g. challenger gemini-3.6-flash vs scout gemini-3.6-flash
   *  grounded — never collide on the (round_id, model_id) unique key. */
  model_id: string
  brand: string
  /** Consumer-facing product name shown as "Brand (Product)" when set. */
  product_alias?: string
  camp: Camp
  league_tier: LeagueTier
  /** Human-facing provider identity (openai, openrouter, youcom, …). */
  provider_key: string
  /** Reasoning-by-default model (affects budget/cost expectations, not routing). */
  reasoning: boolean
  /** Per-model completion-token override (e.g. Xiaomi needs extra headroom). */
  maxCompletionTokens?: number
  /** Per-model timeout override (live-search endpoints can exceed the 60s default). */
  timeoutMs?: number
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
  // ── 🔴 PREMIER (10) — US 5 : CN 5 ────────────────────────────────────────
  { model_id: 'gpt-5.6-sol', brand: 'OpenAI', product_alias: 'ChatGPT', camp: 'us', league_tier: 'premier', provider_key: 'openai', reasoning: true, caller: { kind: 'core', provider: 'openai', modelOverride: 'gpt-5.6-sol' }, price: { inputPerMTokens: 2.5, outputPerMTokens: 12.5 } },
  { model_id: 'claude-fable-5', brand: 'Anthropic', product_alias: 'Claude', camp: 'us', league_tier: 'premier', provider_key: 'anthropic', reasoning: false, caller: { kind: 'core', provider: 'anthropic', modelOverride: 'claude-fable-5' }, price: { inputPerMTokens: 5, outputPerMTokens: 25 } },
  // Catalog id carries the -preview suffix; that IS the Gemini 3.1 Pro endpoint.
  { model_id: 'gemini-3.1-pro', brand: 'Google', product_alias: 'Gemini', camp: 'us', league_tier: 'premier', provider_key: 'google', reasoning: true, caller: { kind: 'core', provider: 'google', modelOverride: 'gemini-3.1-pro-preview', allowGeminiThinking: true }, price: { inputPerMTokens: 2, outputPerMTokens: 12 } },
  { model_id: 'grok-4.5', brand: 'xAI', product_alias: 'Grok', camp: 'us', league_tier: 'premier', provider_key: 'xai', reasoning: true, caller: { kind: 'core', provider: 'xai', modelOverride: 'grok-4.5' }, price: { inputPerMTokens: 3, outputPerMTokens: 15 } },
  { model_id: 'muse-spark-1.2', brand: 'Meta Muse', product_alias: 'Muse', camp: 'us', league_tier: 'premier', provider_key: 'meta-muse', reasoning: true, caller: { kind: 'platform', platformId: 'meta-muse:muse-spark-1.2' }, price: { inputPerMTokens: 0, outputPerMTokens: 0 } },
  { model_id: 'qwen3.8-max', brand: 'Qwen', camp: 'china', league_tier: 'premier', provider_key: 'openrouter', reasoning: true, maxCompletionTokens: 3000, caller: { kind: 'platform', platformId: 'openrouter:qwen3.8-max' }, price: { inputPerMTokens: 1.2, outputPerMTokens: 6 } },
  // v4-pro spends any budget ≤3000 entirely on hidden reasoning (confirmed
  // live 2026-08-16: finish_reason=length at reasoning_tokens=3000/3000
  // despite reasoning-effort minimal) — 6000 is the working budget.
  { model_id: 'deepseek-v4-pro', brand: 'DeepSeek', camp: 'china', league_tier: 'premier', provider_key: 'openrouter', reasoning: true, maxCompletionTokens: 6000, timeoutMs: 240_000, caller: { kind: 'platform', platformId: 'openrouter:deepseek-v4-pro' }, price: { inputPerMTokens: 0.9, outputPerMTokens: 3.5 } },
  { model_id: 'kimi-k3', brand: 'Moonshot AI', product_alias: 'Kimi', camp: 'china', league_tier: 'premier', provider_key: 'openrouter', reasoning: true, maxCompletionTokens: 3000, caller: { kind: 'platform', platformId: 'openrouter:kimi-k3' }, price: { inputPerMTokens: 0.6, outputPerMTokens: 2.5 } },
  { model_id: 'glm-5.2', brand: 'Z.ai', product_alias: 'GLM', camp: 'china', league_tier: 'premier', provider_key: 'openrouter', reasoning: true, maxCompletionTokens: 3000, caller: { kind: 'platform', platformId: 'openrouter:glm-5.2' }, price: { inputPerMTokens: 0.6, outputPerMTokens: 2.2 } },
  { model_id: 'minimax-m3', brand: 'MiniMax', camp: 'china', league_tier: 'premier', provider_key: 'openrouter', reasoning: true, maxCompletionTokens: 3000, caller: { kind: 'platform', platformId: 'openrouter:minimax-m3' }, price: { inputPerMTokens: 0.5, outputPerMTokens: 2.2 } },

  // ── 🔵 CHALLENGER (10) ───────────────────────────────────────────────────
  { model_id: 'gpt-5.6-terra', brand: 'OpenAI', product_alias: 'ChatGPT', camp: 'us', league_tier: 'challenger', provider_key: 'openai', reasoning: true, caller: { kind: 'core', provider: 'openai', modelOverride: 'gpt-5.6-terra' }, price: { inputPerMTokens: 1.25, outputPerMTokens: 6.25 } },
  { model_id: 'claude-sonnet-5', brand: 'Anthropic', product_alias: 'Claude', camp: 'us', league_tier: 'challenger', provider_key: 'anthropic', reasoning: false, caller: { kind: 'core', provider: 'anthropic', modelOverride: 'claude-sonnet-5' }, price: { inputPerMTokens: 3, outputPerMTokens: 15 } },
  // Confirmed live 2026-08-16: gemini-3.6-flash / 3.5-flash-lite REJECT
  // thinkingConfig:{thinkingBudget:0} (HTTP 400 INVALID_ARGUMENT), so they
  // run with allowGeminiThinking (default thinking mode) like 3.1-pro.
  { model_id: 'gemini-3.6-flash', brand: 'Google', product_alias: 'Gemini', camp: 'us', league_tier: 'challenger', provider_key: 'google', reasoning: true, caller: { kind: 'core', provider: 'google', modelOverride: 'gemini-3.6-flash', allowGeminiThinking: true }, price: { inputPerMTokens: 0.5, outputPerMTokens: 3 } },
  { model_id: 'grok-4.3', brand: 'xAI', product_alias: 'Grok', camp: 'us', league_tier: 'challenger', provider_key: 'xai', reasoning: true, caller: { kind: 'core', provider: 'xai', modelOverride: 'grok-4.3' }, price: { inputPerMTokens: 1.5, outputPerMTokens: 7.5 } },
  // Reasoning-heavy challengers: the 1200-token default is consumed ENTIRELY
  // by hidden reasoning (content null, finish_reason=length, confirmed live
  // 2026-08-16) — 3000 leaves room for the visible JSON after reasoning.
  { model_id: 'nemotron-3-ultra-550b', brand: 'NVIDIA', product_alias: 'Nemotron', camp: 'us', league_tier: 'challenger', provider_key: 'openrouter', reasoning: true, maxCompletionTokens: 3000, caller: { kind: 'platform', platformId: 'openrouter:nemotron-3-ultra-550b' }, price: { inputPerMTokens: 0.6, outputPerMTokens: 2.4 } },
  { model_id: 'mistral-medium-3.5', brand: 'Mistral', camp: 'other', league_tier: 'challenger', provider_key: 'openrouter', reasoning: false, caller: { kind: 'platform', platformId: 'openrouter:mistral-medium-3.5' }, price: { inputPerMTokens: 0.5, outputPerMTokens: 1.6 } },
  // Roster asked for "Command A+"; no A+ exists in the catalog — command-a is
  // the closest wired equivalent (substitution, flagged in the run report).
  { model_id: 'command-a', brand: 'Cohere', product_alias: 'Command', camp: 'other', league_tier: 'challenger', provider_key: 'openrouter', reasoning: false, caller: { kind: 'platform', platformId: 'openrouter:command-a' }, price: { inputPerMTokens: 2.5, outputPerMTokens: 10 } },
  { model_id: 'qwen3.5-plus', brand: 'Qwen', camp: 'china', league_tier: 'challenger', provider_key: 'openrouter', reasoning: true, maxCompletionTokens: 3000, caller: { kind: 'platform', platformId: 'openrouter:qwen3.5-plus' }, price: { inputPerMTokens: 0.6, outputPerMTokens: 3 } },
  { model_id: 'deepseek-v3.2', brand: 'DeepSeek', camp: 'china', league_tier: 'challenger', provider_key: 'openrouter', reasoning: true, maxCompletionTokens: 3000, caller: { kind: 'platform', platformId: 'openrouter:deepseek-v3.2' }, price: { inputPerMTokens: 0.5, outputPerMTokens: 2 } },
  // Same 3000-token reasoning exhaustion as deepseek-v4-pro (see above) —
  // confirmed live 2026-08-16 that 8000 returns content (~1.1k used) on a
  // league-sized prompt; the empty-content retry doubles latency under load,
  // hence the 240s timeout.
  { model_id: 'kimi-k2.6', brand: 'Moonshot AI', product_alias: 'Kimi', camp: 'china', league_tier: 'challenger', provider_key: 'openrouter', reasoning: true, maxCompletionTokens: 8000, timeoutMs: 240_000, caller: { kind: 'platform', platformId: 'openrouter:kimi-k2.6' }, price: { inputPerMTokens: 0.5, outputPerMTokens: 2 } },

  // ── 🟢 WORLD (14) — incl. the three Korean models (no sovereign tier) ────
  { model_id: 'gpt-5.6-luna', brand: 'OpenAI', product_alias: 'ChatGPT', camp: 'us', league_tier: 'world', provider_key: 'openai', reasoning: true, caller: { kind: 'core', provider: 'openai', modelOverride: 'gpt-5.6-luna' }, price: { inputPerMTokens: 0.5, outputPerMTokens: 2.5 } },
  { model_id: 'claude-haiku-4.5', brand: 'Anthropic', product_alias: 'Claude', camp: 'us', league_tier: 'world', provider_key: 'anthropic', reasoning: false, caller: { kind: 'core', provider: 'anthropic', modelOverride: 'claude-haiku-4-5-20251001' }, price: { inputPerMTokens: 1, outputPerMTokens: 5 } },
  { model_id: 'gemini-3.5-flash-lite', brand: 'Google', product_alias: 'Gemini', camp: 'us', league_tier: 'world', provider_key: 'google', reasoning: true, caller: { kind: 'core', provider: 'google', modelOverride: 'gemini-3.5-flash-lite', allowGeminiThinking: true }, price: { inputPerMTokens: 0.15, outputPerMTokens: 1 } },
  { model_id: 'llama-4-maverick', brand: 'Meta', product_alias: 'Llama', camp: 'us', league_tier: 'world', provider_key: 'openrouter', reasoning: false, caller: { kind: 'platform', platformId: 'openrouter:llama-4-maverick' }, price: { inputPerMTokens: 0.2, outputPerMTokens: 0.6 } },
  { model_id: 'nova-2-lite', brand: 'Amazon', product_alias: 'Nova', camp: 'us', league_tier: 'world', provider_key: 'openrouter', reasoning: false, caller: { kind: 'platform', platformId: 'openrouter:nova-2-lite' }, price: { inputPerMTokens: 0.06, outputPerMTokens: 0.24 } },
  { model_id: 'phi-4', brand: 'Microsoft', product_alias: 'Phi', camp: 'us', league_tier: 'world', provider_key: 'openrouter', reasoning: false, caller: { kind: 'platform', platformId: 'openrouter:phi-4' }, price: { inputPerMTokens: 0.07, outputPerMTokens: 0.14 } },
  { model_id: 'deepseek-v4-flash', brand: 'DeepSeek', camp: 'china', league_tier: 'world', provider_key: 'openrouter', reasoning: true, maxCompletionTokens: 3000, caller: { kind: 'platform', platformId: 'openrouter:deepseek-v4-flash' }, price: { inputPerMTokens: 0.3, outputPerMTokens: 1.2 } },
  { model_id: 'qwen3.5-flash', brand: 'Qwen', camp: 'china', league_tier: 'world', provider_key: 'openrouter', reasoning: true, maxCompletionTokens: 3000, caller: { kind: 'platform', platformId: 'openrouter:qwen3.5-flash' }, price: { inputPerMTokens: 0.25, outputPerMTokens: 1 } },
  { model_id: 'mimo-v2.5', brand: 'Xiaomi', product_alias: 'MiMo', camp: 'china', league_tier: 'world', provider_key: 'openrouter', reasoning: true, maxCompletionTokens: 2500, caller: { kind: 'platform', platformId: 'openrouter:mimo-v2.5' }, price: { inputPerMTokens: 0.2, outputPerMTokens: 0.6 } },
  { model_id: 'solar-pro3', brand: 'Upstage', product_alias: 'Solar', camp: 'other', league_tier: 'world', provider_key: 'upstage', reasoning: true, caller: { kind: 'platform', platformId: 'upstage:solar-pro3' }, price: { inputPerMTokens: 0.25, outputPerMTokens: 1 } },
  { model_id: 'hcx-007', brand: 'NAVER', product_alias: 'HyperCLOVA', camp: 'other', league_tier: 'world', provider_key: 'clova', reasoning: false, caller: { kind: 'platform', platformId: 'clova:hcx-007' }, price: { inputPerMTokens: 0, outputPerMTokens: 0 } },
  { model_id: 'k-exaone-2.0', brand: 'LG', product_alias: 'EXAONE', camp: 'other', league_tier: 'world', provider_key: 'friendli', reasoning: true, caller: { kind: 'platform', platformId: 'friendli:exaone-k-2.0' }, price: { inputPerMTokens: 0, outputPerMTokens: 0 } },
  { model_id: 'ernie-4.5-vl', brand: 'Baidu', product_alias: 'ERNIE', camp: 'china', league_tier: 'world', provider_key: 'openrouter', reasoning: false, caller: { kind: 'platform', platformId: 'openrouter:ernie-4.5-vl' }, price: { inputPerMTokens: 0.28, outputPerMTokens: 1.1 } },
  { model_id: 'seed-1.6', brand: 'ByteDance', product_alias: 'Seed', camp: 'china', league_tier: 'world', provider_key: 'openrouter', reasoning: false, caller: { kind: 'platform', platformId: 'openrouter:seed-1.6' }, price: { inputPerMTokens: 0.3, outputPerMTokens: 1.2 } },

  // ── 🟣 SCOUT (6) — all genuinely search-capable, no padding. Graded on
  //     direction like every other tier. Scout never receives the shared
  //     research packet — independent live search IS the experiment. ──
  // Roster asked for "GPT-5.6 + websearch"; OpenAI's search-enabled chat model
  // is gpt-5-search-api (no 5.6 search variant in the catalog) — substitution,
  // flagged in the run report. Search is built into this model (no body flag).
  { model_id: 'gpt-5-search-api', brand: 'OpenAI', product_alias: 'ChatGPT', camp: 'us', league_tier: 'scout', provider_key: 'openai', reasoning: false, maxCompletionTokens: 1600, caller: { kind: 'core', provider: 'openai', modelOverride: 'gpt-5-search-api' }, price: { inputPerMTokens: 1.25, outputPerMTokens: 10 } },
  { model_id: 'gemini-3.6-flash-grounded', brand: 'Google', product_alias: 'Gemini', camp: 'us', league_tier: 'scout', provider_key: 'google', reasoning: true, maxCompletionTokens: 2500, caller: { kind: 'core', provider: 'google', modelOverride: 'gemini-3.6-flash', allowGeminiThinking: true, searchTool: true }, price: { inputPerMTokens: 0.5, outputPerMTokens: 3 } },
  // Scout Grok runs the newest grok-4.6 (premier/challenger slots use 4.5/4.3
  // per the official roster; scout only specifies "Grok + live search").
  // Agent Tools web_search runs long (>60s default timeout, confirmed live
  // 2026-08-16) — per-entry 150s headroom.
  { model_id: 'grok-4.6-livesearch', brand: 'xAI', product_alias: 'Grok', camp: 'us', league_tier: 'scout', provider_key: 'xai', reasoning: true, maxCompletionTokens: 2500, timeoutMs: 150_000, caller: { kind: 'core', provider: 'xai', modelOverride: 'grok-4.6', searchTool: true }, price: { inputPerMTokens: 3, outputPerMTokens: 15 } },
  { model_id: 'claude-sonnet-5-websearch', brand: 'Anthropic', product_alias: 'Claude', camp: 'us', league_tier: 'scout', provider_key: 'anthropic', reasoning: false, maxCompletionTokens: 1600, caller: { kind: 'core', provider: 'anthropic', modelOverride: 'claude-sonnet-5', searchTool: true }, price: { inputPerMTokens: 3, outputPerMTokens: 15 } },
  { model_id: 'sonar-reasoning-pro', brand: 'Perplexity', product_alias: 'Sonar', camp: 'us', league_tier: 'scout', provider_key: 'perplexity', reasoning: true, maxCompletionTokens: 1600, caller: { kind: 'core', provider: 'perplexity', modelOverride: 'sonar-reasoning-pro' }, price: { inputPerMTokens: 2, outputPerMTokens: 8 } },
  { model_id: 'youcom-research', brand: 'You.com', camp: 'us', league_tier: 'scout', provider_key: 'youcom', reasoning: true, caller: { kind: 'platform', platformId: 'youcom:research' }, price: { inputPerMTokens: 0, outputPerMTokens: 0 } },
]

const ROSTER_BY_MODEL_ID = new Map(LEAGUE_ROSTER.map((entry) => [entry.model_id, entry]))

/** Brand line for tiles — e.g. "OpenAI (ChatGPT)" when a product alias exists. */
export function formatRosterBrand(entry: RosterEntry): string {
  return entry.product_alias ? `${entry.brand} (${entry.product_alias})` : entry.brand
}

/** Model identifier shown under the brand on prediction tiles. */
export function rosterModelIdentifier(entry: RosterEntry): string {
  return entry.model_id
}

export function lookupRosterEntry(modelId: string): RosterEntry | undefined {
  return ROSTER_BY_MODEL_ID.get(modelId)
}

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
