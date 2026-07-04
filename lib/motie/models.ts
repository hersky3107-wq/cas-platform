import 'server-only'

import type { ExtendedAiProviderName } from '@/lib/ai/router'

/**
 * Motie-ONLY flagship model overrides for the multi-brand reasoning seats
 * (open-brief 6 analysts + deliberate 6 SYNOD debaters).
 *
 * WHY THIS EXISTS (isolation): the shared router default map
 * (MODEL_BY_PROVIDER in lib/ai/router.ts) is used by BOTH motie and jeju. B2G
 * governance wants richer sourcing/reasoning and cost is not a concern here, but
 * jeju is consumer-facing and must NOT get more expensive. So instead of editing
 * the shared router map, motie passes these per-call `modelOverride`s. Providers
 * NOT listed here fall through to their router default (via `?? undefined`).
 *
 * DISCIPLINE: every string below is grep-verified to already appear in the
 * codebase as a valid model id — none are invented.
 *   - anthropic: claude-sonnet-4-6 (default) → claude-opus-4-8 (flagship; used by
 *     orchestrator/synthesis/verdict/diagnostic-issues + apex/synod verdicts).
 *   - google: stays at router default gemini-3.5-flash (preview pro tier removed
 *     for demo stability — no auto-fallback on this path).
 * Others (openai/xai/deepseek/mistral) intentionally keep their router default —
 * no verified higher string was chosen (openai gpt-4o, xai grok-3,
 * deepseek deepseek-chat, mistral mistral-large-latest).
 */
export const MOTIE_FLAGSHIP_BY_PROVIDER: Partial<Record<ExtendedAiProviderName, string>> = {
  anthropic: 'claude-opus-4-8',
}
