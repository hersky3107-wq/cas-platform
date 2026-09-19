/**
 * Single reader call. One AI, 4–5 lines. Retry once on parse miss, then
 * code-generated fallback. The model never owns the verdict.
 */
import {
  LEAGUE_READER_BRAND,
  LEAGUE_READER_ESTIMATED_COST_USD,
  LEAGUE_READER_EXTRA_REQUEST_PARAMS,
  LEAGUE_READER_MAX_COMPLETION_TOKENS,
  LEAGUE_READER_MODEL,
  LEAGUE_READER_PLATFORM_ID,
  LEAGUE_READER_TIMEOUT_MS,
} from './conventions'
import type { LeagueReaderCompactPack } from './compact-pack'
import { fallbackRationale } from './fallback'
import { parseLeagueReaderRationale } from './parse-reader'
import { buildLeagueReaderSystemPrompt, buildLeagueReaderUserPrompt, LEAGUE_READER_STRICT_RETRY } from './prompt'

export type LeagueReaderCallResult = {
  text: string | null
  error?: string
  costUsd?: number | null
  costIsEstimated?: boolean
}

export type LeagueReaderCall = (input: {
  systemPrompt: string
  userPrompt: string
  maxCompletionTokens: number
  timeoutMs: number
  strictRetry: boolean
}) => Promise<LeagueReaderCallResult>

export type LeagueReaderOutcome = {
  rationale: string
  source: 'ai' | 'fallback'
  attempts: number
  brand: string
  model: string
  costUsd: number | null
  costIsEstimated: boolean
}

async function defaultCall(input: Parameters<LeagueReaderCall>[0]): Promise<LeagueReaderCallResult> {
  const { callPlatformModel } = await import('@/lib/ai/platform-providers')
  const res = await callPlatformModel({
    id: LEAGUE_READER_PLATFORM_ID,
    systemPrompt: input.systemPrompt,
    userPrompt: input.userPrompt,
    maxCompletionTokens: input.maxCompletionTokens,
    extraRequestParams: { ...LEAGUE_READER_EXTRA_REQUEST_PARAMS },
    debugRequestLabel: 'league-divination-reader',
    timeoutMs: input.timeoutMs,
  })
  return {
    text: res.text ?? null,
    error: res.error,
    costUsd: typeof res.costUsd === 'number' ? res.costUsd : null,
    costIsEstimated: res.costIsEstimated ?? false,
  }
}

export async function runLeagueReader(
  pack: LeagueReaderCompactPack,
  call: LeagueReaderCall = defaultCall,
): Promise<LeagueReaderOutcome> {
  const system = buildLeagueReaderSystemPrompt()
  const user = buildLeagueReaderUserPrompt(pack)

  const first = await call({
    systemPrompt: system,
    userPrompt: user,
    maxCompletionTokens: LEAGUE_READER_MAX_COMPLETION_TOKENS,
    timeoutMs: LEAGUE_READER_TIMEOUT_MS,
    strictRetry: false,
  })
  const firstCost = typeof first.costUsd === 'number' ? first.costUsd : (first.text ? LEAGUE_READER_ESTIMATED_COST_USD : 0)
  const parsed = parseLeagueReaderRationale(first.text ?? '', pack.codeVerdict)
  if (parsed.ok) {
    return {
      rationale: parsed.rationale,
      source: 'ai',
      attempts: 1,
      brand: LEAGUE_READER_BRAND,
      model: LEAGUE_READER_MODEL,
      costUsd: firstCost > 0 ? firstCost : null,
      costIsEstimated: true,
    }
  }

  const second = await call({
    systemPrompt: system + LEAGUE_READER_STRICT_RETRY,
    userPrompt: user,
    maxCompletionTokens: LEAGUE_READER_MAX_COMPLETION_TOKENS,
    timeoutMs: LEAGUE_READER_TIMEOUT_MS,
    strictRetry: true,
  })
  const secondCost = typeof second.costUsd === 'number' ? second.costUsd : (second.text ? LEAGUE_READER_ESTIMATED_COST_USD : 0)
  const totalCost = firstCost + secondCost
  const retried = parseLeagueReaderRationale(second.text ?? '', pack.codeVerdict)
  if (retried.ok) {
    return {
      rationale: retried.rationale,
      source: 'ai',
      attempts: 2,
      brand: LEAGUE_READER_BRAND,
      model: LEAGUE_READER_MODEL,
      costUsd: totalCost > 0 ? totalCost : null,
      costIsEstimated: true,
    }
  }

  return {
    rationale: fallbackRationale(pack),
    source: 'fallback',
    attempts: 2,
    brand: LEAGUE_READER_BRAND,
    model: LEAGUE_READER_MODEL,
    costUsd: totalCost > 0 ? totalCost : null,
    costIsEstimated: true,
  }
}
