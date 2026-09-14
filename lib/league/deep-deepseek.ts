import { DEEPSEEK_FIRST_PARTY_THINKING } from './roster'

/** Deep-analysis DeepSeek seat — same first-party id + thinking body as scored-round v4-pro. */
export const LEAGUE_DEEP_DEEPSEEK_MODEL = 'deepseek-v4-pro'
export const LEAGUE_DEEP_DEEPSEEK_TIMEOUT_MS = 240_000

export function leagueDeepSeekCallOptions(modelOverride?: string): {
  modelOverride: string
  extraPayload: Record<string, unknown>
} {
  return {
    modelOverride: modelOverride ?? LEAGUE_DEEP_DEEPSEEK_MODEL,
    extraPayload: DEEPSEEK_FIRST_PARTY_THINKING,
  }
}
