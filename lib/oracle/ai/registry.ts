/**
 * Layer-1 (per-system reading) model registry.
 *
 * Every `model` / `platformId` below is copied from a live catalog check
 * already used by `/admin/platform-health` and the league roster
 * (`lib/ai/platform-providers.ts`, `lib/league/roster.ts`,
 * `app/api/admin/platform-providers/health/route.ts`). Nothing here is
 * typed from memory. Brand is what the UI may show; `model` is server-only
 * and must never be selected by a client-facing query.
 *
 * Challenger (2부) tier, one model per system.
 */
import type { SystemId } from '../axes/types'

/**
 * Core-router brands used by layer 1. Local union so this file never imports
 * `lib/ai/router.ts` (stale defaults live there; tests must not load them).
 */
export type Layer1CoreProvider = 'openai' | 'anthropic' | 'google' | 'xai' | 'deepseek'

export type Layer1Caller =
  | {
      kind: 'platform'
      /** PLATFORM_MODEL_REGISTRY id — the health page pings this exact key. */
      platformId: string
      /** Oracle-only request controls; model catalog and league remain unchanged. */
      extraRequestParams?: Record<string, unknown>
    }
  | {
      kind: 'core'
      provider: Layer1CoreProvider
      /**
       * Explicit model string. Passed as modelOverride so router.ts defaults
       * (gpt-4o, claude-sonnet-4-6, …) are never silently used.
       */
      modelOverride: string
      /** TRAP (d): Gemini 3.x rejects thinkingBudget:0. */
      allowGeminiThinking?: boolean
      /**
       * Gemini 3 thinkingLevel. When set with allowGeminiThinking, sent as
       * thinkingConfig.thinkingLevel (e.g. 'minimal' to stop thinking from
       * consuming maxOutputTokens). League paths leave this unset.
       */
      geminiThinkingLevel?: 'minimal' | 'low' | 'medium' | 'high'
      /**
       * Anthropic extended/adaptive thinking. Oracle may set 'disabled' so
       * thinking tokens do not consume max_tokens on long synthesis prompts.
       * League paths leave this unset (provider default).
       */
      anthropicThinking?: 'disabled' | 'enabled'
    }

export type Layer1RegistryEntry = {
  system: SystemId
  /** English brand shown to the client. Never the model string. */
  brand: string
  /** Exact API model id. Server-only. */
  model: string
  displayName: string
  caller: Layer1Caller
  /** Canonical OpenRouter catalog id used only for token-price estimation. */
  pricingModel?: string
  /**
   * Official first-party per-token USD rates. Used for core-router estimates
   * so OpenRouter catalog prices cannot silently under/over-state spend.
   */
  officialPricing?: { promptUsdPerToken: number; completionUsdPerToken: number }
  /**
   * Per-system completion ceiling. Reasoning-emitting systems use
   * (ceil(observed-max-reasoning, 500) + 800); non-reasoning stay 1200
   * unless a measured floor requires more.
   */
  maxCompletionTokens: number
  /**
   * Visible-content runaway guard, in tokens. Set explicitly per entry —
   * NEVER computed from maxCompletionTokens. That ceiling is tuned per
   * system for a hidden-reasoning budget unrelated to visible output size
   * (ziwei/NVIDIA needs 4000 so it has room to think even though its
   * visible JSON answer is a few hundred tokens); deriving this guard from
   * it means every unrelated ceiling retune silently moves the runaway
   * catch (see the 2026-08-26 ziwei 3000->8000 bump, which silently moved
   * a formula-derived guard 4500->12000 and broke the runaway test without
   * anyone touching the guard). Every reading shares one output contract
   * (narrative 700–1100 chars, one_line <=80 chars) regardless of which model
   * fills the seat, so this is a flat, contract-derived value today. See
   * LAYER1_READING_RUNAWAY_CONTENT_TOKENS for the measurement.
   */
  runawayContentTokens: number
  /**
   * Explicit narrative-floor override, in Unicode chars. Only for a seat
   * whose pinned model has a MEASURED prose ceiling below the shared
   * LAYER1_NARRATIVE_MIN — a shorter accepted reading beats a 결번 on every
   * session, but the exception must be visible here, never a quiet default.
   */
  narrativeFloor?: number
}

