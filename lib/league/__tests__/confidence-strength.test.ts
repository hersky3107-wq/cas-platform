import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ConsensusHero } from '../../../components/league/ConsensusHero'
import { financeCardSubhead } from '../card-header-copy'
import type { ConsensusSummary } from '../card-types'
import { confidenceBandCounts, strengthBand } from '../confidence-strength'
import { consensusHeadline } from '../compliance'
import { scrubAnalystDisclosure } from '../analyst-disclosure'
import { LEAGUE_LOCALES } from '../i18n/locales'
import { getLeagueUiPack } from '../i18n/dictionary'
import { rejectsBaseRateMistranslation } from '../translation-glossary'

function skSquare(): { consensus: ConsensusSummary; seats: { direction: 'up'; probability: number }[] } {
  const seats = Array.from({ length: 40 }, (_, i) => ({
    direction: 'up' as const,
    probability: 60 + (i % 6),
  }))
  const consensus: ConsensusSummary = {
    tally: { up: 40, down: 0, flat: 0, abstain: 0 },
    majorityDirection: 'up',
    totalModels: 40,
    respondedModels: 40,
    avgProbability: 62.5,
    aggregateDirection: 'up',
    aggregateProbability: 63,
    aggregateMagnitudePct: 1.2,
    aggregateMagnitudeN: 40,
  }
  return { consensus, seats }
}

describe('confidence strength — SK스퀘어 40:0 at 63%', () => {
  it('bands 60–65% seats as weak on the chosen side', () => {
    expect(strengthBand(63)).toBe('near')
    expect(strengthBand(80)).toBe('strong')
    expect(strengthBand(70)).toBe('lead')
    expect(strengthBand(59)).toBe('toss')
    const bands = confidenceBandCounts(skSquare().seats)
    expect(bands).toEqual({ strongA: 0, weakA: 40, weakB: 0, strongB: 0 })
  })

  it('renders the strength headline, a 0/40/0/0 bar, the warning, and a small head count', () => {
    const t = getLeagueUiPack('ko')
    const { consensus, seats } = skSquare()
    const html = renderToStaticMarkup(
      createElement(ConsensusHero, {
        consensus,
        horizon: '1w',
        t,
        seats,
      }),
    )
    expect(html).toContain('상승 우세 63% · 박빙에 가까운 우세')
    expect(html).toContain('data-testid="consensus-strength-headline"')
    expect(html).toContain('data-bands="0,40,0,0"')
    expect(html).toContain('약한 확신의 쏠림 — 박빙일 수 있음')
    expect(html).toContain('각 AI의 확신은 평균 63%입니다. 방향이 모여도 결과가 확실하다는 뜻은 아닙니다.')
    expect(html).toContain('AI 40개 중 40개가 오른다')
    expect(html).toMatch(/text-\[11px\][^"]*" data-testid="consensus-count-line"/)
    expect(html).not.toMatch(/text-xl[^"]*" data-testid="consensus-count-line"/)
    expect(html).not.toContain('압도')
    expect(html).not.toContain('철벽')
    expect(consensusHeadline(consensus, t)).toBe('상승 우세 63% · 박빙에 가까운 우세')
  })

  it('uses a strength headline in every locale and keeps 압도 off a 63% card', () => {
    const { consensus, seats } = skSquare()
    for (const locale of LEAGUE_LOCALES) {
      const t = getLeagueUiPack(locale)
      const html = renderToStaticMarkup(
        createElement(ConsensusHero, { consensus, horizon: '1w', t, seats }),
      )
      const line = consensusHeadline(consensus, t)
      expect(line, locale).toMatch(/63/)
      expect(html, locale).toContain(line)
      expect(html, locale).toContain('data-bands="0,40,0,0"')
      expect(t.hero.strength.strong, locale).not.toMatch(/압도|철벽/)
    }
  })
})

describe('acceptance leftovers — scrub, glossary, finance header', () => {
  it('drops the target-consensus upside sentence', () => {
    const out = scrubAnalystDisclosure('목표주가 컨센서스가 현재가 대비 큰 상방')
    expect(out ?? '').not.toMatch(/목표주가|컨센서스|상방/)
  })

  it('rejects 기준 금리 when the source says base rate', () => {
    expect(rejectsBaseRateMistranslation('The base rate of up weeks is 53%.', '기준 금리는 53%입니다.', 'ko')).toBe(true)
    expect(rejectsBaseRateMistranslation('The base rate of up weeks is 53%.', '기저율(과거 같은 기간 상승 비율)은 53%입니다.', 'ko')).toBe(false)
  })

  it('prints the finance header as name(code) · horizon, never the category id', () => {
    const sub = financeCardSubhead({
      category: 'stock',
      instrument: 'KRSTOCK:KOSPI:402340',
      horizon: '1w',
      subjectLabel: 'SK스퀘어',
      propositionText: 'Will SK스퀘어 (402340) close higher?',
      horizonLabel: '1주',
    })
    expect(sub).toBe('SK스퀘어(402340) · 1주')
    expect(sub).not.toMatch(/\bstock\b|\bfx\b/)
  })
})
