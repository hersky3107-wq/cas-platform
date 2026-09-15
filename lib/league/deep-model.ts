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
  solar: 'upstage:solar-pro3',
}

const ROUTER_PROVIDERS = new Set<string>(['openai', 'anthropic', 'google', 'xai', 'deepseek', 'mistral', 'perplexity', 'meta'])

function noDbSupabase(): SupabaseClient {
  return createClient('http://localhost', 'league-deep-no-db') as unknown as SupabaseClient
}

/**
 * One deep-analysis model call. EVERY seat is bounded:
 *   - platform seats (glm/solar): 120s wall; callPlatformModel's own
 *     empty-content retry loop (the league-gen 537s fix) applies inside.
 *   - router seats: leagueDeepTimeoutMs wall (120s default, 240s DeepSeek)
 *     raced inside runSingleAiProvider, PLUS the same bounded
 *     empty-content retries (20s abort each) so one flaky seat cannot
 *     hold a Promise.allSettled hop for minutes.
 */
export async function callLeagueDeepModel(params: {
  provider: string
  systemPrompt: string
  userPrompt: string
  maxCompletionTokens: number
  timeoutMs?: number
  modelOverride?: string
}): Promise<{ text: string | null; error?: string }> {
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
      return { text: null, error: called.error ?? 'empty model response' }
    }
    return { text: called.text.trim() }
  }

  if (!ROUTER_PROVIDERS.has(params.provider)) {
    return { text: null, error: `unknown league deep provider: ${params.provider}` }
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
        extraPayload: deepseekOpts?.extraPayload,
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
    if (r.error || !r.text?.trim()) {
      return { text: null, error: r.error ?? 'empty model response' }
    }
    return { text: r.text.trim() }
  } catch (e: unknown) {
    return { text: null, error: e instanceof Error ? e.message : 'model call threw' }
  }
}

export function stripFences(raw: string): string {
  let text = raw.trim()
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)(?:```|$)/i)
  if (fence && fence[1]) text = fence[1].trim()
  if (!text.startsWith('{')) {
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    if (start !== -1 && end > start) text = text.slice(start, end + 1)
  }
  return text
}

export function parseJsonObject(raw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(stripFences(raw))
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}
