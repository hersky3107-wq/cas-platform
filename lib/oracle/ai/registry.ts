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
    }

export type Layer1RegistryEntry = {
  system: SystemId
  /** English brand shown to the client. Never the model string. */
  brand: string
  /** Exact API model id. Server-only. */
  model: string
  displayName: string
  caller: Layer1Caller
  /**
   * TRAP (a): current top models are reasoners. A small budget is spent on
   * hidden reasoning and the visible reply comes back content:null /
   * finish_reason:length. Narratives are long, so this is generous.
   */
  maxCompletionTokens: number
}

export const LAYER1_REGISTRY: Record<SystemId, Layer1RegistryEntry> = {
  saju: {
    system: 'saju',
    brand: 'DeepSeek',
    displayName: 'DeepSeek V3.2',
    // PLATFORM_MODEL_REGISTRY id 'openrouter:deepseek-v3.2' (challenger, verified).
    model: 'deepseek/deepseek-v3.2',
    caller: { kind: 'platform', platformId: 'openrouter:deepseek-v3.2' },
    maxCompletionTokens: 4000,
  },
  ziwei: {
    system: 'ziwei',
    brand: 'Qwen',
    displayName: 'Qwen 3.5 Plus',
    // Catalog id is dated (`qwen3.5-plus-20260420`); confirmed live 2026-08-16.
    // TRAP (b): Qwen REJECTS reasoning.enabled=false (HTTP 400). The registry
    // entry already sends reasoning:{effort:'minimal'} — do not add a disable.
    model: 'qwen/qwen3.5-plus-20260420',
    caller: { kind: 'platform', platformId: 'openrouter:qwen3.5-plus' },
    maxCompletionTokens: 4000,
  },
  iching: {
    system: 'iching',
    brand: 'Z.ai',
    displayName: 'GLM-5.2',
    model: 'z-ai/glm-5.2',
    caller: { kind: 'platform', platformId: 'openrouter:glm-5.2' },
    maxCompletionTokens: 4000,
  },
  ninestar: {
    system: 'ninestar',
    brand: 'Moonshot AI',
    displayName: 'Kimi K2.6',
    // League confirmed 8000 is the working budget on a long prompt (2026-08-16).
    model: 'moonshotai/kimi-k2.6',
    caller: { kind: 'platform', platformId: 'openrouter:kimi-k2.6' },
    maxCompletionTokens: 8000,
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
    maxCompletionTokens: 4000,
  },
  astro: {
    system: 'astro',
    brand: 'OpenAI',
    displayName: 'GPT-5.6 Terra',
    // League challenger slot; health page pings this exact modelOverride.
    model: 'gpt-5.6-terra',
    caller: { kind: 'core', provider: 'openai', modelOverride: 'gpt-5.6-terra' },
    maxCompletionTokens: 4000,
  },
  tarot: {
    system: 'tarot',
    brand: 'Google',
    displayName: 'Gemini 3.6 Flash',
    // TRAP (d): gemini-3.6-flash REJECTS thinkingConfig:{thinkingBudget:0}
    // (HTTP 400 INVALID_ARGUMENT). allowGeminiThinking:true is required.
    model: 'gemini-3.6-flash',
    caller: {
      kind: 'core',
      provider: 'google',
      modelOverride: 'gemini-3.6-flash',
      allowGeminiThinking: true,
    },
    maxCompletionTokens: 4000,
  },
  runes: {
    system: 'runes',
    brand: 'xAI',
    displayName: 'Grok 4.3',
    model: 'grok-4.3',
    caller: { kind: 'core', provider: 'xai', modelOverride: 'grok-4.3' },
    maxCompletionTokens: 4000,
  },
  numerology: {
    system: 'numerology',
    brand: 'Mistral',
    displayName: 'Mistral Medium 3.5',
    // Catalog id is dashed (`mistral-medium-3-5`), not dotted. See
    // PLATFORM_MODEL_REGISTRY note — 3.1 is the older minor.
    model: 'mistralai/mistral-medium-3-5',
    caller: { kind: 'platform', platformId: 'openrouter:mistral-medium-3.5' },
    maxCompletionTokens: 4000,
  },
  name: {
    system: 'name',
    brand: 'NAVER',
    displayName: 'HyperCLOVA X HCX-007',
    model: 'HCX-007',
    caller: { kind: 'platform', platformId: 'clova:hcx-007' },
    maxCompletionTokens: 4000,
  },
  tzolkin: {
    system: 'tzolkin',
    brand: 'NVIDIA',
    displayName: 'Nemotron 3 Ultra',
    // Full catalog id is nemotron-3-ultra-550b-a55b (not the bare name).
    model: 'nvidia/nemotron-3-ultra-550b-a55b',
    caller: { kind: 'platform', platformId: 'openrouter:nemotron-3-ultra-550b' },
    maxCompletionTokens: 4000,
  },
  prism: {
    system: 'prism',
    brand: 'Anthropic',
    displayName: 'Claude Sonnet 5',
    model: 'claude-sonnet-5',
    caller: { kind: 'core', provider: 'anthropic', modelOverride: 'claude-sonnet-5' },
    maxCompletionTokens: 4000,
  },
}

export function layer1Entry(system: string): Layer1RegistryEntry | null {
  return Object.prototype.hasOwnProperty.call(LAYER1_REGISTRY, system)
    ? LAYER1_REGISTRY[system as SystemId]
    : null
}

// TRAP (c): Amazon Nova BREAKS if a reasoning option is present at all.
// None of the twelve layer-1 systems use Nova. If one is added later, do
// not merge reasoning:{…} into that request — leave extraRequestParams unset,
// matching `openrouter:nova-2-lite` in PLATFORM_MODEL_REGISTRY.
