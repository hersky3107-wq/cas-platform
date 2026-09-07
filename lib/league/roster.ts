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
 * OFFICIAL ROSTER (41 models): 10 premier / 10 challenger / 15 world / 6 scout.
 * World holds the two remaining Korean vendors (NAVER, Upstage), Thinking
 * Machines (Inkling) in the former LG seat, and Friendli Gemma 4 31B-IT —
 * see PRICE AUDIT. No sovereign tier exists in the ledger schema. Scout is
 * all genuinely search-capable endpoints, no padding. Model strings were
 * mapped to the provider catalogs live on 2026-08-16
 * (scripts/probe-model-catalogs.ts); the 2026-09-07 Inkling swap and
 * DeepSeek first-party rewire are noted inline.
 */

export type LeagueTier = 'premier' | 'challenger' | 'world' | 'scout'
export type Camp = 'us' | 'china' | 'other'
/**
 * Whether THIS seat's weights are publicly downloadable (Hugging Face or
 * equivalent) for the specific model we call — not the brand, and not an
 * older sibling. License is noted on open seats; the field stays binary.
 */
export type WeightsKind = 'open' | 'closed'

export const WEIGHTS_KINDS: readonly WeightsKind[] = ['closed', 'open']

export const WEIGHT_LABEL: Record<WeightsKind, string> = {
  closed: 'Closed-weights',
  open: 'Open-weights',
}

export type LeagueCaller =
  | {
      kind: 'core'
      provider: ExtendedAiProviderName
      /** Pin an exact model; omit to use MODEL_BY_PROVIDER's current default. */
      modelOverride?: string
      /** Google-only: let reasoning models run in default thinking mode. */
      allowGeminiThinking?: boolean
      /**
       * Scout only: enable the provider's server-side web search (xAI Agent
       * Tools web_search / Anthropic web_search / Google grounding). No-op
       * elsewhere.
       */
      searchTool?: boolean
      /**
       * xAI Agent Tools only: request-level `max_turns` (caps assistant/tool
       * turns, not individual tool calls). web_search has no `max_uses`
       * equivalent — that field is Anthropic-only.
       */
      maxTurns?: number
      /** Extra body fields for OpenAI-compatible core callers (e.g. DeepSeek thinking). */
      extraPayload?: Record<string, unknown>
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
  weights: WeightsKind
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
  price: RosterPrice
}

export type RosterPrice = {
  inputPerMTokens: number
  outputPerMTokens: number
  /**
   * When prompt tokens reach this threshold, BOTH input and output of the
   * whole request bill at the higher rates (xAI long-context rule: "all
   * tokens in the request" flip). A single blended rate is not acceptable
   * here — $3/$15 is not on the published table, under-200k would be
   * overstated, and crossing 200k would be understated.
   */
  longContext?: {
    promptTokens: number
    inputPerMTokens: number
    outputPerMTokens: number
  }
}

