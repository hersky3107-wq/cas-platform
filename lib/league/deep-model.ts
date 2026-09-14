import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { runSingleAiProvider, type ExtendedAiProviderName } from '@/lib/ai/router'
import { callPlatformModel } from '@/lib/ai/platform-providers'
import { LEAGUE_DEEP_DEEPSEEK_TIMEOUT_MS, leagueDeepSeekCallOptions } from './deep-deepseek'

const PLATFORM_BY_PROVIDER: Record<string, string> = {
  'glm-5.2': 'openrouter:glm-5.2',
  solar: 'upstage:solar-pro3',
}

const ROUTER_PROVIDERS = new Set<string>(['openai', 'anthropic', 'google', 'xai', 'deepseek', 'mistral', 'perplexity', 'meta'])

function noDbSupabase(): SupabaseClient {
  return createClient('http://localhost', 'league-deep-no-db') as unknown as SupabaseClient
}

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
      timeoutMs: params.timeoutMs ?? 120_000,
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
    const r = await runSingleAiProvider({
      supabase: noDbSupabase(),
      sessionId: null,
      userId: null,
      provider: params.provider as ExtendedAiProviderName,
      prompt: params.userPrompt,
      systemPrompt: params.systemPrompt,
      maxCompletionTokens: params.maxCompletionTokens,
      modelOverride: deepseekOpts?.modelOverride ?? params.modelOverride,
      extraPayload: deepseekOpts?.extraPayload,
      timeoutMs: deepseekOpts ? (params.timeoutMs ?? LEAGUE_DEEP_DEEPSEEK_TIMEOUT_MS) : params.timeoutMs,
    })
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
