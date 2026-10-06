import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { scrubAnalystDisclosure, scrubsAnalystDisclosure } from '../analyst-disclosure'
import { assembleClosedBookInjection, CONSENSUS_USAGE_RULE, type ClosedBookPacketInput } from '../closed-book-packet'
import { buildConsensusUserPrompt, buildConsensusInput, CONSENSUS_STOCK_MONEY_HINTS } from '../extra/consensus'
import { formatFinanceCrowBrief, overheatingLines } from '../extra/crow'
import { buildSentimentInput, buildSentimentUserPrompt } from '../extra/sentiment'
import {
  equitySearchQuery,
  mentionsLocalNonUsListing,
  stockAugmentationQueries,
} from '../gateway/adapters/stock-catalog'
import { parseSymbolSearchRows, stockUniverseDataEnabled } from '../gateway/adapters/stock-search'
import { mergeExtraQueries } from '../research-director'
import { parseTwelveDataStatistics } from '../stock-statistics-parse'

const ROOT = join(__dirname, '..', '..', '..')

describe('Ultra flag', () => {
  it('is on by default and only off when explicitly disabled', () => {
    const prev = process.env.TWELVE_DATA_STOCK_UNIVERSE
    delete process.env.TWELVE_DATA_STOCK_UNIVERSE
    expect(stockUniverseDataEnabled()).toBe(true)
    for (const v of ['ultra', '1', 'true']) {
      process.env.TWELVE_DATA_STOCK_UNIVERSE = v
      expect(stockUniverseDataEnabled(), v).toBe(true)
    }
    for (const v of ['off', '0', 'false']) {
      process.env.TWELVE_DATA_STOCK_UNIVERSE = v
      expect(stockUniverseDataEnabled(), v).toBe(false)
    }
    if (prev === undefined) delete process.env.TWELVE_DATA_STOCK_UNIVERSE
    else process.env.TWELVE_DATA_STOCK_UNIVERSE = prev
  })
})

describe('/symbol_search rows — US tape + ADRs only', () => {
  it('keeps NYSE/NASDAQ common stock and ADRs, drops local venues and non-equities', () => {
    const r = parseSymbolSearchRows([
      { symbol: 'TSM', instrument_name: 'Taiwan Semiconductor', exchange: 'NYSE', country: 'United States', instrument_type: 'American Depositary Receipt' },
      { symbol: '2330', instrument_name: 'Taiwan Semiconductor', exchange: 'TWSE', country: 'Taiwan', instrument_type: 'Common Stock' },
      { symbol: 'TSMX', instrument_name: 'Some TSM ETF', exchange: 'NASDAQ', country: 'United States', instrument_type: 'ETF' },
    ])
    expect(r.hits.map((h) => `${h.exchange}:${h.symbol}`)).toEqual(['NYSE:TSM'])
    expect(r.nonUsOnly).toBe(false)
    expect(r.koreaOnly).toBe(false)
  })

  it('flags local-only results so the adapter can point at the ADR', () => {
    const r = parseSymbolSearchRows([
      { symbol: '7203', instrument_name: 'Toyota Motor Corp', exchange: 'TSE', country: 'Japan', instrument_type: 'Common Stock' },
    ])
    expect(r.hits).toEqual([])
    expect(r.nonUsOnly).toBe(true)
  })

  it('still sends Korea-only results to the Korea lane', () => {
    const r = parseSymbolSearchRows([
      { symbol: '005930', instrument_name: 'Samsung Electronics', exchange: 'KRX', country: 'South Korea', instrument_type: 'Common Stock' },
    ])
    expect(r.koreaOnly).toBe(true)
    expect(r.nonUsOnly).toBe(false)
  })
})

describe('freeform resolution helpers', () => {
  it('maps Hangul names onto a Latin /symbol_search query', () => {
    expect(equitySearchQuery('마이크로소프트 1주 뒤 오를까')).toBe('MSFT')
    expect(equitySearchQuery('대만반도체')).toBe('TSM')
    expect(equitySearchQuery('Taiwan Semiconductor next week')).toBe('TSM')
    expect(equitySearchQuery('도요타')).toBe('TM')
    expect(equitySearchQuery('Palantir next week')).toBe('Palantir')
    expect(equitySearchQuery('Hon Hai')).toBe('Hon Hai')
    expect(equitySearchQuery('Will AMD close higher by Friday')).toBe('AMD')
    expect(equitySearchQuery('will it close higher')).toBeNull()
  })

  it('detects local non-US codes but leaves US tickers and Korean codes alone', () => {
    for (const raw of ['7203', '0700', '2330.TW', '0700.HK', '7203.T']) expect(mentionsLocalNonUsListing(raw), raw).toBe(true)
    for (const raw of ['TSM', 'NVDA', '005930', 'BRK.B']) expect(mentionsLocalNonUsListing(raw), raw).toBe(false)
  })
})

