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
export type Layer1CoreProvider = 'openai' | 'anthropic' | 'google' | 'xai'

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
}

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
    maxCompletionTokens: 1200,
  },
  ziwei: {
    system: 'ziwei',
    brand: 'DeepSeek',
    displayName: 'DeepSeek V4 Pro',
    model: 'deepseek/deepseek-v4-pro',
    // Live metadata has no default_enabled=true. `reasoning:null` strips the
    // platform catalog's effort default so no reasoning key is sent.
    // DeepSeek first-party is absent from this model's live endpoint list;
    // deliberately do not pin an upstream.
    caller: {
      kind: 'platform',
      platformId: 'openrouter:deepseek-v4-pro',
      // `reasoning:null` stripped catalog effort:minimal and the model then
      // burned the entire 3000 budget on hidden thinking (finish=length,
      // reasoning_tokens=3000/3000). Keep catalog-safe minimal.
      extraRequestParams: { reasoning: { effort: 'minimal' } },
    },
    // Synthesis 20× @4500 still truncated (reasoning 4092–4451). Floor 8000.
    maxCompletionTokens: 8000,
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
    maxCompletionTokens: 1200,
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
    maxCompletionTokens: 1200,
  },
  sukuyou: {
    system: 'sukuyou',
    brand: 'MiniMax',
    displayName: 'MiniMax M3',
    // TRAP (e): OpenRouter fans this out; Novita served content in the
    // reasoning field (~1 in 6 empty). The registry entry pins
    // provider.order:['minimax'] with allow_fallbacks:true.
    model: 'minimax/minimax-m3',
    caller: { kind: 'platform', platformId: 'openrouter:minimax-m3' },
    // Measured reasoning 928/1164 → ceil 1500 + 800 = 2300; floor 2500.
    maxCompletionTokens: 2500,
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
    maxCompletionTokens: 1200,
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
    maxCompletionTokens: 1200,
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
    maxCompletionTokens: 1200,
  },
  numerology: {
    system: 'numerology',
    brand: 'Mistral',
    displayName: 'Mistral Medium 3.5',
    // Catalog id is dashed (`mistral-medium-3-5`), not dotted. See
    // PLATFORM_MODEL_REGISTRY note — 3.1 is the older minor.
    model: 'mistralai/mistral-medium-3-5',
    caller: { kind: 'platform', platformId: 'openrouter:mistral-medium-3.5' },
    maxCompletionTokens: 1200,
  },
  name: {
    system: 'name',
    brand: 'NAVER',
    displayName: 'HyperCLOVA X HCX-007',
    model: 'HCX-007',
    caller: { kind: 'platform', platformId: 'clova:hcx-007' },
    maxCompletionTokens: 1200,
  },
  tzolkin: {
    system: 'tzolkin',
    brand: 'NVIDIA',
    displayName: 'Nemotron 3 Ultra',
    // Full catalog id is nemotron-3-ultra-550b-a55b (not the bare name).
    model: 'nvidia/nemotron-3-ultra-550b-a55b',
    caller: {
      kind: 'platform',
      platformId: 'openrouter:nemotron-3-ultra-550b',
      extraRequestParams: { reasoning: { effort: 'minimal' } },
    },
    // Synthesis 20×: failed runs were finish=length with ~1743–1855 thinking
    // into a 2000 ceiling (content truncated / JSON never closed).
    maxCompletionTokens: 4000,
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
    // Was 1200; Claude ignored the 280–420 char prompt lock and emitted 877
    // content tokens. Ceiling sized for ≤500-char JSON narrative + headroom.
    maxCompletionTokens: 700,
  },
}

/**
 * Brands retired from every Oracle seat after consecutive total failures.
 * Must never appear as a reader, synthesizer, or seat-only brand.
 */
export const RETIRED_BRANDS = ['Qwen', 'Xiaomi MiMo'] as const

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
  },
}

export function layer1Entry(system: string): Layer1RegistryEntry | null {
  return Object.prototype.hasOwnProperty.call(LAYER1_REGISTRY, system)
    ? LAYER1_REGISTRY[system as SystemId]
    : null
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