/**
 * PRICE AUDIT — last verified 2026-09-07 (DeepSeek first-party + Friendli Gemma).
 *
 * Sources used (per provider):
 *   OpenAI     — developers.openai.com/api/docs/models/{gpt-5.6-sol,terra,luna}
 *                + /api/docs/pricing (incl. web search $10/1k calls)
 *   Anthropic  — platform.claude.com/docs/en/about-claude/pricing
 *                + web_search tool docs ($10/1k searches)
 *   Google     — ai.google.dev/gemini-api/docs/pricing (3.1 Pro / 3.6 Flash /
 *                3.5 Flash-Lite; Pro long-context ≥200k)
 *   xAI        — docs.x.ai models table (grok-4.6/4.5 $2/$6 & $4/$12 @200k;
 *                grok-4.3 $1.25/$2.50 & $2.50/$5 @200k; web_search $5/1k)
 *   OpenRouter — live GET https://openrouter.ai/api/v1/models (prompt/completion
 *                fields × 1e6). Covers every remaining openrouter:* roster seat.
 *                thinkingmachines/inkling listed $1.00 / $4.05 (2026-09-07);
 *                endpoints DeepInfra $0.95/$4.05, BaseTen/Together $1.00/$4.05.
 *                deepseek-v3.2 stays on OpenRouter — first-party GET /models
 *                (2026-09-07) listed only deepseek-v4-pro / deepseek-v4-flash /
 *                deepseek-v4-flash-vision-exp. No v3.2 id; do not guess.
 *   DeepSeek   — first-party api-docs.deepseek.com rate card (USD / 1M tokens),
 *                peak = 01:00–04:00 and 06:00–10:00 UTC Mon–Fri; off-peak is
 *                50% of peak (weekends all off-peak). Roster fallback uses
 *                off-peak cache-miss (the common case):
 *                  v4-pro   in $0.66 / out $1.98  (peak $1.32 / $3.96)
 *                  v4-flash in $0.22 / out $0.66  (peak $0.44 / $1.32)
 *                Cache-hit input is $0.022/$0.044 (pro) and $0.007/$0.014
 *                (flash). First-party usage object has no billed USD field.
 *   Meta Muse  — developer.meta.com Muse Spark 1.2 standard tier $1.25/$4.25
 *   Upstage    — Solar Pro 3 list $0.15/$0.60 (matches OpenRouter)
 *   Friendli   — serverless google/gemma-4-31B-it $0.14 / $0.40 (docs
 *                friendli.ai/docs/guides/model-apis/pricing, 2026-09-07).
 *                K-EXAONE-2.0-750B-A37B left serverless 2026-09-06 00:00 UTC
 *                (dedicated only). GLM / DeepSeek / MiniMax brands on Friendli
 *                are already rostered elsewhere; whisper is speech. Gemma is
 *                the only qualifying add. The WORLD LG seat was replaced by
 *                Thinking Machines Inkling on OpenRouter (2026-09-07).
 *   Perplexity — docs.perplexity.ai pricing (sonar-reasoning-pro $2/$8 +
 *                request fee; billed total_cost already preferred in ledger)
 *   You.com    — you.com/docs/administration/billing lite $12/1k ($0.012/call);
 *                token price stays $0 — cost is the flat documented rate
 *   NAVER CLOVA — no public HCX-007 sheet (NCP console only); kept $0/$0
 *
 * SEAT-SWAP NOTES (keep for future sessions):
 *   - LG was lost because Friendli moved EXAONE to dedicated-only on
 *     2026-09-06 and LG's first-party API is partnership-only. No new
 *     vendor account.
 *   - Sakana Fugu Ultra (sakana/fugu-ultra) was the preferred Japanese
 *     replacement but was rejected: a real ~1,900-token closed-book packet
 *     billed $0.27; OpenRouter/Sakana expose no max_turns; effort:high
 *     made it worse ($0.32). Agent pool on Ultra is fixed.
 *   - The roster now has NO Japanese seat. Japan is the open gap to fill
 *     when a Japanese lab appears pay-as-you-go on a provider we already
 *     use (OpenRouter or Friendli serverless).
 *   - India, Middle East, SEA, LatAm and Africa have zero models on
 *     OpenRouter today, so geographic diversity beyond US/CN/KR/FR/CA is
 *     currently not purchasable.
 *
 * WEIGHTS — classified 2026-09-07. Rule: 'open' means the SPECIFIC called
 * model has publicly downloadable weights. A previous generation or a
 * smaller sibling does not count. Open ≠ OSI license.
 *
 * FLAG seats (named ambiguities + one extra):
 *   grok-4.5 / grok-4.3 / grok-4.6-livesearch — Grok-1 is open (Apache-2.0);
 *     4.x listings show Open weights: No. Closed.
 *   muse-spark-1.2 — Meta announced Spark 1.2 weights "in the coming weeks"
 *     on 2026-08-10; as of 2026-09-07 no HF repo. Glimmer 30B is a sibling.
 *     Closed.
 *   mistral-medium-3.5 — CONFIRMED open: mistralai/Mistral-Medium-3.5-128B
 *     (Modified MIT).
 *   solar-pro3 — CONFIRMED closed: API-only; Solar 10.7B is a previous gen.
 *   command-a — CONFIRMED open: CohereLabs/c4ai-command-a-03-2025 (CC-BY-NC).
 *     Roster calls Command A, not A+ (A+ is also open, Apache-2.0).
 *   qwen3.8-max — OPEN with caveat: Qwen/Qwen3.8-2.4T-A95B is downloadable
 *     (custom qwen3.8-max license). Hosted Max may add 1M/vision serving
 *     features the checkpoint does not have.
 *   nova-2-lite — FLAG: Amazon documents Nova as API-only; no public
 *     checkpoint found. Kept closed. Not guessed open.
 *
 * Re-audit whenever a first-party page moves, or when an OpenRouter drift
 * script flags a seat off by >25%.
 */