describe('Perplexity augmentation — every stock round', () => {
  it('seeds news, catalysts, earnings tone, overheating/positioning, Street views, and 수급', () => {
    const qs = stockAugmentationQueries({ instrument: 'STOCK:NYSE:TSM', category: 'stock' })
    expect(qs.length).toBeGreaterThanOrEqual(6)
    const text = qs.map((q) => q.q).join('\n')
    for (const re of [/news and catalysts/, /earnings call/, /upcoming catalysts/, /overbought or oversold/, /upgrades downgrades/, /서학개미/]) {
      expect(text).toMatch(re)
    }
    expect(qs.every((q) => q.q.startsWith('TSM '))).toBe(true)
    expect(qs.find((q) => /서학개미/.test(q.q))?.lang).toBe('ko')
    expect(stockAugmentationQueries({ instrument: 'SPY', category: 'etf_index' })).toEqual([])
  })

  it('merges seeds after the director picks without duplicating', () => {
    const merged = mergeExtraQueries([{ q: 'NVDA latest news and catalysts', lang: 'en' }], [
      { q: 'nvda latest news and catalysts', lang: 'en' },
      { q: 'NVDA earnings', lang: 'en' },
    ])
    expect(merged.map((q) => q.q)).toEqual(['NVDA latest news and catalysts', 'NVDA earnings'])
  })
})

describe('/statistics parse', () => {
  it('reads PE / PB / revenue TTM / market cap from the nested shape', () => {
    const s = parseTwelveDataStatistics({
      statistics: {
        valuations_metrics: { trailing_pe: 52.3, price_to_book_mrq: 41.1, market_capitalization: 4.3e12 },
        financials: { income_statement: { revenue_ttm: 1.65e11 } },
      },
    })
    expect(s).toEqual({ pe: 52.3, pb: 41.1, revenueTtm: 1.65e11, marketCap: 4.3e12 })
    expect('unavailable' in parseTwelveDataStatistics({})).toBe(true)
  })
})

function packetInput(over: Partial<ClosedBookPacketInput> = {}): ClosedBookPacketInput {
  return {
    instrument: 'NVDA',
    category: 'stock',
    horizon: '1d',
    series: Array.from({ length: 30 }, (_, i) => ({ date: `2026-08-${String(i + 1).padStart(2, '0')}`, close: 100 + i })),
    seriesSource: 'Twelve Data /time_series+quote',
    seriesAsOf: '2026-08-30',
    anchorClose: 129,
    anchorSessionDate: '2026-08-30',
    quoteAsOf: '2026-08-30',
    consensus: {
      fetchedAt: '2026-08-30T00:00:00.000Z',
      priceTarget: { high: 250, median: 200, low: 150, average: 201, current: 129, currency: 'USD' },
      recommendations: { strongBuy: 10, buy: 20, hold: 5, sell: 1, strongSell: 0 },
      lastEarnings: { date: '2026-07-30', actual: 1.2, estimate: 1.1, surprisePct: 9.1 },
      latestRating: { date: '2026-08-10', firm: 'Firm', rating: 'Buy' },
      epsTrend: { period: 'current_quarter', currentEstimate: 1.3 },
    },
    crypto: null,
    findings: [],
    researchCacheKey: 'k',
    assembledAt: '2026-08-30T00:00:00.000Z',
    ...over,
  }
}