/**
 * Reading contract worst case (v4 budgets, FIX 3): narrative <=1100 Unicode
 * chars (LAYER1_NARRATIVE_MAX in parse-layer1.ts) + one_line <=80 chars +
 * direction/focus/axis_emphasis overhead. CJK output can run close to
 * 1 token/char, so worst-case legit content is roughly 1300-1600 tokens.
 * 3000 keeps ~2x headroom over that before a response is flagged as runaway.
 * Rescaled BY HAND from the 500-char-era value (1800) — this guard is a
 * contract-derived constant and must never follow maxCompletionTokens.
 */
export const LAYER1_READING_RUNAWAY_CONTENT_TOKENS = 3000

export const LAYER1_REGISTRY: Record<SystemId, Layer1RegistryEntry> = {
  saju: {
    system: 'saju',
    brand: 'Moonshot AI',
    displayName: 'Kimi K3',
    model: 'moonshotai/kimi-k3',
    // Live metadata: reasoning.default_enabled=true. Moonshot AI is present
    // in the endpoint list, so prefer its verified `moonshotai` provider slug.
    caller: {
      kind: 'platform',
      platformId: 'openrouter:kimi-k3',
      extraRequestParams: {
        reasoning: { enabled: false },
        provider: { order: ['moonshotai'], allow_fallbacks: true },
      },
    },
    maxCompletionTokens: 2200,
    runawayContentTokens: LAYER1_READING_RUNAWAY_CONTENT_TOKENS,
  },
  ziwei: {
    system: 'ziwei',
    brand: 'NVIDIA',
    displayName: 'Nemotron 3 Ultra',
    model: 'nvidia/nemotron-3-ultra-550b-a55b',
    // Replaces DeepSeek on ziwei (session 1923df36 and earlier integrated
    // payloads hit the 80s unit wall via OpenRouter resellers). Family
    // bakeoff rank #2 on ziwei (4–8s, fab=0); NVIDIA is already the
    // east-asian SINGLE synthesizer, not the integrated one (Z.ai).
    caller: {
      kind: 'platform',
      platformId: 'openrouter:nemotron-3-ultra-550b',
      extraRequestParams: { reasoning: { effort: 'minimal' } },
    },
    maxCompletionTokens: 4000,
    runawayContentTokens: LAYER1_READING_RUNAWAY_CONTENT_TOKENS,
  },
  iching: {
    system: 'iching',
    brand: 'Cohere',
    displayName: 'Command A',
    // Qwen is RETIRED (consecutive empty-200 total failures). Z.ai stays
    // seat-only as the integrated synthesizer (bakeoff #1, 20/20). Cohere
    // is a live catalog brand that does not take a reasoning param.
    model: 'cohere/command-a',
    caller: { kind: 'platform', platformId: 'openrouter:command-a' },
    maxCompletionTokens: 2200,
    runawayContentTokens: LAYER1_READING_RUNAWAY_CONTENT_TOKENS,
  },
  ninestar: {
    system: 'ninestar',
    brand: 'Meta',
    displayName: 'Llama 4 Maverick',
    model: 'meta-llama/llama-4-maverick',
    // Live metadata: no reasoning object / default_enabled absent; reasoning
    // is not in supported_parameters. Catalog has no extraRequestParams.
    // Meta first-party slug `meta` is NOT in the live endpoint list
    // (DigitalOcean, DeepInfra, Novita, Parasail, Google) — do not pin.
    caller: { kind: 'platform', platformId: 'openrouter:llama-4-maverick' },
    maxCompletionTokens: 2200,
    runawayContentTokens: LAYER1_READING_RUNAWAY_CONTENT_TOKENS,
  },
  sukuyou: {
    system: 'sukuyou',
    brand: 'Mistral',
    displayName: 'Mistral Medium 3.5',
    // Replaces MiniMax M3, which also burned the 80s unit wall on integrated
    // 숙요 (session 1923df36, 79.5s abort). Mistral has no reasoning param
    // and already passed the 20× onboarding gate on numerology.
    model: 'mistralai/mistral-medium-3-5',
    caller: { kind: 'platform', platformId: 'openrouter:mistral-medium-3.5' },
    maxCompletionTokens: 2200,
    runawayContentTokens: LAYER1_READING_RUNAWAY_CONTENT_TOKENS,
  },
  astro: {
    system: 'astro',
    brand: 'OpenAI',
    displayName: 'GPT-5.6 Terra',
    // League challenger slot; health page pings this exact modelOverride.
    model: 'gpt-5.6-terra',
    pricingModel: 'openai/gpt-5.6-terra',
    // Official OpenAI short-context: $2 / $12 per 1M (developers.openai.com/api/docs/pricing).
    officialPricing: { promptUsdPerToken: 0.000002, completionUsdPerToken: 0.000012 },
    caller: { kind: 'core', provider: 'openai', modelOverride: 'gpt-5.6-terra' },
    maxCompletionTokens: 2200,
    runawayContentTokens: LAYER1_READING_RUNAWAY_CONTENT_TOKENS,
  },
  tarot: {
    system: 'tarot',
    brand: 'Google',
    displayName: 'Gemini 3.6 Flash',
    // TRAP (d): gemini-3.6-flash REJECTS thinkingConfig:{thinkingBudget:0}
    // (HTTP 400 INVALID_ARGUMENT). allowGeminiThinking:true is required.
    model: 'gemini-3.6-flash',
    pricingModel: 'google/gemini-3.6-flash',
    // Official Gemini Developer API Standard paid: $1.50 / $7.50 per 1M
    // (ai.google.dev/gemini-api/docs/pricing). OpenRouter lists the $0.75/$3.75
    // intro rate — wrong for the direct Google path we actually call.
    officialPricing: { promptUsdPerToken: 0.0000015, completionUsdPerToken: 0.0000075 },
    caller: {
      kind: 'core',
      provider: 'google',
      modelOverride: 'gemini-3.6-flash',
      // thinkingBudget:0 is rejected (HTTP 400). Default thinking (omit config)
      // burns ~1100 thoughtsTokenCount into maxOutputTokens=1200 → MAX_TOKENS
      // with ~45 content tokens (measured 0/20 parse). thinkingLevel:minimal
      // restores 20/20 STOP with full JSON — oracle-only; league untouched.
      allowGeminiThinking: true,
      geminiThinkingLevel: 'minimal',
    },
    maxCompletionTokens: 2200,
    runawayContentTokens: LAYER1_READING_RUNAWAY_CONTENT_TOKENS,
  },
  runes: {
    system: 'runes',
    brand: 'xAI',
    displayName: 'Grok 4.3',
    model: 'grok-4.3',
    pricingModel: 'x-ai/grok-4.3',
    // Official xAI <200k: $1.25 / $2.50 per 1M (docs.x.ai/developers/pricing).
    officialPricing: { promptUsdPerToken: 0.00000125, completionUsdPerToken: 0.0000025 },
    caller: { kind: 'core', provider: 'xai', modelOverride: 'grok-4.3' },
    maxCompletionTokens: 2200,
    runawayContentTokens: LAYER1_READING_RUNAWAY_CONTENT_TOKENS,
  },
  numerology: {
    system: 'numerology',
    brand: 'MiniMax',
    displayName: 'MiniMax M3',
    // Swapped off 숙요 (too heavy + uncapped hidden thinking). Numerology is
    // the lighter home. Catalog `effort:minimal` does NOT cap M3 thinking
    // (live 2026-09-05 tail finished=length at 4500); disable is absolute.
    model: 'minimax/minimax-m3',
    caller: {
      kind: 'platform',
      platformId: 'openrouter:minimax-m3',
      extraRequestParams: {
        reasoning: { enabled: false },
        provider: { order: ['minimax'], allow_fallbacks: true },
      },
    },
    maxCompletionTokens: 2200,
    runawayContentTokens: LAYER1_READING_RUNAWAY_CONTENT_TOKENS,
    narrativeFloor: 300,
  },
  name: {
    system: 'name',
    brand: 'NAVER',
    displayName: 'HyperCLOVA X HCX-007',
    model: 'HCX-007',
    // thinking.effort low: with the dispatcher default ('none') HCX-007
    // tops out at ~250-270 narrative chars; 'low' lifts substance and length
    // to ~310 (measured 2026-09-05: none 257/269, low 308/309 across
    // retries). Content stays in result.message.content with thinking on.
    caller: {
      kind: 'platform',
      platformId: 'clova:hcx-007',
      extraRequestParams: { thinking: { effort: 'low' } },
    },
    maxCompletionTokens: 2200,
    runawayContentTokens: LAYER1_READING_RUNAWAY_CONTENT_TOKENS,
    // Measured HCX-007 prose ceiling ~310 chars — it will not reach the
    // shared 400 floor even when the retry names the shortfall. 280 accepts
    // its best output; 성명학 must not 결번 every combined session (FIX 7).
    narrativeFloor: 280,
  },
  tzolkin: {
    system: 'tzolkin',
    brand: 'Upstage',
    displayName: 'Solar Pro 3',
    // Replaces the Google dual-seat with tarot (12-distinct-brands rule).
    // Sequential 20× on the integrated tzolkin native chart: 19/20 parse,
    // mean 2586ms, payload 631 chars (docs/oracle-onboarding-20x-upstage-tzolkin.md).
    // Quality bakeoff: fab=0 leak=0, both runs name Kimi/Ben, no 오행
    // (docs/oracle-quality-bakeoff-tzolkin-upstage.md). TIER 2 nawal+tone;
    // catalog reasoning_effort:low is the pin so the inference has room.
    model: 'solar-pro3',
    caller: {
      kind: 'platform',
      platformId: 'upstage:solar-pro3',
      extraRequestParams: { reasoning_effort: 'low' },
    },
    maxCompletionTokens: 2200,
    runawayContentTokens: LAYER1_READING_RUNAWAY_CONTENT_TOKENS,
  },
  prism: {
    system: 'prism',
    brand: 'Anthropic',
    displayName: 'Claude Sonnet 5',
    model: 'claude-sonnet-5',
    pricingModel: 'anthropic/claude-sonnet-5',
    // Official Anthropic: $2 / $10 per 1M (anthropic.com/claude/sonnet).
    officialPricing: { promptUsdPerToken: 0.000002, completionUsdPerToken: 0.00001 },
    caller: {
      kind: 'core',
      provider: 'anthropic',
      modelOverride: 'claude-sonnet-5',
      // Brand-level policy is enforced in callLayer1Model for every
      // Anthropic oracle call (any system, reader or synth). League unset.
    },
    // Claude ignores prompt-only length locks (measured 877 content tokens
    // against a 500-char ask). Ceiling sized for the v4 ≤1100-char JSON
    // narrative (~1500 tokens CJK) with a little headroom — deliberately the
    // TIGHTEST reader ceiling so an essay hits the API stop, fails parse, and
    // retries strict. The runaway guard stays at the shared contract value,
    // never derived from this ceiling.
    maxCompletionTokens: 1800,
    runawayContentTokens: LAYER1_READING_RUNAWAY_CONTENT_TOKENS,
  },
}