/** Official grok-4.5 / grok-4.6 list price (docs.x.ai, 2026-08). */
const XAI_GROK_46_PRICE: RosterPrice = {
  inputPerMTokens: 2,
  outputPerMTokens: 6,
  longContext: { promptTokens: 200_000, inputPerMTokens: 4, outputPerMTokens: 12 },
}

/** Official grok-4.3 list price (docs.x.ai, 2026-08). */
const XAI_GROK_43_PRICE: RosterPrice = {
  inputPerMTokens: 1.25,
  outputPerMTokens: 2.5,
  longContext: { promptTokens: 200_000, inputPerMTokens: 2.5, outputPerMTokens: 5 },
}

/** First-party DeepSeek thinking — confirmed live 2026-09-07 (CHAIN/JSON in content). */
const DEEPSEEK_FIRST_PARTY_THINKING: Record<string, unknown> = {
  thinking: { type: 'enabled' },
  reasoning_effort: 'low',
}

/** Official first-party off-peak cache-miss (api-docs.deepseek.com, 2026-09-07). */
const DEEPSEEK_V4_PRO_PRICE: RosterPrice = { inputPerMTokens: 0.66, outputPerMTokens: 1.98 }
const DEEPSEEK_V4_FLASH_PRICE: RosterPrice = { inputPerMTokens: 0.22, outputPerMTokens: 0.66 }

