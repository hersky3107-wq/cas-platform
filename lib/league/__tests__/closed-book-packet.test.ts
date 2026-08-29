import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  assembleClosedBookInjection,
  computeBaseRate,
  estimatePacketTokens,
  hasNumericFact,
  isAbsenceFinding,
  selectProseFindings,
  SERIES_OUTPUT_SIZE,
  type ClosedBookPacketInput,
  type ConsensusSnapshot,
  type SeriesBar,
} from '../closed-book-packet'
import { sessionsForHorizon } from '../horizon'

function bars(n: number, start = 100): SeriesBar[] {
  const out: SeriesBar[] = []
  let px = start
  for (let i = 0; i < n; i++) {
    // Deterministic walk: up on even i so 1d base rate is ~50%.
    px = px + (i % 2 === 0 ? 1 : -0.4)
    const day = 10 + (i % 18)
    const month = 1 + Math.floor(i / 18) % 12
    out.push({
      date: `2024-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
      close: Number(px.toFixed(4)),
    })
  }
  return out
}

const consensus: ConsensusSnapshot = {
  fetchedAt: '2026-08-24T12:00:00.000Z',
  priceTarget: { high: 400, median: 335, low: 215, average: 324.45, current: 309.42, currency: 'USD' },
  recommendations: { strongBuy: 6, buy: 19, hold: 14, sell: 3, strongSell: 2 },
  lastEarnings: { date: '2026-07-30', actual: 2.02, estimate: 1.89, surprisePct: 6.88 },
  latestRating: { date: '2026-08-10', firm: 'Jefferies', rating: 'Underperform' },
  epsTrend: { period: 'current_quarter', currentEstimate: 1.97656 },
}

const findings = [
  {
    query: 'price',
    summary: 'AAPL last traded at $309.35 with prior close $309.35 on Aug 21, 2026.',
  },
  {
    query: 'macro',
    summary:
      'several calendars show no major releases scheduled on Monday, Aug 24, 2026. Chicago Fed prior -0.02, consensus 0.10.',
  },
  {
    query: 'analysts',
    summary: 'Jefferies $263.66 sell vs Rothschild $400 buy; consensus clustered around $330.',
  },
]

function input(over: Partial<ClosedBookPacketInput> = {}): ClosedBookPacketInput {
  const series = over.series ?? bars(1083, 200)
  const last = series[series.length - 1]
  return {
    instrument: 'AAPL',
    category: 'stock',
    horizon: '1d',
    series,
    seriesSource: 'Twelve Data /time_series+quote',
    seriesAsOf: last.date,
    anchorClose: last.close,
    anchorSessionDate: last.date,
    quoteAsOf: last.date,
    consensus,
    crypto: null,
    findings,
    researchCacheKey: 'rp_v1|AAPL|1d|2026-08-24T06',
    assembledAt: '2026-08-24T12:00:00.000Z',
    ...over,
  }
}

describe('closed-book packet — numbers first', () => {
  it('uses outputsize 1083 (1000 lookback + 63 3m sessions + 20) — 1 TD credit', () => {
    expect(SERIES_OUTPUT_SIZE).toBe(1083)
  })

  it('base rate is per-horizon: 1d and 3m are not the same number', () => {
    const series = bars(1083, 200)
    const d1 = computeBaseRate(series, sessionsForHorizon('stock', '1d'), 1000, '1d')
    const m3 = computeBaseRate(series, sessionsForHorizon('stock', '3m'), 1000, '3m')
    expect(d1).not.toBeNull()
    expect(m3).not.toBeNull()
    expect(d1!.sessionsAhead).toBe(1)
    expect(m3!.sessionsAhead).toBe(63)
    expect(d1!.n).toBe(1000)
    expect(m3!.n).toBe(1000)
    expect(d1!.upPct).not.toBe(m3!.upPct)
  })

  it('drops absence-of-news findings and keeps numeric ones, capped at 2', () => {
    expect(isAbsenceFinding(findings[1].summary)).toBe(true)
    expect(hasNumericFact(findings[0].summary)).toBe(true)
    // No numeric-block context → restatement filter is inert; both numeric findings keep.
    const kept = selectProseFindings(findings, '')
    expect(kept.map((f) => f.query)).toEqual(['price', 'analysts'])
    expect(kept).toHaveLength(2)
  })

  it('drops findings that only restate numbers already in the numeric blocks', () => {
    const numeric = 'ANCHOR CLOSE: 309.35 on 2026-08-21\nLast close 309.35'
    const kept = selectProseFindings(
      [
        { query: 'price', summary: 'AAPL last traded at $309.35 with prior close $309.35.' },
        {
          query: 'flow',
          summary: 'After-hours volume hit 5.01M with a +0.11% print not present in the series blocks.',
        },
      ],
      numeric,
    )
    expect(kept.map((f) => f.query)).toEqual(['flow'])
  })

  it('trims prose at a sentence boundary instead of mid-word', () => {
    const long =
      'First sentence ends here with a 12.5 print. Second sentence keeps going with filler words that push past the character budget so the cut must land on a period rather than slicing a word in half midstream forever and ever and ever and still more filler text after that.'
    const [kept] = selectProseFindings([{ query: 'q', summary: long }], '')
    expect(kept).toBeDefined()
    expect(kept.summary.endsWith('.')).toBe(true)
    expect(kept.summary.length).toBeLessThanOrEqual(400)
    expect(kept.summary).toContain('First sentence')
  })

  it('omits the PROSE FINDINGS section entirely when nothing is kept', () => {
    const text = assembleClosedBookInjection(
      input({
        findings: [
          {
            query: 'macro',
            summary: 'several calendars show no major releases scheduled on Monday.',
          },
        ],
      }),
    )
    expect(text).not.toMatch(/PROSE FINDINGS/)
  })

  it('failed fields are labeled UNAVAILABLE, never omitted', () => {
    const text = assembleClosedBookInjection(
      input({
        consensus: {
          fetchedAt: '2026-08-24T12:00:00.000Z',
          priceTarget: { unavailable: 'Twelve Data /price_target: HTTP 429' },
          recommendations: { unavailable: 'Twelve Data /recommendations: HTTP 429' },
          lastEarnings: { unavailable: 'Twelve Data /earnings: HTTP 429' },
          latestRating: { unavailable: 'Twelve Data /analyst_ratings/light: HTTP 429' },
          epsTrend: { unavailable: 'Twelve Data /eps_trend: HTTP 429' },
        },
        category: 'crypto_spot',
        instrument: 'BTC/USD',
        crypto: {
          fetchedAt: '2026-08-24T12:00:00.000Z',
          funding: { unavailable: 'Binance /fapi/v1/premiumIndex: HTTP 500' },
          openInterest: { unavailable: 'Binance /fapi/v1/openInterest: timeout' },
          markIv: { unavailable: 'Deribit book_summary: no mark_iv' },
        },
      }),
    )
    expect(text).toMatch(/price target: UNAVAILABLE/)
    expect(text).toMatch(/funding: UNAVAILABLE/)
    expect(text).toMatch(/open interest: UNAVAILABLE/)
    expect(text).toMatch(/mark_iv: UNAVAILABLE/)
    expect(text).not.toMatch(/funding: \d/)
  })

  it('presents analyst dispersion as range + median + % of price, not a single target', () => {
    const text = assembleClosedBookInjection(input())
    expect(text).toMatch(/hi 400\.00 \/ median 335\.00 \/ lo 215\.00/)
    expect(text).toMatch(/analysts disagree/)
    expect(text).toMatch(/% of last close/)
    expect(text.indexOf('NUMERIC MARKET')).toBeLessThan(text.indexOf('PROSE FINDINGS'))
    expect(text.indexOf('BASE RATE')).toBeLessThan(text.indexOf('PROSE FINDINGS'))
    expect(text.indexOf('CONSENSUS')).toBeLessThan(text.indexOf('PROSE FINDINGS'))
  })

  it('a graded round can reproduce the exact text its closed-book models received', () => {
    const first = assembleClosedBookInjection(input())
    // Persist-equivalent: store the assembled string, then re-assemble from the
    // same frozen inputs (the snapshot on the round row IS the reproduction).
    const stored = first
    const reproduced = assembleClosedBookInjection(input())
    expect(reproduced).toBe(stored)
    expect(stored).toContain('ANCHOR CLOSE (grading baseline')
    expect(stored).toContain('over the last 1000 sessions')
  })

  it('prints token count of a representative AAPL 1d packet', () => {
    const text = assembleClosedBookInjection(input())
    const tokens = estimatePacketTokens(text)
    // eslint-disable-next-line no-console
    console.log(
      `\n=== closed-book packet tokens ===\nchars=${text.length} tokens≈${tokens}  34x@0.92/MTok≈$${(
        (tokens * 34 * 0.92) /
        1_000_000
      ).toFixed(4)}\n`,
    )
    expect(tokens).toBeGreaterThan(200)
    expect(tokens).toBeLessThan(2500)
  })
})

describe('base rate stays packet-internal — never on user-facing surfaces', () => {
  it('card ROUND_COLUMNS do not select closed_book_packet_* (so the snapshot never reaches the card JSON)', () => {
    const cardSrc = readFileSync(join(__dirname, '../card.ts'), 'utf8')
    const colsMatch = cardSrc.match(/const ROUND_COLUMNS =\s*'([^']+)'/)
    expect(colsMatch).not.toBeNull()
    expect(colsMatch![1]).not.toMatch(/closed_book/)
  })

  it('record-room CSV and deep-context never mention BASE RATE / computeBaseRate / closed_book_packet', () => {
    for (const rel of ['../record-room-csv.ts', '../deep-context.ts', '../card-aggregate.ts', '../verdict-aggregate.ts']) {
      const src = readFileSync(join(__dirname, rel), 'utf8')
      expect(src, rel).not.toMatch(/BASE RATE|computeBaseRate|closed_book_packet|upPct.*lookback|historical frequency/i)
    }
  })
})

describe('orchestrator writes the snapshot BEFORE model calls', () => {
  it('persistClosedBookPacket is invoked after assemble and before runOneModel', () => {
    const src = readFileSync(join(__dirname, '../orchestrator.ts'), 'utf8')
    const persistAt = src.indexOf('await persistClosedBookPacket(')
    const promptsAt = src.indexOf('const prompts = buildRoundPrompts(')
    const runAt = src.indexOf('await runOneModel(')
    expect(persistAt).toBeGreaterThan(0)
    expect(promptsAt).toBeGreaterThan(persistAt)
    expect(runAt).toBeGreaterThan(promptsAt)
  })
})
