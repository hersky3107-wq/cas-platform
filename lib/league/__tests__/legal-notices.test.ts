import { describe, expect, it } from 'vitest'
import { getLeagueUiPack } from '../i18n/dictionary'
import { LEAGUE_LOCALES } from '../i18n/locales'
import { SPORTS_UI_BANNED_RE } from '../sports-market'

describe('sports and housing legal notices', () => {
  it('states the sports notice in every locale without banned syllables', () => {
    for (const locale of LEAGUE_LOCALES) {
      const line = getLeagueUiPack(locale).disclaimer.sports
      expect(line.length).toBeGreaterThan(40)
      expect(line).not.toMatch(SPORTS_UI_BANNED_RE)
    }
    expect(getLeagueUiPack('en').disclaimer.sports).toContain(
      'Informational analysis only. This is not gambling advice.',
    )
    expect(getLeagueUiPack('ko').disclaimer.sports).toContain('국민체육진흥법')
    expect(getLeagueUiPack('ko').disclaimer.neutralReference).toContain('참고 자료')
  })

  it('states the housing notice in every locale and keeps the scope line', () => {
    for (const locale of LEAGUE_LOCALES) {
      const pack = getLeagueUiPack(locale)
      expect(pack.disclaimer.realEstate.length).toBeGreaterThan(20)
      expect(pack.disclaimer.realEstateScope.length).toBeGreaterThan(10)
      expect(pack.disclaimer.neutralReference.length).toBeGreaterThan(10)
    }
    expect(getLeagueUiPack('ko').disclaimer.realEstate).toContain('공개된 가격 지수')
    expect(getLeagueUiPack('en').disclaimer.realEstate).toContain('not the price of any specific property')
  })
})
