import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { assembleClosedBookInjection } from '../closed-book-packet'
import { toClosedBookInput } from '../gateway/adapters/price-series-packet'
import { createStocksAdapter } from '../gateway/adapters/stocks'
import type { PriceSeriesIo } from '../gateway/adapters/price-series-packet'
import { gradePlanFor } from '../gateway/grade-plan'
import { krStockPropositionDisplay, krStockPropositionEn } from '../korea-stock-display'
import { krxBarsToDataPacket, KRSTOCK_PACKET_SERIES_SOURCE } from '../korea-stock-packet'
import { reconcileTwelfthDataAnchor } from '../korea-stock-reconcile'
import { resolveKrxGradingSession, isKrxTradingDay, krxSessionCloseIso } from '../krx-calendar'
import { resolveRoundOutcome } from '../../prediction/resolution'
import { rankedPropositionDisplay } from '../card-header-copy'

const KR = 'KRSTOCK:KOSPI:005930'

describe('KRSTOCK proposition', () => {
  it('English names KRX regular-session close on both dates; Korean display says KRX 정규장 종가 기준', () => {
    const en = krStockPropositionEn({
      name: '삼성전자',
      code: '005930',
      resolveDate: '2026-10-06',
      anchorDate: '2026-10-02',
    })
    expect(en).toBe(
      'Will 삼성전자 (005930) close higher at the KRX regular-session close on 2026-10-06 than at its KRX regular-session close on 2026-10-02?',
    )
    const ko = krStockPropositionDisplay(KR, en, 'ko')
    expect(ko).toContain('KRX 정규장 종가 기준')
    expect(ko).toContain('삼성전자')
    expect(ko).toContain('005930')
    expect(rankedPropositionDisplay(KR, en, 'ko')).toBe(ko)
    expect(rankedPropositionDisplay(KR, en, 'en')).toBe(en)
  })
})

describe('KRSTOCK Twelve Data anchor reconciliation', () => {
  it('equal official close verifies; a mismatch parks for admin review and does not rewrite', () => {
    expect(
      reconcileTwelfthDataAnchor({
        anchorSource: 'twelvedata',
        storedAnchor: 71400,
        official: 71400,
      }),
    ).toEqual({ action: 'verify' })
    expect(
      reconcileTwelfthDataAnchor({
        anchorSource: 'twelvedata',
        storedAnchor: 71400,
        official: 71500,
      }),
    ).toEqual({ action: 'park_manual', official: 71500, stored: 71400 })
  })

  it('waits when official KRX is unpublished and noops when already official', () => {
    expect(
      reconcileTwelfthDataAnchor({
        anchorSource: 'twelvedata',
        storedAnchor: 71400,
        official: 'not_published',
      }),
    ).toEqual({ action: 'wait' })
    expect(
      reconcileTwelfthDataAnchor({
        anchorSource: 'krx_official',
        storedAnchor: 71400,
        official: 71500,
      }),
    ).toEqual({ action: 'noop' })
  })
})