export const LEAGUE_ROSTER: RosterEntry[] = [
  // ── 🔴 PREMIER (10) — US 5 : CN 5 ────────────────────────────────────────
  { model_id: 'gpt-5.6-sol', brand: 'OpenAI', product_alias: 'ChatGPT', camp: 'us', league_tier: 'premier', weights: 'closed', provider_key: 'openai', reasoning: true, caller: { kind: 'core', provider: 'openai', modelOverride: 'gpt-5.6-sol' }, price: { inputPerMTokens: 4, outputPerMTokens: 20 } }, // OpenAI API; no public checkpoint
  { model_id: 'claude-fable-5', brand: 'Anthropic', product_alias: 'Claude', camp: 'us', league_tier: 'premier', weights: 'closed', provider_key: 'anthropic', reasoning: false, caller: { kind: 'core', provider: 'anthropic', modelOverride: 'claude-fable-5' }, price: { inputPerMTokens: 10, outputPerMTokens: 50 } }, // Anthropic API; no public checkpoint
  // Catalog id carries the -preview suffix; that IS the Gemini 3.1 Pro endpoint.
  { model_id: 'gemini-3.1-pro', brand: 'Google', product_alias: 'Gemini', camp: 'us', league_tier: 'premier', weights: 'closed', provider_key: 'google', reasoning: true, caller: { kind: 'core', provider: 'google', modelOverride: 'gemini-3.1-pro-preview', allowGeminiThinking: true }, price: { inputPerMTokens: 2, outputPerMTokens: 12, longContext: { promptTokens: 200_000, inputPerMTokens: 4, outputPerMTokens: 18 } } }, // Gemini API; Gemma is a sibling, not this model
  { model_id: 'grok-4.5', brand: 'xAI', product_alias: 'Grok', camp: 'us', league_tier: 'premier', weights: 'closed', provider_key: 'xai', reasoning: true, caller: { kind: 'core', provider: 'xai', modelOverride: 'grok-4.5' }, price: XAI_GROK_46_PRICE }, // FLAG: only Grok-1 weights exist; 4.x is API-only
  { model_id: 'muse-spark-1.2', brand: 'Meta Muse', product_alias: 'Muse', camp: 'us', league_tier: 'premier', weights: 'closed', provider_key: 'meta-muse', reasoning: true, caller: { kind: 'platform', platformId: 'meta-muse:muse-spark-1.2' }, price: { inputPerMTokens: 1.25, outputPerMTokens: 4.25 } }, // FLAG: Spark 1.2 weights promised 2026-08-10, not shipped; Glimmer is a sibling
  { model_id: 'qwen3.8-max', brand: 'Qwen', camp: 'china', league_tier: 'premier', weights: 'open', provider_key: 'openrouter', reasoning: true, maxCompletionTokens: 4500, caller: { kind: 'platform', platformId: 'openrouter:qwen3.8-max' }, price: { inputPerMTokens: 2, outputPerMTokens: 6 } }, // FLAG: Qwen/Qwen3.8-2.4T-A95B (custom qwen3.8-max license); hosted Max may add 1M/vision
  // v4-pro spends any budget ≤3000 entirely on hidden reasoning (confirmed
  // live 2026-08-16: finish_reason=length at reasoning_tokens=3000/3000
  // despite reasoning-effort minimal) — 6000 was the working JSON-only
  // budget; 7500 adds headroom for the mandatory visible reasoning block.
  { model_id: 'deepseek-v4-pro', brand: 'DeepSeek', camp: 'china', league_tier: 'premier', weights: 'open', provider_key: 'deepseek', reasoning: true, maxCompletionTokens: 7500, timeoutMs: 240_000, caller: { kind: 'core', provider: 'deepseek', modelOverride: 'deepseek-v4-pro', extraPayload: DEEPSEEK_FIRST_PARTY_THINKING }, price: DEEPSEEK_V4_PRO_PRICE }, // MIT; deepseek-ai/DeepSeek-V4-Pro; first-party 2026-09-07
  { model_id: 'kimi-k3', brand: 'Moonshot AI', product_alias: 'Kimi', camp: 'china', league_tier: 'premier', weights: 'open', provider_key: 'openrouter', reasoning: true, maxCompletionTokens: 4500, caller: { kind: 'platform', platformId: 'openrouter:kimi-k3' }, price: { inputPerMTokens: 3, outputPerMTokens: 15 } }, // Kimi K3 License; moonshotai/Kimi-K3
  { model_id: 'glm-5.2', brand: 'Z.ai', product_alias: 'GLM', camp: 'china', league_tier: 'premier', weights: 'open', provider_key: 'openrouter', reasoning: true, maxCompletionTokens: 4500, caller: { kind: 'platform', platformId: 'openrouter:glm-5.2' }, price: { inputPerMTokens: 1.19, outputPerMTokens: 3.74 } }, // MIT; z-ai/GLM-5.2
  { model_id: 'minimax-m3', brand: 'MiniMax', camp: 'china', league_tier: 'premier', weights: 'open', provider_key: 'openrouter', reasoning: true, maxCompletionTokens: 4500, caller: { kind: 'platform', platformId: 'openrouter:minimax-m3' }, price: { inputPerMTokens: 0.3, outputPerMTokens: 1.2 } }, // MiniMax Community License

  // ── 🔵 CHALLENGER (10) ───────────────────────────────────────────────────
  { model_id: 'gpt-5.6-terra', brand: 'OpenAI', product_alias: 'ChatGPT', camp: 'us', league_tier: 'challenger', weights: 'closed', provider_key: 'openai', reasoning: true, caller: { kind: 'core', provider: 'openai', modelOverride: 'gpt-5.6-terra' }, price: { inputPerMTokens: 2, outputPerMTokens: 12 } }, // OpenAI API; no public checkpoint
  { model_id: 'claude-sonnet-5', brand: 'Anthropic', product_alias: 'Claude', camp: 'us', league_tier: 'challenger', weights: 'closed', provider_key: 'anthropic', reasoning: false, caller: { kind: 'core', provider: 'anthropic', modelOverride: 'claude-sonnet-5' }, price: { inputPerMTokens: 2, outputPerMTokens: 10 } }, // Anthropic API; no public checkpoint
  // Confirmed live 2026-08-16: gemini-3.6-flash / 3.5-flash-lite REJECT
  // thinkingConfig:{thinkingBudget:0} (HTTP 400 INVALID_ARGUMENT), so they
  // run with allowGeminiThinking (default thinking mode) like 3.1-pro.
  { model_id: 'gemini-3.6-flash', brand: 'Google', product_alias: 'Gemini', camp: 'us', league_tier: 'challenger', weights: 'closed', provider_key: 'google', reasoning: true, caller: { kind: 'core', provider: 'google', modelOverride: 'gemini-3.6-flash', allowGeminiThinking: true }, price: { inputPerMTokens: 1.5, outputPerMTokens: 7.5 } }, // Gemini API; Gemma is a sibling
  { model_id: 'grok-4.3', brand: 'xAI', product_alias: 'Grok', camp: 'us', league_tier: 'challenger', weights: 'closed', provider_key: 'xai', reasoning: true, caller: { kind: 'core', provider: 'xai', modelOverride: 'grok-4.3' }, price: XAI_GROK_43_PRICE }, // FLAG: same as grok-4.5 — 4.x API-only
  // Reasoning-heavy challengers: a 1200-token budget was consumed ENTIRELY
  // by hidden reasoning (content null, finish_reason=length, confirmed live
  // 2026-08-16) — 3000 left room for the visible JSON; 4500 adds room for
  // the mandatory visible reasoning block on top of hidden reasoning.
  { model_id: 'nemotron-3-ultra-550b', brand: 'NVIDIA', product_alias: 'Nemotron', camp: 'us', league_tier: 'challenger', weights: 'open', provider_key: 'openrouter', reasoning: true, maxCompletionTokens: 4500, caller: { kind: 'platform', platformId: 'openrouter:nemotron-3-ultra-550b' },     price: { inputPerMTokens: 0.5, outputPerMTokens: 2.2 } }, // NVIDIA Open Model License; nvidia/NVIDIA-Nemotron-3-Ultra-550B
  { model_id: 'mistral-medium-3.5', brand: 'Mistral', camp: 'other', league_tier: 'challenger', weights: 'open', provider_key: 'openrouter', reasoning: false, caller: { kind: 'platform', platformId: 'openrouter:mistral-medium-3.5' }, price: { inputPerMTokens: 1.5, outputPerMTokens: 7.5 } }, // FLAG resolved: Modified MIT; mistralai/Mistral-Medium-3.5-128B
  // Roster asked for "Command A+"; no A+ exists in the catalog — command-a is
  // the closest wired equivalent (substitution, flagged in the run report).
  { model_id: 'command-a', brand: 'Cohere', product_alias: 'Command', camp: 'other', league_tier: 'challenger', weights: 'open', provider_key: 'openrouter', reasoning: false, caller: { kind: 'platform', platformId: 'openrouter:command-a' }, price: { inputPerMTokens: 2.5, outputPerMTokens: 10 } }, // FLAG resolved: CC-BY-NC; CohereLabs/c4ai-command-a-03-2025 (this id, not A+)
  { model_id: 'qwen3.5-plus', brand: 'Qwen', camp: 'china', league_tier: 'challenger', weights: 'open', provider_key: 'openrouter', reasoning: true, maxCompletionTokens: 4500, caller: { kind: 'platform', platformId: 'openrouter:qwen3.5-plus' }, price: { inputPerMTokens: 0.3, outputPerMTokens: 1.8 } }, // Apache-2.0; hosted Plus ↔ Qwen/Qwen3.5-397B-A17B
  // v3.2 timed out at the 60s default on the live 2026-08-28 reasoning round
  // (hidden reasoning runs longer under the 4500 budget) — same fix as its
  // siblings: 240s per-entry headroom.
  { model_id: 'deepseek-v3.2', brand: 'DeepSeek', camp: 'china', league_tier: 'challenger', weights: 'open', provider_key: 'openrouter', reasoning: true, maxCompletionTokens: 4500, timeoutMs: 240_000, caller: { kind: 'platform', platformId: 'openrouter:deepseek-v3.2' }, price: { inputPerMTokens: 0.269, outputPerMTokens: 0.4 } }, // MIT; deepseek-ai/DeepSeek-V3.2 — no first-party id (GET /models 2026-09-07)
  // Same 3000-token reasoning exhaustion as deepseek-v4-pro (see above) —
  // confirmed live 2026-08-16 that 8000 returns content (~1.1k used) on a
  // league-sized prompt; the empty-content retry doubles latency under load,
  // hence the 240s timeout.
  { model_id: 'kimi-k2.6', brand: 'Moonshot AI', product_alias: 'Kimi', camp: 'china', league_tier: 'challenger', weights: 'open', provider_key: 'openrouter', reasoning: true, maxCompletionTokens: 8000, timeoutMs: 240_000, caller: { kind: 'platform', platformId: 'openrouter:kimi-k2.6' }, price: { inputPerMTokens: 0.95, outputPerMTokens: 4 } }, // Modified MIT; moonshotai/Kimi-K2.6

  // ── 🟢 WORLD (14) — two Korean vendors (NAVER, Upstage); no sovereign tier ─
  { model_id: 'gpt-5.6-luna', brand: 'OpenAI', product_alias: 'ChatGPT', camp: 'us', league_tier: 'world', weights: 'closed', provider_key: 'openai', reasoning: true, caller: { kind: 'core', provider: 'openai', modelOverride: 'gpt-5.6-luna' }, price: { inputPerMTokens: 0.2, outputPerMTokens: 1.2 } }, // OpenAI API; no public checkpoint
  { model_id: 'claude-haiku-4.5', brand: 'Anthropic', product_alias: 'Claude', camp: 'us', league_tier: 'world', weights: 'closed', provider_key: 'anthropic', reasoning: false, caller: { kind: 'core', provider: 'anthropic', modelOverride: 'claude-haiku-4-5-20251001' }, price: { inputPerMTokens: 1, outputPerMTokens: 5 } }, // Anthropic API; no public checkpoint
  { model_id: 'gemini-3.5-flash-lite', brand: 'Google', product_alias: 'Gemini', camp: 'us', league_tier: 'world', weights: 'closed', provider_key: 'google', reasoning: true, caller: { kind: 'core', provider: 'google', modelOverride: 'gemini-3.5-flash-lite', allowGeminiThinking: true }, price: { inputPerMTokens: 0.3, outputPerMTokens: 2.5 } }, // Gemini API; Gemma is a sibling
  { model_id: 'llama-4-maverick', brand: 'Meta', product_alias: 'Llama', camp: 'us', league_tier: 'world', weights: 'open', provider_key: 'openrouter', reasoning: false, caller: { kind: 'platform', platformId: 'openrouter:llama-4-maverick' }, price: { inputPerMTokens: 0.2, outputPerMTokens: 0.8 } }, // Llama 4 Community License; meta-llama/Llama-4-Maverick
  { model_id: 'nova-2-lite', brand: 'Amazon', product_alias: 'Nova', camp: 'us', league_tier: 'world', weights: 'closed', provider_key: 'openrouter', reasoning: false, caller: { kind: 'platform', platformId: 'openrouter:nova-2-lite' }, price: { inputPerMTokens: 0.3, outputPerMTokens: 2.5 } }, // FLAG: Amazon Nova API-only; no public checkpoint found
  { model_id: 'phi-4', brand: 'Microsoft', product_alias: 'Phi', camp: 'us', league_tier: 'world', weights: 'open', provider_key: 'openrouter', reasoning: false, caller: { kind: 'platform', platformId: 'openrouter:phi-4' }, price: { inputPerMTokens: 0.07, outputPerMTokens: 0.14 } }, // MIT; microsoft/phi-4
  { model_id: 'deepseek-v4-flash', brand: 'DeepSeek', camp: 'china', league_tier: 'world', weights: 'open', provider_key: 'deepseek', reasoning: true, maxCompletionTokens: 4500, caller: { kind: 'core', provider: 'deepseek', modelOverride: 'deepseek-v4-flash', extraPayload: DEEPSEEK_FIRST_PARTY_THINKING }, price: DEEPSEEK_V4_FLASH_PRICE }, // MIT; deepseek-ai/DeepSeek-V4-Flash; first-party 2026-09-07
  { model_id: 'qwen3.5-flash', brand: 'Qwen', camp: 'china', league_tier: 'world', weights: 'open', provider_key: 'openrouter', reasoning: true, maxCompletionTokens: 4500, caller: { kind: 'platform', platformId: 'openrouter:qwen3.5-flash' }, price: { inputPerMTokens: 0.065, outputPerMTokens: 0.26 } }, // Apache-2.0; hosted Flash ↔ Qwen/Qwen3.5-35B-A3B
  { model_id: 'mimo-v2.5', brand: 'Xiaomi', product_alias: 'MiMo', camp: 'china', league_tier: 'world', weights: 'open', provider_key: 'openrouter', reasoning: true, maxCompletionTokens: 4000, caller: { kind: 'platform', platformId: 'openrouter:mimo-v2.5' }, price: { inputPerMTokens: 0.14, outputPerMTokens: 0.28 } }, // MIT; XiaomiMiMo/MiMo-V2.5
  { model_id: 'solar-pro3', brand: 'Upstage', product_alias: 'Solar', camp: 'other', league_tier: 'world', weights: 'closed', provider_key: 'upstage', reasoning: true, caller: { kind: 'platform', platformId: 'upstage:solar-pro3' }, price: { inputPerMTokens: 0.15, outputPerMTokens: 0.6 } }, // FLAG resolved: API-only; Solar 10.7B is a previous gen
  { model_id: 'hcx-007', brand: 'NAVER', product_alias: 'HyperCLOVA', camp: 'other', league_tier: 'world', weights: 'closed', provider_key: 'clova', reasoning: false, caller: { kind: 'platform', platformId: 'clova:hcx-007' }, price: { inputPerMTokens: 0, outputPerMTokens: 0 } }, // NAVER CLOVA Studio API; no public checkpoint
  // 2026-09-07: replaces dead LG/EXAONE. OpenRouter list $1.00/$4.05.
  // effort:minimal — default effort on this packet billed $0.0107 and
  // returned empty content (2000 tokens of hidden reasoning). 4500 / 90s
  // match other WORLD reasoning seats; measured call finished in <1s.
  { model_id: 'inkling', brand: 'Thinking Machines', product_alias: 'Inkling', camp: 'us', league_tier: 'world', weights: 'open', provider_key: 'openrouter', reasoning: true, maxCompletionTokens: 4500, timeoutMs: 90_000, caller: { kind: 'platform', platformId: 'openrouter:inkling' }, price: { inputPerMTokens: 1, outputPerMTokens: 4.05 } }, // Apache-2.0; thinkingmachines/Inkling
  // Friendli serverless WORLD seat — google/gemma-4-31B-it listed live
  // 2026-09-07; CHAIN/JSON contract passed on the 65192045 packet. Generous
  // maxCompletionTokens to draw down idle Friendli credit; the model still
  // stops when the contract is done (probe finished at 270 completion tokens).
  { model_id: 'gemma-4-31b-it', brand: 'Google', product_alias: 'Gemma', camp: 'us', league_tier: 'world', weights: 'open', provider_key: 'friendli', reasoning: false, maxCompletionTokens: 16000, timeoutMs: 90_000, caller: { kind: 'platform', platformId: 'friendli:gemma-4-31b-it' }, price: { inputPerMTokens: 0.14, outputPerMTokens: 0.4 } }, // Gemma license; google/gemma-4-31B-it
  { model_id: 'ernie-4.5-vl', brand: 'Baidu', product_alias: 'ERNIE', camp: 'china', league_tier: 'world', weights: 'open', provider_key: 'openrouter', reasoning: false, caller: { kind: 'platform', platformId: 'openrouter:ernie-4.5-vl' }, price: { inputPerMTokens: 0.42, outputPerMTokens: 1.25 } }, // Apache-2.0; baidu/ERNIE-4.5-VL-424B-A47B-PT
  { model_id: 'seed-1.6', brand: 'ByteDance', product_alias: 'Seed', camp: 'china', league_tier: 'world', weights: 'closed', provider_key: 'openrouter', reasoning: false, caller: { kind: 'platform', platformId: 'openrouter:seed-1.6' }, price: { inputPerMTokens: 0.25, outputPerMTokens: 2 } }, // API-only; Seed-OSS is a sibling, not this model

  // ── 🟣 SCOUT (6) — all genuinely search-capable, no padding. Graded on
  //     direction like every other tier. Scout never receives the shared
  //     research packet — independent live search IS the experiment. ──
  // Roster asked for "GPT-5.6 + websearch"; OpenAI's search-enabled chat model
  // is gpt-5-search-api (no 5.6 search variant in the catalog) — substitution,
  // flagged in the run report. Search is built into this model (no body flag).
  { model_id: 'gpt-5-search-api', brand: 'OpenAI', product_alias: 'ChatGPT', camp: 'us', league_tier: 'scout', weights: 'closed', provider_key: 'openai', reasoning: false, maxCompletionTokens: 1600, caller: { kind: 'core', provider: 'openai', modelOverride: 'gpt-5-search-api' }, price: { inputPerMTokens: 1.25, outputPerMTokens: 10 } }, // OpenAI search API; no public checkpoint
  { model_id: 'gemini-3.6-flash-grounded', brand: 'Google', product_alias: 'Gemini', camp: 'us', league_tier: 'scout', weights: 'closed', provider_key: 'google', reasoning: true, maxCompletionTokens: 2500, caller: { kind: 'core', provider: 'google', modelOverride: 'gemini-3.6-flash', allowGeminiThinking: true, searchTool: true }, price: { inputPerMTokens: 1.5, outputPerMTokens: 7.5 } }, // same Gemini 3.6 Flash weights — closed
  // Scout Grok runs the newest grok-4.6 (premier/challenger slots use 4.5/4.3
  // per the official roster; scout only specifies "Grok + live search").
  // Agent Tools web_search runs long (>60s default timeout, confirmed live
  // 2026-08-16) — per-entry 150s headroom.
  { model_id: 'grok-4.6-livesearch', brand: 'xAI', product_alias: 'Grok', camp: 'us', league_tier: 'scout', weights: 'closed', provider_key: 'xai', reasoning: true, maxCompletionTokens: 2500, timeoutMs: 150_000, caller: { kind: 'core', provider: 'xai', modelOverride: 'grok-4.6', searchTool: true, maxTurns: 3 }, price: XAI_GROK_46_PRICE }, // FLAG: grok-4.6 API-only; Grok-1 is a previous gen
  { model_id: 'claude-sonnet-5-websearch', brand: 'Anthropic', product_alias: 'Claude', camp: 'us', league_tier: 'scout', weights: 'closed', provider_key: 'anthropic', reasoning: false, maxCompletionTokens: 1600, caller: { kind: 'core', provider: 'anthropic', modelOverride: 'claude-sonnet-5', searchTool: true }, price: { inputPerMTokens: 2, outputPerMTokens: 10 } }, // Anthropic API; no public checkpoint
  { model_id: 'sonar-reasoning-pro', brand: 'Perplexity', product_alias: 'Sonar', camp: 'us', league_tier: 'scout', weights: 'closed', provider_key: 'perplexity', reasoning: true, maxCompletionTokens: 1600, caller: { kind: 'core', provider: 'perplexity', modelOverride: 'sonar-reasoning-pro' }, price: { inputPerMTokens: 2, outputPerMTokens: 8 } }, // Perplexity search API; no public checkpoint
  { model_id: 'youcom-research', brand: 'You.com', camp: 'us', league_tier: 'scout', weights: 'closed', provider_key: 'youcom', reasoning: true, caller: { kind: 'platform', platformId: 'youcom:research' }, price: { inputPerMTokens: 0, outputPerMTokens: 0 } }, // You.com research agent; no public checkpoint
]