describe('closed-book packet — volume + statistics are additive', () => {
  it('prints no volume or statistics lines when the inputs lack them (legacy parity)', () => {
    const text = assembleClosedBookInjection(packetInput())
    expect(text).not.toMatch(/session volume|vol \d|statistics:/)
    expect(text).toContain(CONSENSUS_USAGE_RULE)
  })

  it('prints per-bar volume, the 20-session average, and valuation when present', () => {
    const series = Array.from({ length: 30 }, (_, i) => ({
      date: `2026-08-${String(i + 1).padStart(2, '0')}`,
      close: 100 + i,
      volume: i === 29 ? 3_000_000 : 1_000_000,
    }))
    const base = packetInput()
    const text = assembleClosedBookInjection(
      packetInput({
        series,
        consensus: { ...base.consensus!, statistics: { pe: 45.2, pb: null, revenueTtm: 1.3e11, marketCap: null } },
      }),
    )
    expect(text).toMatch(/2026-08-30: 129\.00 {2}vol 3\.0M/)
    expect(text).toMatch(/session volume: last 3\.0M on 2026-08-30; prior 20-session avg 1\.0M \(3\.00x avg\)/)
    expect(text).toMatch(/statistics: trailing PE 45\.2 \/ revenue TTM 130\.00B \(source: Twelve Data \/statistics/)
  })
})

describe('🔴 analyst data stays packet-only', () => {
  it('scrubs vendor attribution and raw analyst figures from stock rationales', () => {
    const raw =
      'Per Twelve Data, the median price target of $315 (source: Twelve Data /price_target) and 25 buy / 3 sell ratings, trailing PE 45.2 and 목표가 315달러 suggest upside; 52w high 212 is close.'
    const out = scrubAnalystDisclosure(raw)!
    expect(out).not.toMatch(/twelve\s*data/i)
    expect(out).not.toMatch(/315|45\.2|25 buy|3 sell/)
    expect(out).toMatch(/price target/)
    expect(out).toMatch(/52w high 212/)
    expect(scrubAnalystDisclosure('hi 400 / median 335 / lo 215 says analysts disagree')).toBe('analyst range says analysts disagree')
    expect(scrubsAnalystDisclosure('stock')).toBe(true)
    expect(scrubsAnalystDisclosure('etf_index')).toBe(true)
    expect(scrubsAnalystDisclosure('gold_metals')).toBe(false)
  })

  it('the orchestrator applies the scrub before writing reasoning_snippet', () => {
    const src = readFileSync(join(ROOT, 'lib/league/orchestrator.ts'), 'utf8')
    const scrubAt = src.indexOf('visibleLeagueText(category, rawRationale)')
    const writeAt = src.indexOf('reasoning_snippet: rationale,')
    expect(scrubAt).toBeGreaterThan(0)
    expect(writeAt).toBeGreaterThan(scrubAt)
  })

  function walk(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const p = join(dir, name)
      if (statSync(p).isDirectory()) return name === '__tests__' ? [] : walk(p)
      return /\.(ts|tsx)$/.test(name) ? [p] : []
    })
  }

  it('no card / UI module reads the packet or analyst fields', () => {
    const files = [
      ...walk(join(ROOT, 'components/league')),
      ...['card.ts', 'card-aggregate.ts', 'card-types.ts', 'verdict-aggregate.ts', 'record-room-csv.ts', 'deep-context.ts'].map((f) =>
        join(ROOT, 'lib/league', f),
      ),
    ]
    const banned = /closed_book_packet|priceTarget|price_target|epsTrend|eps_trend|analyst_ratings|recommendations\.|Twelve Data|fetchMarketConsensus|ConsensusSnapshot/
    for (const f of files) {
      const src = readFileSync(f, 'utf8')
      expect(src.match(banned)?.[0] ?? null, f).toBeNull()
    }
  })
})

describe('extra seats on the Ultra packet', () => {
  it('까마귀 brief carries measured overheating gauges from closes only', () => {
    const closes = Array.from({ length: 260 }, (_, i) => 100 + i * 0.5 + (i > 240 ? (i - 240) * 3 : 0))
    const lines = overheatingLines(closes)
    expect(lines.join('\n')).toMatch(/20-session change/)
    expect(lines.join('\n')).toMatch(/vs SMA50/)
    expect(lines.join('\n')).toMatch(/from 52w high/)
    expect(lines.join('\n')).toMatch(/RSI14: \d+/)
    const brief = formatFinanceCrowBrief({ bars: closes.map((c, i) => ({ date: `d${i}`, close: c })) })
    expect(brief).toMatch(/OVERHEATING GAUGES/)
    expect(brief).not.toMatch(/target|Twelve Data|analyst/i)
  })

  it('consensus seat searches options and market probability, not analyst targets, for stocks', () => {
    const user = buildConsensusUserPrompt(
      buildConsensusInput({
        proposition_text: 'Will TSM close higher by 2026-09-04 than its last close?',
        category: 'stock',
        instrument: 'STOCK:NYSE:TSM',
        horizon: '1w',
        subject_label: 'Taiwan Semiconductor',
        proposition_kind: 'binary_close_higher',
      }),
    )
    expect(user).not.toMatch(/price target consensus/)
    expect(user).toMatch(/시장 신호 없음/)
    expect(user).toMatch(/put-call skew/)
    expect(user).toMatch(/FINRA/)
    expect(user).toMatch(/CBOE equity put\/call/)
    expect(CONSENSUS_STOCK_MONEY_HINTS).toHaveLength(4)
  })

  it('sentiment seat searches stock news + retail buzz, not charts or targets', () => {
    const user = buildSentimentUserPrompt(
      buildSentimentInput({
        proposition_text: 'Will NVDA close higher by 2026-09-04 than its last close?',
        category: 'stock',
        instrument: 'NVDA',
        horizon: '1w',
        subject_label: 'NVDA',
        proposition_kind: 'binary_close_higher',
      }),
    )
    expect(user).toMatch(/company news headlines/)
    expect(user).toMatch(/no analyst targets/)
  })
})
