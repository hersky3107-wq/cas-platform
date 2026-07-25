import 'server-only'

import type { ExtendedAiProviderName } from '@/lib/ai/router'

/**
 * Motie-ONLY flagship model overrides for the multi-brand reasoning seats
 * (open-brief analysts + deliberate SYNOD debaters).
 *
 * WHY THIS EXISTS (isolation): the shared router default map
 * (MODEL_BY_PROVIDER in lib/ai/router.ts) is used by BOTH motie and jeju. B2G
 * governance wants richer sourcing/reasoning and cost is not a concern here, but
 * jeju is consumer-facing and must NOT get more expensive. So instead of editing
 * the shared router map, motie passes these per-call `modelOverride`s. Providers
 * NOT listed here fall through to their router default (via `?? undefined`).
 *
 * DISCIPLINE: every string below is a verified-valid model id for its provider.
 *   - anthropic: claude-sonnet-4-6 (default) → claude-opus-4-8 (flagship; used by
 *     orchestrator/synthesis/verdict/diagnostic-issues + apex/synod verdicts).
 *   - deepseek: deepseek-chat was retired 2026-07-24; motie overrides to
 *     deepseek-v4-pro (quality-first; NOT flash). Thinking stays ON (API default);
 *     CoT lands in a separate `reasoning_content` field while the final answer
 *     stays in `message.content` — callOpenAICompatibleChat already reads only
 *     content, so thinking-on is safe and preferred for B2G depth.
 *   - google: stays at router default gemini-3.5-flash (preview pro tier removed
 *     for demo stability — no auto-fallback on this path).
 * Others (openai/xai/mistral) intentionally keep their router default.
 */
export const MOTIE_FLAGSHIP_BY_PROVIDER: Partial<Record<ExtendedAiProviderName, string>> = {
  anthropic: 'claude-opus-4-8',
  deepseek: 'deepseek-v4-pro',
}