const ROSTER_BY_MODEL_ID = new Map(LEAGUE_ROSTER.map((entry) => [entry.model_id, entry]))

/**
 * Display-only aliases for model_ids that left the live roster. Historical
 * prediction rows keep the original model_id; tiles must still name the
 * brand that actually answered. Not a live seat — never called.
 */
const RETIRED_ROSTER_DISPLAY: Record<string, Pick<RosterEntry, 'brand' | 'product_alias'>> = {
  'k-exaone-2.0': { brand: 'LG', product_alias: 'EXAONE' },
}

/** Brand line for tiles — e.g. "OpenAI (ChatGPT)" when a product alias exists. */
export function formatRosterBrand(entry: Pick<RosterEntry, 'brand' | 'product_alias'>): string {
  return entry.product_alias ? `${entry.brand} (${entry.product_alias})` : entry.brand
}

/** Model identifier shown under the brand on prediction tiles. */
export function rosterModelIdentifier(entry: RosterEntry): string {
  return entry.model_id
}

export function lookupRosterEntry(modelId: string): RosterEntry | undefined {
  return ROSTER_BY_MODEL_ID.get(modelId)
}

/** Live roster first; retired display alias if the seat has been replaced. */
export function lookupRosterDisplay(modelId: string): { brand: string; model_id: string } | undefined {
  const live = lookupRosterEntry(modelId)
  if (live) return { brand: formatRosterBrand(live), model_id: rosterModelIdentifier(live) }
  const retired = RETIRED_ROSTER_DISPLAY[modelId]
  if (!retired) return undefined
  return { brand: formatRosterBrand(retired), model_id: modelId }
}

