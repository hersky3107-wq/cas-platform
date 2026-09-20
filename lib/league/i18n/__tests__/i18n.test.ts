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
      expect(getLeagueUiPack(locale).disclaimer.extraExperimental.length).toBeGreaterThan(0)
      expect(getLeagueUiPack(locale).operatorGrade.verifiedLabel.length).toBeGreaterThan(0)
      expect(getLeagueUiPack(locale).operatorGrade.sourceLinkLabel.length).toBeGreaterThan(0)
      expect(getLeagueUiPack(locale).operatorGrade.gradedOn('7 Sep 2026').length).toBeGreaterThan(0)
      expect(getLeagueUiPack(locale).sides.subjectOutcome.achieved.badge.yes.length).toBeGreaterThan(0)
      expect(getLeagueUiPack(locale).sides.subjectOutcome.achieved.badge.no.length).toBeGreaterThan(0)
      expect(getLeagueUiPack(locale).sides.subjectOutcome.achieved.answer.yes('Apple').length).toBeGreaterThan(0)
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
    expect(pt.gateway.submit).not.toBe(en.gateway.submit)
    expect(pt.gateway.placeholder.stocks).not.toBe(en.gateway.placeholder.stocks)
    expect(pt.disclaimer.long).not.toBe(en.disclaimer.long)
    expect(pt.operatorGrade.verifiedLabel).not.toBe(en.operatorGrade.verifiedLabel)
    expect(pt.operatorGrade.gradedOn('7 set 2026')).not.toBe(en.operatorGrade.gradedOn('7 set 2026'))
    expect(pt.sides.subjectOutcome.achieved.badge.yes).toBe('Consegue')
    expect(pt.sides.subjectOutcome.achieved.badge.no).toBe('Não consegue')
    expect(pt.sides.subjectOutcome.achieved.answer.yes('Apple')).toBe('Apple consegue')
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
        hub.openingRound,
        hub.openRoundNote,
        hub.generationQueued,
        hub.generationProgress(12, 41),
        hub.generationComplete(41),
        hub.generationWaitingNote,
        hub.generationFailed,
        hub.generationFailedRefunded,
        hub.retryGeneration,
        hub.generationBusy,
        hub.marketDataUnavailable,
        hub.rateLimited,
        hub.genericError,
        hub.openRound(30),
        hub.insufficientCredits(30, 0),
        hub.balance(120),
        hub.deepOpen(50),
        hub.deepDebate(70),
        hub.deepRunning,
        hub.deepUnscoredNote,
        hub.deepOpenHint,
        hub.deepDebateHint,
        hub.deepOpenTitle,
        hub.deepDebateTitle,
        hub.deepWaitNote,
        hub.deepQueued,
        hub.deepStage('plan'),
        hub.deepStage('analyses'),
        hub.deepStage('synthesis'),
        hub.deepStage('deliberate'),
        hub.deepStage('vote'),
        hub.deepStage('verdict'),
        hub.deepFailed,
        hub.deepFailedRefunded,
        hub.deepBusy,
        hub.deepStepLabels.plan,
        hub.deepStepLabels.briefing,
        hub.deepStepLabels.analyses,
        hub.deepStepLabels.synthesis,
        hub.deepStepLabels.debate,
        hub.deepStepLabels.vote,
        hub.deepStepLabels.verdict,
        hub.deepMinorityHeading,
        hub.deepRoundLabel(1),
        hub.deepConsensusLabel(62),
        hub.deepVoteChoice.approve,
        hub.deepVoteChoice.conditional,
        hub.deepVoteChoice.oppose,
        hub.deepVoteChoice.abstain,
        hub.deepSeatPending,
        hub.deepConcedesLabel,
        hub.deepHoldsLabel,
        getLeagueUiPack(locale).gateway.submit,
        getLeagueUiPack(locale).gateway.retry,
        getLeagueUiPack(locale).gateway.refuseTitle,
        getLeagueUiPack(locale).gateway.placeholder.stocks,
        getLeagueUiPack(locale).gateway.placeholder.sports,
        getLeagueUiPack(locale).gateway.refusal.prompt_not_available,
        getLeagueUiPack(locale).gateway.refusal.registered_country_missing,
        getLeagueUiPack(locale).gateway.refusal.country_mismatch,
        getLeagueUiPack(locale).gating.registeredCountryRequired,
        getLeagueUiPack(locale).gating.countryMismatchNotice,
        getLeagueUiPack(locale).recordRoom.deepCta(15),
        getLeagueUiPack(locale).recordRoom.paidNote,
        getLeagueUiPack(locale).leaderboard.unlockNote,
        getLeagueUiPack(locale).recordRoom.unlockNote(30),
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
      expect(bracket.division.extra.trim().length).toBeGreaterThan(0)
      expect(bracket.showReasoning.trim().length).toBeGreaterThan(0)
      expect(bracket.hideReasoning.trim().length).toBeGreaterThan(0)
      expect(bracket.divinationConfidence.weak.trim().length).toBeGreaterThan(0)
      expect(bracket.divinationConfidence.moderate.trim().length).toBeGreaterThan(0)
      expect(bracket.divinationConfidence.strong.trim().length).toBeGreaterThan(0)
      const tally = bracket.compactTally({ up: 6, down: 4, flat: 0, abstain: 1 })
      expect(tally).toBe('6▲ 4▼ 1–')
      expect(tally).not.toMatch(/\//)
    }
  })

  it('always shows the price inside the paid hub CTA and the 402 message', () => {
    for (const locale of LEAGUE_LOCALES) {
      const hub = getLeagueUiPack(locale).hub
      // A user must be able to read what opening a round costs before spending.
      expect(hub.openRound(30)).toContain('30')
      expect(hub.insufficientCredits(30, 0)).toContain('30')
      // The progress line must carry both the numerator and the roster size.
      expect(hub.generationProgress(12, 41)).toContain('12')
      expect(hub.generationProgress(12, 41)).toContain('41')
      expect(hub.generationComplete(41)).toContain('41')
      expect(hub.deepOpen(50)).toContain('50')
      expect(hub.deepDebate(70)).toContain('70')
      expect(getLeagueUiPack(locale).leaderboard.unlock(2)).toContain('2')
      expect(getLeagueUiPack(locale).recordRoom.unlock(10)).toContain('10')
      expect(getLeagueUiPack(locale).recordRoom.deepCta(15)).toContain('15')
      expect(getLeagueUiPack(locale).recordRoom.exportCsv(15)).toContain('15')
    }
  })

  it('fills in the new leaderboard / archive / verdict chrome for every locale', () => {
    for (const locale of LEAGUE_LOCALES) {
      const pack = getLeagueUiPack(locale)
      expect(pack.leaderboard.methodHeadline.trim().length).toBeGreaterThan(0)
      expect(pack.leaderboard.methodLabels.research.trim().length).toBeGreaterThan(0)
      expect(pack.leaderboard.weightLabels.closed.trim().length).toBeGreaterThan(0)
      expect(pack.leaderboard.weightLabels.open.trim().length).toBeGreaterThan(0)
      expect(pack.leaderboard.tabs.weights.trim().length).toBeGreaterThan(0)
      expect(pack.leaderboard.tabs.korea.trim().length).toBeGreaterThan(0)
      expect(pack.verdict.sectionWeights.trim().length).toBeGreaterThan(0)
      expect(pack.verdict.weightLabels.closed.trim().length).toBeGreaterThan(0)
      expect(pack.verdict.weightLabels.open.trim().length).toBeGreaterThan(0)
      expect(pack.verdict.weightsLine(12, 22, 8, 19)).toContain('\u271312/22')
      expect(pack.verdict.weightsLine(12, 22, 8, 19)).toContain('\u27138/19')
      expect(pack.bracket.combinedTrack('54', 12)).toContain('54')
      expect(pack.bracket.combinedTrack('54', 12)).toContain('12')
      expect(pack.bracket.combinedTrackPending.trim().length).toBeGreaterThan(0)
      expect(pack.recordRoom.paidNote.trim().length).toBeGreaterThan(0)
      expect(pack.leaderboard.unlockNote.trim().length).toBeGreaterThan(0)
      expect(pack.recordRoom.unlockNote(30)).toContain('30')
      expect(pack.headline.correlatedNote.trim().length).toBeGreaterThan(0)
      expect(pack.headline.correlatedNote).toMatch(/41/)
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
      expect(pack.verdict.detailsToggle.trim().length).toBeGreaterThan(0)
      expect(pack.verdict.pendingHeadline('Sep 18')).toContain('Sep 18')
      expect(pack.hero.countLine(41, 30, pack.hero.answerVerb.up, 9, pack.hero.answerVerb.down)).toContain('30')
      expect(pack.hero.countLine(41, 30, pack.hero.answerVerb.up, 9, pack.hero.answerVerb.down)).toContain('41')
      expect(pack.hero.countLine(41, 30, pack.hero.answerVerb.up, 9, pack.hero.answerVerb.down)).not.toMatch(/\d+\/\d+/)
      expect(pack.hero.countLine(41, 30, pack.hero.answerVerb.up, 9, pack.hero.answerVerb.down)).not.toMatch(/[✓✗]/)
      expect(pack.hero.conclusion(pack.hero.answerVerb.up)).toContain(pack.hero.answerVerb.up)
      expect(pack.hero.confidenceNote(58)).toContain('58')
      expect(pack.hero.liveCountLine(6, pack.hero.answerVerb.up, 2, pack.hero.answerVerb.down, 4)).toContain('6')
      expect(pack.hero.liveCountLine(6, pack.hero.answerVerb.up, 2, pack.hero.answerVerb.down, 4)).not.toMatch(/\d+\/\d+/)
      expect(pack.hero.conclusionPending.trim().length).toBeGreaterThan(0)
      expect(pack.predictions.inProgressNote.trim().length).toBeGreaterThan(0)
      expect(pack.verdict.overconfidentLine(65)).toMatch(/65/)
      expect(pack.verdict.overconfidentLine(65)).toMatch(/%/)
      const predLine = pack.predictions.axisLine(
        'US',
        14,
        `${pack.predictions.axisPart(9, pack.direction.tally.up)} · ${pack.predictions.axisPart(5, pack.direction.tally.down)}`,
      )
      expect(predLine).toContain('14')
      expect(predLine).toContain('9')
      expect(predLine).toContain('5')
      expect(predLine).not.toMatch(/\//)
      expect(predLine).not.toMatch(/[✓✗]/)
      expect(pack.predictions.heading.trim().length).toBeGreaterThan(0)
    }
    const ko = getLeagueUiPack('ko')
    expect(ko.gateway.refusal.prompt_not_available).toBe(
      '이 지역에서는 직접 입력으로 이 카테고리 질문을 열 수 없습니다. 아래 종목 칩을 이용해 주세요.',
    )
    expect(ko.gateway.refusal.registered_country_missing).toBe(
      '등록 국가가 없습니다. 계정에 거주 국가를 등록한 뒤에 이용해 주세요.',
    )
    expect(ko.gateway.refusal.country_mismatch).toBe(
      '등록 국가와 접속 국가가 다릅니다. 두 지역 중 더 엄격한 기준을 적용하며, 리그 이용은 가능합니다.',
    )
    expect(ko.hub.marketDataUnavailable).toBe(
      '시세 데이터를 잠시 가져오지 못했습니다. 결제되지 않았습니다. 잠시 후 다시 시도해 주세요.',
    )
    expect(ko.gating.registeredCountryRequired).toBe(
      '거주 국가는 필수입니다. 허위로 등록하면 이용 제한이나 계정 문제가 생길 수 있습니다.',
    )
    expect(ko.verdict.bookLabels.closed).toBe('자체추론')
    expect(ko.verdict.bookLabels.scout).toBe('웹검색')
    expect(ko.hero.countLine(41, 30, '오른다', 9, '내린다')).toBe(
      'AI 41개 중 30개가 오른다 · 9개가 내린다',
    )
    expect(ko.hero.conclusion('오른다')).toBe('종합 결론: 오른다')
    expect(ko.hero.confidenceNote(58)).toBe('가중 확신 58%')
    expect(ko.hero.liveCountLine(6, '오른다', 2, '내린다', 4)).toBe(
      '현재 6개 응답 · 오른다 2 · 내린다 4',
    )
    expect(ko.hero.conclusionPending).toBe('집계 대기 중 · 응답 수집 후 확정')
    expect(ko.predictions.inProgressNote).toBe('집계 중 — 아직 확정되지 않았습니다')
    expect(ko.verdict.pendingHeadline('2026년 9월 18일')).toContain('아직 결과가 나오지 않았어요')
    expect(ko.verdict.detailsToggle).toBe('자세히 보기')
    expect(ko.verdict.weightLabels.closed).toBe('폐쇄형')
    expect(ko.verdict.weightLabels.open).toBe('오픈웨이트')
    expect(ko.verdict.weightsLine(12, 22, 8, 19)).toBe('\u271312/22'.replace(/^/, '폐쇄형 ') + ' \u00b7 오픈웨이트 \u27138/19')
    expect(ko.verdict.bookLabels.closed).not.toMatch(/클로즈드|폐쇄|북/)
    expect(ko.verdict.bookLabels.scout).not.toMatch(/오픈북|오픈웨이트|리서치/)
    expect(ko.leaderboard.methodHeadline).toBe('자체추론 vs 웹검색')
    expect(ko.leaderboard.methodLabels.pure_reasoning).toBe('자체추론')
    expect(ko.leaderboard.methodLabels.research).toBe('웹검색')
  })

  it('does not claim any league view is free', () => {
    const viewingFree = /free|무료|無料|免費|gratuit|gratis|مجاني/
    for (const locale of LEAGUE_LOCALES) {
      const pack = getLeagueUiPack(locale)
      expect(pack.recordRoom.paidNote).not.toMatch(viewingFree)
      expect(pack.leaderboard.unlockNote).not.toMatch(viewingFree)
      expect(pack.recordRoom.unlockNote(30)).not.toMatch(viewingFree)
      expect(pack.hub.openRoundNote).not.toMatch(viewingFree)
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
      expect(pack.header.metalsSpotNote.trim().length).toBeGreaterThan(0)
      expect(pack.hitRate.roundResult(27, 37)).toContain('27')
      expect(pack.hitRate.roundResult(27, 37)).toContain('37')
      expect(pack.modelList.ungraded.trim().length).toBeGreaterThan(0)
      expect(pack.modelList.noResponse.trim().length).toBeGreaterThan(0)
      expect(pack.modelTile.showOriginal.trim().length).toBeGreaterThan(0)
      expect(pack.modelTile.hideOriginal.trim().length).toBeGreaterThan(0)
      expect(pack.modelTile.originalLabel.trim().length).toBeGreaterThan(0)
      expect(pack.modelTile.translating.trim().length).toBeGreaterThan(0)
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

  it('pins the approved hero and deep-button copy in EN and KO', () => {
    const en = getLeagueUiPack('en')
    const ko = getLeagueUiPack('ko')
    expect(en.hero.supportLine('up', 34, 'down', 4, 54)).toBe(
      'Most models called up (34 up · 4 down) · aggregate confidence 54%',
    )
    expect(ko.hero.supportLine('상승', 34, '하락', 4, 54)).toBe(
      '다수가 상승 (34 상승 · 4 하락) · 가중 확신 54%',
    )
    expect(en.hero.divergeLine('rise', 'up', 24, 'down', 16, 'down', 50)).toBe(
      'Most models said rise (24 up · 16 down). The confidence-weighted call is down, at 50%.',
    )
    expect(ko.hero.divergeLine('상승', '상승', 24, '하락', 16, '하락', 50)).toBe(
      '다수는 상승 (24 상승 · 16 하락). 확신 가중 결론은 하락, 50%.',
    )
    expect(en.hero.weightedCallHelp).toBe(
      'The weighted call gives more weight to models that were more confident, so it can differ from a simple head count.',
    )
    expect(ko.hero.weightedCallHelp).toBe(
      '가중 결론은 확신이 높은 모델에 더 큰 비중을 둡니다. 그래서 단순 다수와 달라질 수 있습니다.',
    )
    // Benefit-first pre-purchase copy: lead with what the buyer gets, keep a
    // short unscored disclaimer at the tail (2026-09 rewrite).
    expect(en.hub.deepOpenHint).toBe(
      'The AIs dig deeper into the reasoning behind this call \u2014 each writes its own detailed brief, then everything is merged into one report. For when you want to know why. Unscored commentary.',
    )
    expect(ko.hub.deepOpenHint).toBe(
      'AI들이 이 예측의 근거를 더 깊이 파고들어 각자 상세 분석을 쓰고, 하나의 종합 리포트로 정리합니다. 왜 이런 결론인지 궁금할 때. 비채점 참고 자료입니다.',
    )
    expect(en.hub.deepDebateHint).toBe(
      'The AIs split into pro and con, debate, then vote \u2014 and a chair writes the conclusion plus the minority view. For when you want both sides of the argument. Unscored commentary.',
    )
    expect(ko.hub.deepDebateHint).toBe(
      'AI들을 찬성·반대로 나눠 토론시키고, 투표한 뒤 의장이 결론과 소수 의견까지 정리합니다. 양쪽 논리를 모두 보고 싶을 때. 비채점 참고 자료입니다.',
    )
    for (const locale of LEAGUE_LOCALES) {
      const pack = getLeagueUiPack(locale)
      expect(pack.hero.weightedCallHelp.toLowerCase()).not.toMatch(/log-?odds|logit|inverse/)
      expect(pack.hero.supportLine('a', 1, 'b', 2, 3)).not.toMatch(/\d+\/\d+/)
      expect(pack.hub.deepOpenHint.trim().length).toBeGreaterThan(0)
      expect(pack.hub.deepDebateHint.trim().length).toBeGreaterThan(0)
      if (locale !== 'en') {
        expect(pack.hero.weightedCallHelp).not.toBe(en.hero.weightedCallHelp)
        expect(pack.hub.deepOpenHint).not.toBe(en.hub.deepOpenHint)
        expect(pack.hub.deepDebateHint).not.toBe(en.hub.deepDebateHint)
      }
    }
  })
})