describe('KRSTOCK grading uses official KRX close and 15:30 KST session math', () => {
  it('selects the resolve-session official close, not a Twelve Data bar', () => {
    const result = resolveRoundOutcome({
      instrument: KR,
      anchorPrice: 70000,
      anchorPriceAt: krxSessionCloseIso('2026-10-02'),
      resolvesAt: krxSessionCloseIso('2026-10-06'),
      series: {
        ok: true,
        bars: [
          { sessionDate: '2026-10-02', close: 70000 },
          { sessionDate: '2026-10-06', close: 71400 },
        ],
      },
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.outcome.resolutionSessionDate).toBe('2026-10-06')
      expect(result.outcome.resolutionPrice).toBe(71400)
      expect(result.outcome.actualDirection).toBe('up')
    }
  })

  it('holiday resolve date falls back to resolveKrxGradingSession (previous session)', () => {
    expect(resolveKrxGradingSession('2026-10-09', isKrxTradingDay)).toBe('2026-10-08')
    const result = resolveRoundOutcome({
      instrument: KR,
      anchorPrice: 70000,
      anchorPriceAt: krxSessionCloseIso('2026-10-06'),
      resolvesAt: krxSessionCloseIso('2026-10-09'),
      series: {
        ok: true,
        bars: [
          { sessionDate: '2026-10-06', close: 70000 },
          { sessionDate: '2026-10-08', close: 71000 },
        ],
      },
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.outcome.resolutionSessionDate).toBe('2026-10-08')
      expect(result.outcome.resolutionPrice).toBe(71000)
    }
  })

  it('unpublished resolve session stays ungraded', () => {
    const result = resolveRoundOutcome({
      instrument: KR,
      anchorPrice: 70000,
      anchorPriceAt: krxSessionCloseIso('2026-10-02'),
      resolvesAt: krxSessionCloseIso('2026-10-06'),
      series: { ok: true, bars: [{ sessionDate: '2026-10-02', close: 70000 }] },
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('no_session_in_window')
  })
})

describe('KRSTOCK packet uses KRX series and shared calculators', () => {
  it('maps 60 official bars oldest→newest into SMA50 via the STOCK packet path', () => {
    const bars = Array.from({ length: 60 }, (_, i) => ({
      date: `2026-07-${String((i % 28) + 1).padStart(2, '0')}`,
      close: 70000 + i * 10,
      volume: 1000 + i,
    }))
    const packet = krxBarsToDataPacket(KR, bars)
    expect(packet.available).toBe(true)
    expect(packet.series).toHaveLength(60)
    expect(packet.series?.[0]?.close).toBe(70000)
    expect(packet.series?.[59]?.close).toBe(70000 + 59 * 10)
    expect(packet.seriesSource).toBe(KRSTOCK_PACKET_SERIES_SOURCE)

    const injection = assembleClosedBookInjection(
      toClosedBookInput(
        {
          proposition_text: 'x',
          category: 'stock',
          instrument: KR,
          horizon: '1d',
          resolution_rule: 'KRX',
          resolves_at: krxSessionCloseIso('2026-10-06'),
        },
        packet,
        {
          available: false,
          cached: false,
          costUsd: 0,
          queries: [],
          findings: [],
          cacheKey: 'test',
          tier: 'tight',
          directorModel: null,
          promptBlock: '',
          synthesis: null,
        },
        null,
        null,
      ),
    )
    expect(injection).toContain('SMA50:')
    expect(injection).toContain(KRSTOCK_PACKET_SERIES_SOURCE)
  })

  it('stocks adapter grades KRSTOCK from krx_official, not Twelve Data', () => {
    const deadIo: PriceSeriesIo = {
      fetchDataPacket: async () => {
        throw new Error('td packet must not be called')
      },
      fetchMarketConsensus: async () => {
        throw new Error('td consensus must not be called')
      },
      fetchCryptoContext: async () => {
        throw new Error('crypto must not be called')
      },
      getResearchPacket: async () => {
        throw new Error('research must not be called')
      },
      fetchRelatedInstruments: async () => {
        throw new Error('related must not be called')
      },
      fetchSlowData: async () => {
        throw new Error('slow must not be called')
      },
    }
    const adapter = createStocksAdapter(deadIo)
    const plan = gradePlanFor(adapter, KR)
    expect(plan).toMatchObject({ source: 'price_series' })
    if (plan.source === 'price_series' && plan.tier1 !== 'legacy') {
      expect(plan.tier1.kind).toBe('krx_official')
    }
  })

  it('KRSTOCK packet path reuses buildPriceSeriesPacket and long-window KRX sessions', () => {
    const src = readFileSync(join(__dirname, '../gateway/adapters/stocks.ts'), 'utf8')
    expect(src).toContain('getKrxCloseSeries(kr.market, kr.code, KRX_SERIES_LOOKBACK_SESSIONS)')
    expect(src).toContain('buildPriceSeriesPacket(ctx, krIo)')
    expect(src).toContain('krStockAugmentationQueries')
  })
})