/** Roster subset by tier (e.g. run only 'world' first to keep the cost test cheap). */
export function getRoster(tiers?: LeagueTier[]): RosterEntry[] {
  if (!tiers || tiers.length === 0) return LEAGUE_ROSTER
  const set = new Set(tiers)
  return LEAGUE_ROSTER.filter((m) => set.has(m.league_tier))
}

/**
 * Token × roster list-price estimate. Missing tokens/price → 0.
 * Does NOT include tool fees (xAI web_search is $5/1k calls). When the
 * provider reports billed USD, persist this as `estimated_cost_usd` and
 * store the billed figure in `cost_usd`.
 */
export function computeCostUsd(
  entry: RosterEntry,
  promptTokens: number | null,
  completionTokens: number | null
): number {
  const pt = typeof promptTokens === 'number' ? promptTokens : 0
  const ct = typeof completionTokens === 'number' ? completionTokens : 0
  const long = entry.price.longContext
  const useLong = !!long && pt >= long.promptTokens
  const inRate = useLong ? long.inputPerMTokens : entry.price.inputPerMTokens
  const outRate = useLong ? long.outputPerMTokens : entry.price.outputPerMTokens
  return (pt / 1_000_000) * inRate + (ct / 1_000_000) * outRate
}

/** Pre-fix grok list price ($3/$15) — used only to compare against the old ledger. */
export function computeLegacyGrokListPriceUsd(
  promptTokens: number | null,
  completionTokens: number | null
): number {
  const pt = typeof promptTokens === 'number' ? promptTokens : 0
  const ct = typeof completionTokens === 'number' ? completionTokens : 0
  return (pt / 1_000_000) * 3 + (ct / 1_000_000) * 15
}
