import { describe, expect, it } from 'vitest'
import { LEAGUE_LOCALES } from '../i18n/locales'
import { getLeagueUiPack } from '../i18n/dictionary'
import { LEAGUE_ROSTER, type WeightsKind } from '../roster'

describe('roster weights classification', () => {
  it('has exactly 40 seats and every seat is binary open|closed', () => {
    expect(LEAGUE_ROSTER).toHaveLength(41)
    for (const entry of LEAGUE_ROSTER) {
      expect(entry.weights === 'open' || entry.weights === 'closed', entry.model_id).toBe(true)
    }
  })

  it('splits 19 open / 22 closed and never invents a third value', () => {
    const counts = LEAGUE_ROSTER.reduce(
      (acc, e) => {
        acc[e.weights] += 1
        return acc
      },
      { open: 0, closed: 0 } as Record<WeightsKind, number>
    )
    expect(counts).toEqual({ open: 19, closed: 22 })
  })

  it('keeps scout entirely closed — search APIs, not a weights comparison', () => {
    const scout = LEAGUE_ROSTER.filter((e) => e.league_tier === 'scout')
    expect(scout).toHaveLength(6)
    expect(scout.every((e) => e.weights === 'closed')).toBe(true)
  })

  it('routes v4-pro and v4-flash first-party; leaves v3.2 on OpenRouter; Friendli Gemma is WORLD', () => {
    const pro = LEAGUE_ROSTER.find((e) => e.model_id === 'deepseek-v4-pro')
    const flash = LEAGUE_ROSTER.find((e) => e.model_id === 'deepseek-v4-flash')
    const v32 = LEAGUE_ROSTER.find((e) => e.model_id === 'deepseek-v3.2')
    const gemma = LEAGUE_ROSTER.find((e) => e.model_id === 'gemma-4-31b-it')
    expect(pro?.provider_key).toBe('deepseek')
    expect(pro?.caller).toMatchObject({ kind: 'core', provider: 'deepseek', modelOverride: 'deepseek-v4-pro' })
    expect(flash?.provider_key).toBe('deepseek')
    expect(flash?.caller).toMatchObject({ kind: 'core', provider: 'deepseek', modelOverride: 'deepseek-v4-flash' })
    expect(v32?.provider_key).toBe('openrouter')
    expect(v32?.caller).toMatchObject({ kind: 'platform', platformId: 'openrouter:deepseek-v3.2' })
    expect(gemma).toMatchObject({
      league_tier: 'world',
      weights: 'open',
      provider_key: 'friendli',
      camp: 'us',
    })
    expect(gemma?.caller).toMatchObject({ kind: 'platform', platformId: 'friendli:gemma-4-31b-it' })
  })

  it('correlated-note chrome tracks LEAGUE_ROSTER.length in every locale', () => {
    const n = String(LEAGUE_ROSTER.length)
    for (const locale of LEAGUE_LOCALES) {
      expect(getLeagueUiPack(locale).headline.correlatedNote, locale).toContain(n)
    }
  })
})
