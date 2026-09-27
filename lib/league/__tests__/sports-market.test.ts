import { describe, expect, it } from 'vitest'
import { emptyTally } from '../card-types'
import {
  buildSportsMarketView,
  fractureFromAgreement,
  SPORTS_UI_BANNED_RE,
} from '../sports-market'
import { getLeagueUiPack } from '../i18n/dictionary'
import { LEAGUE_LOCALES } from '../i18n/locales'
import { consensusMoneySearchHints } from '../extra/consensus'
import { buildHistorySystemPrompt, historyRationaleNeedsRetry } from '../extra/history'

function consensus(over: { up: number; down: number; p: number; dir: 'yes' | 'no' }) {
  return {
    tally: { ...emptyTally(), up: over.up, down: over.down },
    majorityDirection: over.dir,
    totalModels: over.up + over.down,
    respondedModels: over.up + over.down,
    avgProbability: over.p,
    aggregateDirection: over.dir,
    aggregateProbability: over.p,
    aggregateMagnitudePct: null,
    aggregateMagnitudeN: 0,
  }
}

describe('sports market dual-display', () => {
  it('computes ensemble vs baseline divergence and fracture labels', () => {
    const iron = buildSportsMarketView({
      consensus: consensus({ up: 36, down: 4, p: 78, dir: 'yes' }),
      marketBaselinePct: 70,
    })
    expect(iron.ensembleWinPct).toBe(78)
    expect(iron.marketBaselinePct).toBe(70)
    expect(iron.divergencePp).toBe(8)
    expect(iron.agreementPct).toBe(90)
    expect(iron.fracture).toBe('iron')
    expect(fractureFromAgreement(50)).toBe('warn')
    expect(fractureFromAgreement(70)).toBe('none')
  })

  it('sports UI copy never uses 토토/배당/핸디캡/픽/베팅', () => {
    for (const locale of LEAGUE_LOCALES) {
      const pack = getLeagueUiPack(locale)
      const blob = [
        pack.sportsMarket.ensembleLabel,
        pack.sportsMarket.marketBaselineLabel,
        pack.sportsMarket.divergenceLabel('+3'),
        pack.sportsMarket.fractureIron,
        pack.sportsMarket.fractureWarn,
        pack.sportsMarket.agreement('90'),
        pack.sportsMarket.consensusSeat,
        pack.sportsMarket.disclaimer,
        pack.disclaimer.sports,
      ].join('\n')
      expect(blob).not.toMatch(SPORTS_UI_BANNED_RE)
    }
  })
})

describe('sports extra-seat redefinition', () => {
  it('consensus seat searches the market baseline, not chart or 배당 language', () => {
    const hints = consensusMoneySearchHints('sports')
    expect(hints).toMatch(/시장 기준선|Pinnacle/)
    expect(hints).toMatch(/NEVER write/)
    expect(hints).not.toMatch(/Polymarket/)
  })

  it('history seat uses H2H + form, not chart patterns', () => {
    const system = buildHistorySystemPrompt('sports')
    expect(system).toContain('맞대결')
    expect(system).toContain('최근 폼')
    expect(system).not.toContain('엘리어트 파동')
    expect(historyRationaleNeedsRetry('맞대결 전적에서 앞선다', 'sports')).toBe(false)
    expect(historyRationaleNeedsRetry('쌍바닥 넥라인 돌파', 'sports')).toBe(true)
  })
})
