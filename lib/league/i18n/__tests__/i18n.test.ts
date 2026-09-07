import { describe, expect, it } from 'vitest'
import { LEAGUE_LOCALES, LEAGUE_SELECTABLE_LOCALES, isRtlLocale, localeDir, normalizeLeagueLocale } from '../locales'
import { LEAGUE_UI, getLeagueUiPack } from '../dictionary'
import { resolveLeagueLocale } from '../resolve-locale'

describe('normalizeLeagueLocale', () => {
  it('maps common Accept-Language / navigator.language style tags to known locales', () => {
    expect(normalizeLeagueLocale('ko-KR')).toBe('ko')
    expect(normalizeLeagueLocale('ja')).toBe('ja')
    expect(normalizeLeagueLocale('zh-TW')).toBe('zh-TW')
    expect(normalizeLeagueLocale('zh-Hant-TW')).toBe('zh-TW')
    expect(normalizeLeagueLocale('fr-FR')).toBe('fr')
    expect(normalizeLeagueLocale('ar-SA')).toBe('ar')
    expect(normalizeLeagueLocale('es-MX')).toBe('es')
    expect(normalizeLeagueLocale('pt-BR')).toBe('pt')
    expect(normalizeLeagueLocale('en-US')).toBe('en')
  })

  it('returns null for unrecognized or empty input, never throws', () => {
    expect(normalizeLeagueLocale(null)).toBeNull()
    expect(normalizeLeagueLocale(undefined)).toBeNull()
    expect(normalizeLeagueLocale('')).toBeNull()
    expect(normalizeLeagueLocale('de-DE')).toBeNull()
  })

  it('does not guess a Chinese script variant from a bare "zh" tag', () => {
    expect(normalizeLeagueLocale('zh')).toBeNull()
  })
})

describe('resolveLeagueLocale (priority order)', () => {
  it('prefers the logged-in profile locale over everything else', () => {
    const locale = resolveLeagueLocale({ profileLocale: 'ko', acceptLanguage: 'fr-FR', ipCountry: 'JP' })
    expect(locale).toBe('ko')
  })

  it('falls back to Accept-Language when there is no profile preference', () => {
    const locale = resolveLeagueLocale({ profileLocale: null, acceptLanguage: 'fr-FR,fr;q=0.9,en;q=0.8', ipCountry: 'JP' })
    expect(locale).toBe('fr')
  })

  it('falls back to an IP-region hint when Accept-Language is absent/unparseable', () => {
    const locale = resolveLeagueLocale({ profileLocale: null, acceptLanguage: null, ipCountry: 'KR' })
    expect(locale).toBe('ko')
  })

  it('defaults to English when no signal resolves to anything', () => {
    const locale = resolveLeagueLocale({ profileLocale: null, acceptLanguage: null, ipCountry: null })
    expect(locale).toBe('en')
    const locale2 = resolveLeagueLocale({ profileLocale: null, acceptLanguage: 'de-DE', ipCountry: 'DE' })
    expect(locale2).toBe('en')
  })
})

describe('RTL handling', () => {
  it('flags only Arabic as RTL among the current locale set', () => {
    for (const locale of LEAGUE_LOCALES) {
      expect(isRtlLocale(locale)).toBe(locale === 'ar')
      expect(localeDir(locale)).toBe(locale === 'ar' ? 'rtl' : 'ltr')
    }
  })
})