/**
 * Brands retired from every Oracle seat after consecutive total failures.
 * Must never appear as a reader, synthesizer, or seat-only brand.
 */
export const RETIRED_BRANDS = ['Qwen', 'Xiaomi MiMo'] as const

/**
 * Banned from integrated LAYER1 dedicated seats and seer seats after four
 * consecutive paid combined-session failures (OpenRouter resellers, then
 * first-party api.deepseek.com). Still allowed on single-system family
 * rosters until those are re-seated in a later pass.
 */
export const INTEGRATED_BANNED_BRANDS = ['DeepSeek'] as const

export function isRetiredBrand(brand: string): boolean {
  if ((RETIRED_BRANDS as readonly string[]).includes(brand)) return true
  const normalized = brand.trim().toLowerCase()
  return (
    normalized === 'qwen' ||
    normalized === 'xiaomi' ||
    normalized === 'xiaomi mimo' ||
    normalized === 'mimo'
  )
}

/** Seat-only brands: live caller, not a LAYER1 dedicated reader. */
export const ORACLE_SEAT_ONLY_BRANDS: Record<string, Layer1RegistryEntry> = {
  'Z.ai': {
    system: 'iching',
    brand: 'Z.ai',
    displayName: 'GLM-5.2',
    model: 'z-ai/glm-5.2',
    caller: { kind: 'platform', platformId: 'openrouter:glm-5.2' },
    maxCompletionTokens: 2000,
    runawayContentTokens: LAYER1_READING_RUNAWAY_CONTENT_TOKENS,
  },
  // CONTRARIAN seer seat (replaces retired Qwen). Deliberately the one brand
  // with no layer-1 reading stake in a combined session. `system` is a home
  // label for debug/cost rows only — ByteDance never reads a system.
  // Sequential 20× gate result: docs/oracle-onboarding-20x.md.
  ByteDance: {
    system: 'saju',
    brand: 'ByteDance',
    displayName: 'Seed 1.6',
    model: 'bytedance-seed/seed-1.6',
    // Reasoning probe (scripts/oracle-brand-probe.mts, 2026-09-05): Seed 1.6
    // THINKS BY DEFAULT — 925 reasoning vs 126 content tokens on the verdict
    // prompt even though the catalog entry carries no reasoning params.
    // Uncapped thinking can eat maxCompletionTokens and truncate the ballot,
    // so the oracle seat pins reasoning explicitly (catalog stays unchanged).
    caller: {
      kind: 'platform',
      platformId: 'openrouter:seed-1.6',
      extraRequestParams: { reasoning: { enabled: false } },
    },
    maxCompletionTokens: 2000,
    runawayContentTokens: LAYER1_READING_RUNAWAY_CONTENT_TOKENS,
  },
}

