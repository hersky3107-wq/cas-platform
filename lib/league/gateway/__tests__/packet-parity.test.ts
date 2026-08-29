import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  assembleClosedBookInjection,
  type ClosedBookPacketInput,
  type ConsensusSnapshot,
  type CryptoSnapshot,
  type NonEnglishFinding,
  type RelatedInstrumentStat,
  type SeriesBar,
  type SlowDataSnapshot,
} from '../../closed-book-packet'
import { buildCatalogRankedRoundInput } from '../../catalog'
import { normalizeSessionDate } from '@/lib/prediction/resolution'
import type { DataPacket } from '../../market-data'
import type { ResearchPacket } from '../../research'
import type { RelatedInstrumentsResult } from '../../related-instruments'
import { createStocksAdapter } from '../adapters/stocks'
import type { PriceSeriesIo } from '../adapters/price-series-packet'
import type { NormalizeSlots, PacketBuildEvent, PacketRound } from '../types'

/**
 * BYTE-IDENTITY PROOF for the adapter move (requirement of the CategoryAdapter
 * pass): the stocks adapter's `buildPacket` must assemble EXACTLY the packet
 * text the pre-adapter orchestrator assembled inline, for the same round and
 * the same fetched inputs — a fffc1716/f3752ddd-style catalog round must not
 * change by one byte.
 *
 * THE OLD PATH below (`oldOrchestratorToClosedBookInput` + the injection
 * conditional + the anchor persist point + the result summaries) is a FROZEN
 * VERBATIM COPY of `lib/league/orchestrator.ts` as it stood before this
 * refactor (generatePredictions lines ~843–957 at that commit). Do not
 * "clean it up" — its whole value is that it is the old code.
 */

// ---------------------------------------------------------------------------
// OLD PATH — frozen copy of the pre-adapter orchestrator code.
// ---------------------------------------------------------------------------

/** Frozen copy of `market-data.sessionDateForPrice` (the old path's helper). */
function oldSessionDateForPrice(packet: DataPacket, price: number): string | null {
  const series = packet.series ?? []
  for (let i = series.length - 1; i >= 0; i--) {
    const bar = series[i]
    if (Math.abs(bar.close - price) < 0.005) return normalizeSessionDate(bar.date)
  }
  return null
}

/** Frozen copy of the orchestrator's private `toClosedBookInput`. */
function oldOrchestratorToClosedBookInput(
  round: PacketRound,
  packet: DataPacket,
  research: ResearchPacket,
  consensus: ConsensusSnapshot | null,
  crypto: CryptoSnapshot | null,
  v2?: {
    related?: readonly RelatedInstrumentStat[] | null
    slow?: SlowDataSnapshot | null
  },
): ClosedBookPacketInput {
  const series = packet.series ?? []
  const anchorClose = typeof packet.latestClose === 'number' ? packet.latestClose : null
  const enFindings = research.findings.filter((f) => (f.lang ?? 'en') === 'en')
  const nonEnglishFindings: NonEnglishFinding[] = research.findings
    .filter((f) => f.lang && f.lang !== 'en')
    .map((f) => ({ lang: f.lang!, query: f.query, summary: f.summary }))
  return {
    instrument: round.instrument,
    category: round.category,
    horizon: round.horizon,
    series,
    seriesSource: 'Twelve Data /time_series+quote',
    seriesAsOf: packet.asOf ?? series[series.length - 1]?.date ?? null,
    anchorClose,
    anchorSessionDate: anchorClose != null ? oldSessionDateForPrice(packet, anchorClose) : null,
    quoteAsOf: packet.asOf ?? null,
    consensus,
    crypto,
    findings: enFindings,
    researchCacheKey: research.cacheKey,
    assembledAt: new Date().toISOString(),
    related: v2?.related ?? null,
    slow: v2?.slow ?? null,
    nonEnglishFindings,
    synthesis: research.synthesis,
  }
}

/** Frozen copy of the orchestrator's injection conditional. */
function oldOrchestratorInjection(
  round: PacketRound,
  packet: DataPacket,
  research: ResearchPacket,
  consensus: ConsensusSnapshot | null,
  crypto: CryptoSnapshot | null,
  related: RelatedInstrumentsResult | null,
  slow: SlowDataSnapshot | null,
): string | null {
  return packet.available || research.available
    ? assembleClosedBookInjection(
        oldOrchestratorToClosedBookInput(round, packet, research, consensus, crypto, {
          related: related?.stats ?? null,
          slow,
        }),
      )
    : null
}