describe('dictionary completeness', () => {
  it('has a dictionary entry for every locale, including the pt stub', () => {
    for (const locale of LEAGUE_LOCALES) {
      expect(LEAGUE_UI[locale]).toBeDefined()
      expect(getLeagueUiPack(locale).disclaimer.short.length).toBeGreaterThan(0)
      expect(getLeagueUiPack(locale).disclaimer.long.length).toBeGreaterThan(0)
      expect(getLeagueUiPack(locale).disclaimer.realEstate.length).toBeGreaterThan(0)
      expect(getLeagueUiPack(locale).operatorGrade.verifiedLabel.length).toBeGreaterThan(0)
      expect(getLeagueUiPack(locale).operatorGrade.sourceLinkLabel.length).toBeGreaterThan(0)
      expect(getLeagueUiPack(locale).operatorGrade.gradedOn('7 Sep 2026').length).toBeGreaterThan(0)
    }
  })

  it('excludes pt from the selectable (toggle) locale list while Brazil scope stays deferred', () => {
    expect(LEAGUE_SELECTABLE_LOCALES).not.toContain('pt')
    expect(LEAGUE_LOCALES).toContain('pt')
  })

  it('pt is real Portuguese on every render surface — no longer an English spread', () => {
    const pt = LEAGUE_UI.pt
    const en = LEAGUE_UI.en
    // One representative string per converted surface must differ from English.
    expect(pt.direction.badge.up).not.toBe(en.direction.badge.up)
    expect(pt.direction.noCallBadge).not.toBe(en.direction.noCallBadge)
    expect(pt.sides.subjectOutcome.win.badge.yes).not.toBe(en.sides.subjectOutcome.win.badge.yes)
    expect(pt.sides.threshold.answer.above('3,4%')).not.toBe(en.sides.threshold.answer.above('3,4%'))
    expect(pt.hero.answerVerb.up).not.toBe(en.hero.answerVerb.up)
    expect(pt.headline.correlatedNote).not.toBe(en.headline.correlatedNote)
    expect(pt.grading.reason.no_session_in_window).not.toBe(en.grading.reason.no_session_in_window)
    expect(pt.grading.reasonSubjectOutcome.no_session_in_window).not.toBe(en.grading.reasonSubjectOutcome.no_session_in_window)
    expect(pt.grading.reasonThreshold.no_session_in_window).not.toBe(en.grading.reasonThreshold.no_session_in_window)
    expect(pt.verdict.title).not.toBe(en.verdict.title)
    expect(pt.header.windowNoSessionDates).not.toBe(en.header.windowNoSessionDates)
    expect(pt.magnitude.tileLabel).not.toBe(en.magnitude.tileLabel)
    expect(pt.modelList.ungraded).not.toBe(en.modelList.ungraded)
    expect(pt.bracket.resultLegend).not.toBe(en.bracket.resultLegend)
    expect(pt.leaderboard.baselinesNote).not.toBe(en.leaderboard.baselinesNote)
    expect(pt.recordRoom.subtitle).not.toBe(en.recordRoom.subtitle)
    expect(pt.hub.subtitle).not.toBe(en.hub.subtitle)
    expect(pt.disclaimer.long).not.toBe(en.disclaimer.long)
    expect(pt.operatorGrade.verifiedLabel).not.toBe(en.operatorGrade.verifiedLabel)
    expect(pt.operatorGrade.gradedOn('7 set 2026')).not.toBe(en.operatorGrade.gradedOn('7 set 2026'))
    // Shape guarantees survive translation.
    expect(pt.verdict.heroHits(29, 40)).toContain('\u271329/40')
    expect(pt.winRate.insufficient(1, 0)).not.toContain('%')
  })

  it('falls back to English for an unrecognized key via getLeagueUiPack', () => {
    // @ts-expect-error deliberately passing a bad key to exercise the fallback
    expect(getLeagueUiPack('xx')).toBe(LEAGUE_UI.en)
  })

  it('fills in the public hub chrome for every locale', () => {
    for (const locale of LEAGUE_LOCALES) {
      const hub = getLeagueUiPack(locale).hub
      const strings = [
        hub.title,
        hub.subtitle,
        hub.tabs.cards,
        hub.tabs.leaderboard,
        hub.tabs.recordRoom,
        hub.loading,
        hub.noInstruments,
        hub.generating,
        hub.freeReadNote,
        hub.rateLimited,
        hub.genericError,
        hub.generateLive(30),
        hub.insufficientCredits(30, 0),
        hub.balance(120),
        hub.deepOpen(50),
        hub.deepDebate(70),
        hub.deepRunning,
        hub.deepUnscoredNote,
        hub.deepOpenTitle,
        hub.deepDebateTitle,
        getLeagueUiPack(locale).recordRoom.deepCta(3),
      ]
      for (const s of strings) expect(s.trim().length).toBeGreaterThan(0)
    }
  })

  it('fills in the cards-tab bracket chrome for every locale', () => {
    for (const locale of LEAGUE_LOCALES) {
      const bracket = getLeagueUiPack(locale).bracket
      expect(bracket.finalVerdict.trim().length).toBeGreaterThan(0)
      expect(bracket.division.premier.trim().length).toBeGreaterThan(0)
      expect(bracket.division.challenger.trim().length).toBeGreaterThan(0)
      expect(bracket.division.world.trim().length).toBeGreaterThan(0)
      expect(bracket.division.scout.trim().length).toBeGreaterThan(0)
      expect(bracket.showReasoning.trim().length).toBeGreaterThan(0)
      expect(bracket.hideReasoning.trim().length).toBeGreaterThan(0)
      const tally = bracket.compactTally({ up: 6, down: 4, flat: 0, abstain: 1 })
      expect(tally).toBe('6▲ 4▼ 1–')
      expect(tally).not.toMatch(/\//)
    }
  })

  it('always shows the price inside the paid hub CTA and the 402 message', () => {
    for (const locale of LEAGUE_LOCALES) {
      const hub = getLeagueUiPack(locale).hub
      // A user must be able to read what a live run costs before spending.
      expect(hub.generateLive(30)).toContain('30')
      expect(hub.insufficientCredits(30, 0)).toContain('30')
      expect(hub.deepOpen(50)).toContain('50')
      expect(hub.deepDebate(70)).toContain('70')
      expect(getLeagueUiPack(locale).recordRoom.deepCta(3)).toContain('3')
    }
  })

  it('fills in the new leaderboard / archive / verdict chrome for every locale', () => {
    for (const locale of LEAGUE_LOCALES) {
      const pack = getLeagueUiPack(locale)
      expect(pack.leaderboard.methodHeadline.trim().length).toBeGreaterThan(0)
      expect(pack.leaderboard.methodLabels.research.trim().length).toBeGreaterThan(0)
      expect(pack.leaderboard.tabs.korea.trim().length).toBeGreaterThan(0)
      expect(pack.bracket.combinedTrack('54', 12)).toContain('54')
      expect(pack.bracket.combinedTrack('54', 12)).toContain('12')
      expect(pack.bracket.combinedTrackPending.trim().length).toBeGreaterThan(0)
      expect(pack.recordRoom.freeNote.trim().length).toBeGreaterThan(0)
      expect(pack.headline.correlatedNote.trim().length).toBeGreaterThan(0)
      expect(pack.leaderboard.alwaysUp.trim().length).toBeGreaterThan(0)
      expect(pack.leaderboard.coinFlip.trim().length).toBeGreaterThan(0)
      expect(pack.leaderboard.beatingAlwaysUp(3, 40)).toContain('3')
      expect(pack.leaderboard.beatingAlwaysUp(3, 40)).toContain('40')
      expect(pack.leaderboard.beatingAlwaysUpEmpty.trim().length).toBeGreaterThan(0)
      expect(pack.leaderboard.coinFlipHint.toLowerCase()).not.toMatch(/random|seed|rng/)
      expect(pack.verdict.heroHits(29, 40)).toContain('29')
      expect(pack.verdict.heroHits(29, 40)).toContain('40')
      expect(pack.verdict.heroHits(29, 40)).not.toMatch(/%/)
      expect(pack.verdict.sectionCamp.trim().length).toBeGreaterThan(0)
      expect(pack.verdict.sectionCountryCaution.trim().length).toBeGreaterThan(0)
      expect(pack.verdict.rawCount(18, 25)).toBe('\u271318/25')
      expect(pack.verdict.heroHits(29, 40)).toContain('\u271329/40')
      expect(pack.hitRate.roundResult(27, 37)).toContain('\u271327/37')
      expect(pack.verdict.distributionHeading.trim().length).toBeGreaterThan(0)
      expect(pack.verdict.overconfidentLine(65)).toMatch(/65/)
      expect(pack.verdict.overconfidentLine(65)).toMatch(/%/)
    }
  })

  it('fills in header honesty / grading-reason / tile-expand chrome for every locale', () => {
    for (const locale of LEAGUE_LOCALES) {
      const pack = getLeagueUiPack(locale)
      expect(pack.header.headlineNoAnchor('Today', 'AAPL')).toContain('AAPL')
      expect(pack.header.headlineWithAnchor('Today', 'AAPL', '$305.59', 'Aug 17')).toContain('305.59')
      expect(pack.header.windowWithAnchor('Aug 17', '$305.59', 'Aug 18')).toContain('305.59')
      expect(pack.header.windowNoAnchor.trim().length).toBeGreaterThan(0)
      expect(pack.header.windowAnchorOnly('Aug 17', '$305.59')).toContain('305.59')
      expect(pack.header.windowNoSessionDates.trim().length).toBeGreaterThan(0)
      expect(pack.header.liveSecondary.trim().length).toBeGreaterThan(0)
      expect(pack.hitRate.roundResult(27, 37)).toContain('27')
      expect(pack.hitRate.roundResult(27, 37)).toContain('37')
      expect(pack.modelList.ungraded.trim().length).toBeGreaterThan(0)
      expect(pack.modelTile.showOriginal.trim().length).toBeGreaterThan(0)
      expect(pack.modelTile.hideOriginal.trim().length).toBeGreaterThan(0)
      expect(pack.modelTile.originalLabel.trim().length).toBeGreaterThan(0)
      expect(pack.grading.stalled.trim().length).toBeGreaterThan(0)
      expect(pack.grading.stalledNote.trim().length).toBeGreaterThan(0)
      expect(pack.grading.reason.missing_anchor.trim().length).toBeGreaterThan(0)
      expect(pack.grading.reason.equal_close.trim().length).toBeGreaterThan(0)
      expect(pack.grading.reason.unknown.trim().length).toBeGreaterThan(0)
      expect(pack.modelTile.showWhy.trim().length).toBeGreaterThan(0)
      expect(pack.modelTile.hideWhy.trim().length).toBeGreaterThan(0)
    }
  })

  it('no locale can render a win rate without its sample size, or a percentage below the minimum sample', () => {
    for (const locale of LEAGUE_LOCALES) {
      const pack = getLeagueUiPack(locale)
      const rate = pack.winRate.withSample('62', 34)
      expect(rate).toContain('62')
      // The n travels INSIDE the percentage string in every language.
      expect(rate).toContain('34')

      // Low-sample forms state a record, never a rate — in any language.
      const low = pack.winRate.insufficient(1, 0)
      expect(low).not.toContain('%')
      expect(low).toContain('1')
      expect(pack.winRate.insufficientNote.trim().length).toBeGreaterThan(0)
      expect(pack.winRate.record(34, 12)).toContain('34')
      expect(pack.winRate.rankingBegins(10)).toContain('10')
      expect(pack.winRate.noRounds.trim().length).toBeGreaterThan(0)

      // The card badge wraps a pre-composed figure, so it cannot drop the n either.
      expect(pack.hitRate.withValue('62% (n=34)')).toContain('(n=34)')
    }
  })

  it('every real (non-stub) locale renders a distinct, non-empty consensus headline', () => {
    const seen = new Set<string>()
    for (const locale of LEAGUE_SELECTABLE_LOCALES) {
      const headline = LEAGUE_UI[locale].headline.majority(6, 8, 'up', 58)
      expect(headline.length).toBeGreaterThan(0)
      seen.add(headline)
    }
    // en/ko/ja/zh-TW/fr/ar/es should all read differently
    expect(seen.size).toBe(LEAGUE_SELECTABLE_LOCALES.length)
  })
})