export function layer1Entry(system: string): Layer1RegistryEntry | null {
  return Object.prototype.hasOwnProperty.call(LAYER1_REGISTRY, system)
    ? LAYER1_REGISTRY[system as SystemId]
    : null
}

export type OracleCallKind = 'reading' | 'synthesis' | 'verdict'

export type ResolvedOracleCall = {
  /** Caller / model / ceilings. For a seer this is the brand's wire config. */
  entry: Layer1RegistryEntry
  /**
   * Unit name for logs and diagnostics. A verdict is `doubter` / `reader`,
   * never the LAYER1 home system that happens to share the brand (the
   * 7f5ccc4b `[oracle] tzolkin runaway` leak).
   */
  logUnit: string
}

/**
 * Resolve the live caller for a reading, synthesis, or seer verdict.
 *
 * Readings look up by system (or by brand when the daily weave pins one).
 * Verdicts and synthesis look up by brand but do NOT inherit that brand's
 * home-system identity: seat-only entries win, reading-only fields
 * (`narrativeFloor`) are stripped, and `logUnit` is the request unit.
 */
export function resolveOracleCallEntry(opts: {
  kind: OracleCallKind
  unit: string
  brand?: string | null
}): ResolvedOracleCall | null {
  const logUnit = opts.unit

  if (opts.kind === 'reading' && opts.brand == null) {
    const entry = layer1Entry(opts.unit)
    return entry ? { entry, logUnit } : null
  }
  if (opts.brand == null) return null

  if (opts.kind === 'verdict' || opts.kind === 'synthesis') {
    const seatOnly = ORACLE_SEAT_ONLY_BRANDS[opts.brand]
    const borrowed = Object.values(LAYER1_REGISTRY).find((entry) => entry.brand === opts.brand)
    const source = seatOnly ?? borrowed
    if (!source) return null
    return {
      entry: {
        ...source,
        // A ballot / synthesis is not a reading of the brand's home system.
        narrativeFloor: undefined,
      },
      logUnit,
    }
  }

  const entry = layer1EntryForBrand(opts.brand)
  return entry ? { entry, logUnit } : null
}

