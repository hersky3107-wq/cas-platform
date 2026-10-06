import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { runSingleAiProvider, type ExtendedAiProviderName } from '@/lib/ai/router'
import { callPlatformModel } from '@/lib/ai/platform-providers'
import {
  EMPTY_CONTENT_MAX_ATTEMPTS,
  EMPTY_CONTENT_RETRY_TIMEOUT_MS,
  emptyContentRetryBackoffMs,
} from '@/lib/ai/empty-content-retry'
import { LEAGUE_DEEP_DEFAULT_TIMEOUT_MS, leagueDeepTimeoutMs } from './deep-call-policy'
import { leagueDeepSeekCallOptions } from './deep-deepseek'

const PLATFORM_BY_PROVIDER: Record<string, string> = {
  'glm-5.2': 'openrouter:glm-5.2',
  solar: 'upstage:solar-pro4',
}

const ROUTER_PROVIDERS = new Set<string>(['openai', 'anthropic', 'google', 'xai', 'deepseek', 'mistral', 'perplexity', 'meta'])

function noDbSupabase(): SupabaseClient {
  return createClient('http://localhost', 'league-deep-no-db') as unknown as SupabaseClient
}

export type LeagueDeepUsage = {
  promptTokens: number | null
  completionTokens: number | null
  /** Provider-reported USD (Perplexity total_cost, xAI ticks). Null when the provider reports none. */
  billedUsd: number | null
  /** Tool fee not folded into billedUsd (Anthropic web_search). */
  toolFeeUsd: number | null
}

export type LeagueDeepCallResult = {
  text: string | null
  error?: string
  model: string | null
  finishReason?: string | null
  usage?: LeagueDeepUsage
  ms: number
}

/**
 * One deep-analysis model call. EVERY seat is bounded:
 *   - platform seats (glm/solar): 120s wall; callPlatformModel's own
 *     empty-content retry loop (the league-gen 537s fix) applies inside.
 *   - router seats: leagueDeepTimeoutMs wall (120s default, 240s DeepSeek)
 *     raced inside runSingleAiProvider, PLUS the same bounded
 *     empty-content retries (35s abort each) so one flaky seat cannot
 *     hold a Promise.allSettled hop for minutes.
 */
export async function callLeagueDeepModel(params: {
  provider: string
  systemPrompt: string
  userPrompt: string
  maxCompletionTokens: number
  timeoutMs?: number
  modelOverride?: string
  /** Gemini grounding, xAI web_search, Claude web_search. Ignored by other providers. */
  searchTool?: boolean
  /** Extra body fields (e.g. xAI reasoning_effort). DeepSeek uses its own league options. */
  extraPayload?: Record<string, unknown>
  allowGeminiThinking?: boolean
  anthropicThinking?: 'disabled' | 'enabled' | 'adaptive'
}): Promise<LeagueDeepCallResult> {
  const started = Date.now()
  const platformId = PLATFORM_BY_PROVIDER[params.provider]
  if (platformId) {
    const called = await callPlatformModel({
      id: platformId,
      systemPrompt: params.systemPrompt,
      userPrompt: params.userPrompt,
      maxCompletionTokens: params.maxCompletionTokens,
      timeoutMs: params.timeoutMs ?? LEAGUE_DEEP_DEFAULT_TIMEOUT_MS,
    })
    if (called.error || !called.text?.trim()) {
      return { text: null, error: called.error ?? 'empty model response', model: platformId, ms: Date.now() - started }
    }
    return { text: called.text.trim(), model: platformId, ms: Date.now() - started }
  }

  if (!ROUTER_PROVIDERS.has(params.provider)) {
    return { text: null, error: `unknown league deep provider: ${params.provider}`, model: null, ms: 0 }
  }

  try {
    const deepseekOpts = params.provider === 'deepseek' ? leagueDeepSeekCallOptions(params.modelOverride) : null
    const callOnce = (timeoutMs: number) =>
      runSingleAiProvider({
        supabase: noDbSupabase(),
        sessionId: null,
        userId: null,
        provider: params.provider as ExtendedAiProviderName,
        prompt: params.userPrompt,
        systemPrompt: params.systemPrompt,
        maxCompletionTokens: params.maxCompletionTokens,
        modelOverride: deepseekOpts?.modelOverride ?? params.modelOverride,
        extraPayload: deepseekOpts?.extraPayload ?? params.extraPayload,
        allowGeminiThinking: params.allowGeminiThinking,
        anthropicThinking: params.anthropicThinking,
        searchTool: params.searchTool,
        timeoutMs,
      })

    let r = await callOnce(leagueDeepTimeoutMs(params.provider, params.timeoutMs))
    for (let attempt = 2; attempt <= EMPTY_CONTENT_MAX_ATTEMPTS && !r.error && !r.text?.trim(); attempt += 1) {
      console.log(
        `[league-deep] ${params.provider}: empty response — retry ${attempt - 1}/${EMPTY_CONTENT_MAX_ATTEMPTS - 1} (abort ${EMPTY_CONTENT_RETRY_TIMEOUT_MS}ms).`
      )
      await new Promise((resolve) => setTimeout(resolve, emptyContentRetryBackoffMs(attempt - 2)))
      r = await callOnce(EMPTY_CONTENT_RETRY_TIMEOUT_MS)
    }
    const usage: LeagueDeepUsage = {
      promptTokens: r.promptTokens ?? null,
      completionTokens: r.completionTokens ?? null,
      billedUsd: typeof r.costUsd === 'number' && r.costUsd > 0 ? r.costUsd : null,
      toolFeeUsd: typeof r.toolFeeUsd === 'number' ? r.toolFeeUsd : null,
    }
    const base = { model: r.model ?? params.modelOverride ?? null, finishReason: r.finishReason ?? null, usage, ms: Date.now() - started }
    if (r.error || !r.text?.trim()) {
      return { text: null, error: r.error ?? 'empty model response', ...base }
    }
    return { text: r.text.trim(), ...base }
  } catch (e: unknown) {
    return {
      text: null,
      error: e instanceof Error ? e.message : 'model call threw',
      model: params.modelOverride ?? null,
      ms: Date.now() - started,
    }
  }
}

export { parseJsonObject, stripFences } from './json-object'
