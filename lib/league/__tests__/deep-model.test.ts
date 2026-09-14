import { describe, expect, it } from 'vitest'
import { DEEPSEEK_FIRST_PARTY_THINKING } from '../roster'
import { LEAGUE_DEEP_DEEPSEEK_MODEL, leagueDeepSeekCallOptions } from '../deep-deepseek'

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