/** Brands used as integrated (combined) one-model-per-system readers. */
export function integratedReaderBrands(): string[] {
  return Object.values(LAYER1_REGISTRY).map((entry) => entry.brand)
}

/**
 * Resolve a live model by public brand for single-system reader/synthesizer
 * seats. The family roster owns seat order; this registry remains the single
 * source of exact provider/model configuration.
 *
 * Oracle-wide brand policies (league callers never go through this).
 */
export function applyOracleBrandPolicies(entry: Layer1RegistryEntry): Layer1RegistryEntry {
  if (entry.brand !== 'Anthropic' || entry.caller.kind !== 'core') return entry
  return {
    ...entry,
    caller: { ...entry.caller, anthropicThinking: 'disabled' },
  }
}

export function layer1EntryForBrand(brand: string): Layer1RegistryEntry | null {
  return (
    Object.values(LAYER1_REGISTRY).find((entry) => entry.brand === brand) ??
    ORACLE_SEAT_ONLY_BRANDS[brand] ??
    null
  )
}

/** Every brand that can appear on a live oracle call via the registries. */
export function registrySeatBrands(): string[] {
  return [
    ...Object.values(LAYER1_REGISTRY).map((entry) => entry.brand),
    ...Object.values(ORACLE_SEAT_ONLY_BRANDS).map((entry) => entry.brand),
  ]
}

// TRAP (c): Amazon Nova BREAKS if a reasoning option is present at all.
// None of the twelve layer-1 systems use Nova. If one is added later, do
// not merge reasoning:{…} into that request — leave extraRequestParams unset,
// matching `openrouter:nova-2-lite` in PLATFORM_MODEL_REGISTRY.
