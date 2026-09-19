import { describe, expect, it } from 'vitest'
import { compactReaderPack } from '../compact-pack'
import { computeLeagueDivination } from '../compute'
import { fallbackRationale } from '../fallback'
import { findMarketLanguage, parseLeagueReaderRationale, rationaleLineCount } from '../parse-reader'
import { tarotNameKo, runeNameKo } from '../names'
import { LEAGUE_ORACLE_CATEGORY_IDS } from '../types'

const FIRST = '2026-09-19T08:52:00.000Z'

describe('fallbackRationale', () => {
  it('reads as Korean prose with Korean card and rune names', () => {
    const computed = computeLeagueDivination({
      roundId: 'round-fixture-1',
      firstViewIso: FIRST,
      categoryId: 'stocks',
      axis: 'direction',
    })
    const pack = compactReaderPack(computed, { proposition: 'q', subjectName: 's' })
    const text = fallbackRationale(pack)
    expect(rationaleLineCount(text)).toBe(5)
    expect(parseLeagueReaderRationale(text, pack.codeVerdict).ok).toBe(true)
    expect(findMarketLanguage(text)).toBeNull()
    expect(text).toContain(pack.tarot.outcomeKo)
    expect(text).toContain(pack.runes.futureKo)
    if (/[A-Za-z]{3,}/.test(pack.tarot.outcome)) expect(text).not.toContain(pack.tarot.outcome)
    if (/[A-Za-z]{3,}/.test(pack.runes.future)) expect(text).not.toContain(pack.runes.future)
    expect(text).toMatch(/용신은 .+입니다/)
    expect(text).not.toMatch(/King of |Queen of |Ten of |Cups|Swords|Wands|Pentacles|The [A-Z]/)
  })

  it('passes the parser for every chip without English card names', () => {
    for (const category of LEAGUE_ORACLE_CATEGORY_IDS) {
      const pickOne = category === 'sports' || category === 'politics_election' || category === 'entertainment'
      const computed = computeLeagueDivination({
        roundId: `fallback-${category}`,
        firstViewIso: FIRST,
        categoryId: category,
        axis: pickOne ? 'pick_one' : 'direction',
      })
      const pack = compactReaderPack(computed, { proposition: 'q', subjectName: 's' })
      const text = fallbackRationale(pack)
      const parsed = parseLeagueReaderRationale(text, pack.codeVerdict)
      expect(parsed, category).toMatchObject({ ok: true })
      expect(findMarketLanguage(text), category).toBeNull()
      expect(text).not.toContain('King of')
      expect(text).not.toContain('wood')
      expect(text).toContain(pack.tarot.outcomeKo)
      expect(text).toContain(pack.runes.futureKo)
    }
  })
})

describe('tarotNameKo / runeNameKo', () => {
  it('uses oracle display-copy tables', () => {
    expect(tarotNameKo('King of Swords')).toBe('검 왕')
    expect(tarotNameKo('Ten of Cups')).toBe('컵 10')
    expect(runeNameKo('Gebo')).toBe('게보')
    expect(runeNameKo('Othala')).toBe('오달라')
  })
})
