import { describe, expect, it } from 'vitest'
import { DEEPSEEK_FIRST_PARTY_THINKING } from '../roster'
import {
  LEAGUE_DEEP_DEEPSEEK_MODEL,
  LEAGUE_DEEP_DEEPSEEK_TIMEOUT_MS,
  leagueDeepSeekCallOptions,
} from '../deep-deepseek'
import { LEAGUE_DEEP_DEFAULT_TIMEOUT_MS, leagueDeepTimeoutMs } from '../deep-call-policy'

describe('league deep DeepSeek seat', () => {
  it('pins first-party v4-pro plus the roster thinking payload', () => {
    expect(leagueDeepSeekCallOptions()).toEqual({
      modelOverride: 'deepseek-v4-pro',
      extraPayload: DEEPSEEK_FIRST_PARTY_THINKING,
    })
    expect(LEAGUE_DEEP_DEEPSEEK_MODEL).toBe('deepseek-v4-pro')
    expect(DEEPSEEK_FIRST_PARTY_THINKING).toMatchObject({
      thinking: { type: 'enabled' },
      reasoning_effort: 'low',
    })
  })

  it('keeps an explicit DeepSeek override and still sends thinking', () => {
    expect(leagueDeepSeekCallOptions('deepseek-v4-flash')).toEqual({
      modelOverride: 'deepseek-v4-flash',
      extraPayload: DEEPSEEK_FIRST_PARTY_THINKING,
    })
  })
})

describe('league deep per-call timeout policy', () => {
  it('bounds every router seat at the default wall', () => {
    expect(LEAGUE_DEEP_DEFAULT_TIMEOUT_MS).toBe(120_000)
    for (const provider of ['openai', 'anthropic', 'google', 'xai', 'mistral', 'perplexity', 'meta']) {
      expect(leagueDeepTimeoutMs(provider)).toBe(LEAGUE_DEEP_DEFAULT_TIMEOUT_MS)
    }
  })

  it('keeps the slower first-party DeepSeek budget', () => {
    expect(leagueDeepTimeoutMs('deepseek')).toBe(LEAGUE_DEEP_DEEPSEEK_TIMEOUT_MS)
    expect(LEAGUE_DEEP_DEEPSEEK_TIMEOUT_MS).toBeGreaterThan(LEAGUE_DEEP_DEFAULT_TIMEOUT_MS)
  })

  it('lets an explicit caller override win', () => {
    expect(leagueDeepTimeoutMs('openai', 30_000)).toBe(30_000)
    expect(leagueDeepTimeoutMs('deepseek', 30_000)).toBe(30_000)
    // Zero / negative overrides fall back to the policy default.
    expect(leagueDeepTimeoutMs('openai', 0)).toBe(LEAGUE_DEEP_DEFAULT_TIMEOUT_MS)
  })
})
