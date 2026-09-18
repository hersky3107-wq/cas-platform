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

  it('splits 18 open / 23 closed and never invents a third value', () => {
    const counts = LEAGUE_ROSTER.reduce(
      (acc, e) => {
        acc[e.weights] += 1
        return acc
      },
      { open: 0, closed: 0 } as Record<WeightsKind, number>
    )
    expect(counts).toEqual({ open: 18, closed: 23 })
  })

  it('keeps scout entirely closed — search APIs, not a weights comparison', () => {
    const scout = LEAGUE_ROSTER.filter((e) => e.league_tier === 'scout')
    expect(scout).toHaveLength(6)
    expect(scout.every((e) => e.weights === 'closed')).toBe(true)
  })

  it('routes v4-pro, challenger flash, and world flash first-party; all DeepSeek seats first-party; Friendli Gemma is WORLD', () => {
    const pro = LEAGUE_ROSTER.find((e) => e.model_id === 'deepseek-v4-pro')
    const flashWorld = LEAGUE_ROSTER.find((e) => e.model_id === 'deepseek-v4-flash')
    const flashChallenger = LEAGUE_ROSTER.find((e) => e.model_id === 'deepseek-flash')
    const gemma = LEAGUE_ROSTER.find((e) => e.model_id === 'gemma-4-31b-it')
    expect(pro?.provider_key).toBe('deepseek')
    expect(pro?.caller).toMatchObject({ kind: 'core', provider: 'deepseek', modelOverride: 'deepseek-v4-pro' })
    expect(flashWorld?.provider_key).toBe('deepseek')
    expect(flashWorld?.caller).toMatchObject({ kind: 'core', provider: 'deepseek', modelOverride: 'deepseek-v4-flash' })
    expect(flashChallenger?.provider_key).toBe('deepseek')
    expect(flashChallenger?.caller).toMatchObject({ kind: 'core', provider: 'deepseek', modelOverride: 'deepseek-v4-flash' })
    expect(LEAGUE_ROSTER.filter((e) => e.brand === 'DeepSeek').every((e) => e.provider_key === 'deepseek')).toBe(true)
    expect(gemma).toMatchObject({
      league_tier: 'world',
      weights: 'open',
      provider_key: 'friendli',
      camp: 'us',
    })
    expect(gemma?.caller).toMatchObject({ kind: 'platform', platformId: 'friendli:gemma-4-31b-it' })
  })

  it('routes both Mistral league seats first-party (core:mistral), not OpenRouter', () => {
    const medium = LEAGUE_ROSTER.find((e) => e.model_id === 'mistral-medium-3.5')
    const small = LEAGUE_ROSTER.find((e) => e.model_id === 'mistral-small-3.2-24b')
    expect(medium).toMatchObject({
      brand: 'Mistral',
      camp: 'other',
      league_tier: 'challenger',
      weights: 'open',
      provider_key: 'mistral',
    })
    expect(medium?.caller).toMatchObject({ kind: 'core', provider: 'mistral', modelOverride: 'mistral-medium-3.5' })
    expect(small).toMatchObject({
      brand: 'Mistral',
      product_alias: 'Mistral Small',
      camp: 'other',
      league_tier: 'world',
      weights: 'open',
      provider_key: 'mistral',
    })
    expect(small?.caller).toMatchObject({ kind: 'core', provider: 'mistral', modelOverride: 'mistral-small-2603' })
    expect(LEAGUE_ROSTER.some((e) => e.model_id === 'granite-4.2-8b' || e.model_id === 'ernie-4.5-vl' || e.model_id === 'ernie-4.5')).toBe(false)
    expect(LEAGUE_ROSTER.filter((e) => e.brand === 'Mistral').every((e) => e.provider_key === 'mistral')).toBe(true)
  })

  it('routes challenger Hunyuan 3 on OpenRouter with the default 60s timeout; retires kimi-k2.6; keeps premier kimi-k3', () => {
    const hunyuan = LEAGUE_ROSTER.find((e) => e.model_id === 'hunyuan-3')
    const k26 = LEAGUE_ROSTER.find((e) => e.model_id === 'kimi-k2.6')
    const k3 = LEAGUE_ROSTER.find((e) => e.model_id === 'kimi-k3')
    expect(hunyuan).toMatchObject({
      brand: 'Tencent',
      product_alias: 'Hunyuan',
      camp: 'china',
      league_tier: 'challenger',
      weights: 'closed',
      provider_key: 'openrouter',
      reasoning: false,
    })
    expect(hunyuan?.caller).toMatchObject({ kind: 'platform', platformId: 'openrouter:hunyuan-3' })
    expect(hunyuan?.timeoutMs).toBeUndefined()
    expect(k26).toBeUndefined()
    expect(k3).toMatchObject({
      brand: 'Moonshot AI',
      league_tier: 'premier',
      provider_key: 'openrouter',
    })
    expect(LEAGUE_ROSTER.filter((e) => e.brand === 'Tencent')).toHaveLength(1)
    expect(LEAGUE_ROSTER.filter((e) => e.timeoutMs === 240_000).map((e) => e.model_id)).toEqual(['deepseek-v4-pro'])
  })

  it('correlated-note chrome tracks LEAGUE_ROSTER.length in every locale', () => {
    const n = String(LEAGUE_ROSTER.length)
    for (const locale of LEAGUE_LOCALES) {
      expect(getLeagueUiPack(locale).headline.correlatedNote, locale).toContain(n)
    }
  })
})
