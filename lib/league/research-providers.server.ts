import 'server-only'

import { callPlatformModel } from '@/lib/ai/platform-providers'
import { runSingleAiProvider } from '@/lib/ai/router'
import { supabaseAdmin } from '@/lib/supabase/server'
import { lookupRosterEntry } from '@/lib/league/roster'
import { parseResearchModeOutput } from './research-merge'
import {
  RESEARCH_MODE_SYSTEM,
  researchModeUserPrompt,
  type ResearchProviderCallArgs,
  type ResearchProviderCallResult,
  type ResearchProviderId,
} from './research-providers'

const RESEARCH_ROSTER_MODEL: Record<ResearchProviderId, string> = {
  perplexity: 'sonar',
  xai: 'grok-4.6-livesearch',
  gemini: 'gemini-3.6-flash-grounded',
  openai: 'gpt-5-search-api',
  youcom: 'youcom-research',
  claude: 'claude-sonnet-5-websearch',
}

export async function liveResearchProviderCaller(
  args: ResearchProviderCallArgs,
): Promise<ResearchProviderCallResult> {
  const modelId = RESEARCH_ROSTER_MODEL[args.provider]
  const entry = lookupRosterEntry(modelId)
  if (!entry) return { findings: [], costUsd: 0, error: `unknown roster model ${modelId}` }

  const prompt = researchModeUserPrompt(args)
  try {
    if (entry.caller.kind === 'platform') {
      const res = await callPlatformModel({
        id: entry.caller.platformId,
        systemPrompt: RESEARCH_MODE_SYSTEM,
        userPrompt: prompt,
        maxCompletionTokens: entry.maxCompletionTokens ?? 1600,
        timeoutMs: args.timeoutMs,
      })
      if (res.error) return { findings: [], costUsd: res.costUsd ?? 0, error: res.error }
      return {
        findings: parseResearchModeOutput({ provider: args.provider, text: res.text }),
        costUsd: res.costUsd ?? 0,
      }
    }

    const caller = entry.caller
    const res = await runSingleAiProvider({
      supabase: supabaseAdmin,
      authSupabase: supabaseAdmin,
      sessionId: null,
      userId: null,
      provider: caller.provider,
      prompt,
      systemPrompt: RESEARCH_MODE_SYSTEM,
      skipLanguageInjection: true,
      maxCompletionTokens: entry.maxCompletionTokens ?? 1600,
      modelOverride: caller.modelOverride,
      allowGeminiThinking: caller.allowGeminiThinking,
      searchTool: caller.searchTool,
      maxTurns: caller.maxTurns,
      extraPayload: caller.extraPayload,
      timeoutMs: args.timeoutMs,
    })
    if (res.error) {
      return { findings: [], costUsd: billedUsd(res.costUsd, res.toolFeeUsd), error: res.error }
    }
    return {
      findings: parseResearchModeOutput({
        provider: args.provider,
        text: res.text,
        citations: res.citations,
        searchResults: res.searchResults,
      }),
      costUsd: billedUsd(res.costUsd, res.toolFeeUsd),
    }
  } catch (error) {
    return {
      findings: [],
      costUsd: 0,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

function billedUsd(costUsd: number | null | undefined, toolFeeUsd: number | null | undefined): number {
  return (typeof costUsd === 'number' ? costUsd : 0) + (typeof toolFeeUsd === 'number' ? toolFeeUsd : 0)
}