// ---------------------------------------------------------------------------
// Shared fixtures — one fixed set of "fetched" inputs for both paths.
// ---------------------------------------------------------------------------

const NOW = new Date('2026-08-28T09:00:00.000Z')

function bars(n: number, start = 200): SeriesBar[] {
  const out: SeriesBar[] = []
  let px = start
  for (let i = 0; i < n; i++) {
    px = px + (i % 2 === 0 ? 1 : -0.4)
    const day = 1 + (i % 28)
    const month = 1 + (Math.floor(i / 28) % 12)
    out.push({
      date: `2025-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
      close: Number(px.toFixed(4)),
    })
  }
  return out
}

const SERIES = bars(120)
const LAST = SERIES[SERIES.length - 1]

const dataPacket: DataPacket = {
  available: true,
  instrument: 'AAPL',
  symbol: 'AAPL',
  currency: 'USD',
  asOf: LAST.date,
  latestClose: LAST.close,
  previousClose: SERIES[SERIES.length - 2].close,
  percentChange: 0.42,
  series: SERIES,
}

const consensus: ConsensusSnapshot = {
  fetchedAt: '2026-08-28T08:59:00.000Z',
  priceTarget: { high: 310, median: 265, low: 210, average: 262.4, current: LAST.close, currency: 'USD' },
  recommendations: { strongBuy: 12, buy: 18, hold: 9, sell: 2, strongSell: 1 },
  lastEarnings: { date: '2026-07-31', actual: 1.62, estimate: 1.55, surprisePct: 4.5 },
  latestRating: { date: '2026-08-20', firm: 'Example Securities', rating: 'Overweight' },
  epsTrend: { period: 'current_quarter', currentEstimate: 1.71 },
}

const research: ResearchPacket = {
  available: true,
  cached: false,
  cacheKey: 'rp_v2|AAPL|1d|high|ko|2026-08-28T06',
  directorModel: 'gemini-3.5-flash',
  queries: ['AAPL price drivers', 'AAPL 최근 뉴스'],
  findings: [
    { query: 'AAPL price drivers', summary: 'AAPL rose 1.2% to $232.10 after supplier orders grew 8%.' },
    {
      lang: 'ko',
      query: 'AAPL 최근 뉴스',
      summary: '"애플 신제품 출하량 증가." EN: Apple new-product shipments increased per Hankyung, 2026-08-26.',
    },
  ],
  promptBlock: 'unused-by-packet',
  costUsd: 0.012345,
  tier: 'high',
  synthesis: 'Anchor 232.10; supplier orders +8%; consensus median 265 above anchor.',
}

const related: RelatedInstrumentsResult = {
  stats: [
    {
      symbol: 'QQQ',
      role: 'index_proxy',
      note: 'Nasdaq-100 proxy',
      lastClose: 512.34,
      lastDate: '2026-08-27',
      move1dPct: -0.85,
      corr: { r: 0.87, n: 20 },
      beta: { beta: 1.12, n: 20 },
      leadLag: [{ lag: 1, r: 0.31, n: 60 }],
    },
  ],
  creditsSpent: 2,
  cacheHits: 1,
}

const slow: SlowDataSnapshot = {
  fetchedAt: '2026-08-28T09:00:00.000Z',
  shortVolume: { date: '2026-08-27', shortShares: 5816998, totalShares: 10250219, shortPct: 56.75 },
  putCall: { date: '2026-08-27', total: 0.73, index: 0.92, equity: 0.62 },
  btcEtfFlow: null,
  insider: {
    windowDays: 90,
    buyTxns: 0,
    buyShares: 0,
    sellTxns: 12,
    sellShares: 1433000,
    netShares: -1433000,
    latestFilingDate: '2026-08-27',
  },
}

function stubIo(calls: string[]): PriceSeriesIo {
  return {
    async fetchDataPacket(instrument) {
      calls.push(`data:${instrument}`)
      return dataPacket
    },
    async fetchMarketConsensus(symbol) {
      calls.push(`consensus:${symbol}`)
      return consensus
    },
    async fetchCryptoContext() {
      throw new Error('fetchCryptoContext must never be called for a stock round')
    },
    async getResearchPacket(args) {
      calls.push(`research:${args.round.instrument}:${args.tier}:${(args.languages ?? []).join('+')}`)
      return research
    },
    async fetchRelatedInstruments(instrument) {
      calls.push(`related:${instrument}`)
      return related
    },
    async fetchSlowData(args) {
      calls.push(`slow:${args.category}:${args.symbol}`)
      return slow
    },
  }
}

const SLOTS: NormalizeSlots = {
  category_id: 'stocks',
  entity_id: 'AAPL',
  entity_kind: 'ticker',
  entity_label: 'AAPL',
  horizon: '1d',
  resolve_by: null,
  proposition_kind: 'binary_close_higher',
  slots: {},
  confidence: 0.95,
}

describe('stocks adapter buildPacket — byte parity with the pre-adapter orchestrator path', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('the catalog chip round seed and the adapter-composed round are identical', () => {
    const chipRound = buildCatalogRankedRoundInput('AAPL', '1d', NOW)
    const adapter = createStocksAdapter(stubIo([]))
    const composed = adapter.composeProposition(SLOTS, NOW)
    expect(chipRound).not.toBeNull()
    expect(composed).toEqual(chipRound)
  })

  it('assembles a byte-identical closed-book packet for the same round and fetched inputs', async () => {
    const chipRound = buildCatalogRankedRoundInput('AAPL', '1d', NOW)!
    const round: PacketRound = { id: 'round-parity-1', ...chipRound }

    // OLD PATH — the frozen orchestrator code on the fixed inputs.
    const oldText = oldOrchestratorInjection(round, dataPacket, research, consensus, null, related, slow)

    // ADAPTER PATH — the real buildPacket with the same inputs behind stub io.
    const calls: string[] = []
    const events: PacketBuildEvent[] = []
    const adapter = createStocksAdapter(stubIo(calls))
    const pkt = await adapter.buildPacket(SLOTS, {
      round,
      costCapUsd: 20,
      onEvent: (e) => {
        events.push(e)
      },
    })

    expect(oldText).not.toBeNull()
    expect(oldText).toContain('AAPL')
    // THE assertion: exact same closed-book text, byte for byte.
    expect(pkt.injection).toBe(oldText)

    // The audit cache key is the research packet's, as before.
    expect(pkt.researchCacheKey).toBe(research.cacheKey)

    // Anchor event carries exactly what the old inline code persisted
    // (latestClose + the bar-matched session date), at the pre-consensus point.
    expect(events).toEqual([
      { kind: 'anchor_price', price: LAST.close, sessionDate: oldSessionDateForPrice(dataPacket, LAST.close) },
    ])
    expect(calls[0]).toBe('data:AAPL')
    expect(calls).toContain('consensus:AAPL')

    // GenerateResult summary fields match the old inline computation.
    expect(pkt.dataPacket).toEqual({
      available: true,
      symbol: 'AAPL',
      latestClose: LAST.close,
      error: undefined,
    })
    expect(pkt.research).toEqual({
      available: true,
      cached: false,
      costUsd: Number(research.costUsd.toFixed(6)),
      queries: research.queries,
      tier: 'high',
      tierSignal: expect.any(String),
      error: undefined,
    })
    expect(pkt.researchCostUsd).toBe(research.costUsd)
    expect(pkt.relatedCreditsSpent).toBe(2)
  })

  it('returns a null injection when neither market data nor research is available (as before)', async () => {
    const adapter = createStocksAdapter({
      ...stubIo([]),
      async fetchDataPacket(instrument) {
        return { available: false, instrument, error: 'no usable price data returned' }
      },
      async getResearchPacket() {
        return { ...research, available: false, findings: [], synthesis: null, costUsd: 0, cached: false }
      },
    })
    const chipRound = buildCatalogRankedRoundInput('AAPL', '1d', NOW)!
    const pkt = await adapter.buildPacket(SLOTS, { round: { id: 'r2', ...chipRound }, costCapUsd: 20 })
    expect(pkt.injection).toBeNull()
    expect(pkt.dataPacket.available).toBe(false)
  })
})
