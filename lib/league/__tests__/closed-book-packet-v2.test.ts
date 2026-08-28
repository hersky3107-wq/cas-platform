import { describe, expect, it } from 'vitest'
import {
  assembleClosedBookInjection,
  type ClosedBookPacketInput,
  type RelatedInstrumentStat,
  type SeriesBar,
  type SlowDataSnapshot,
} from '../closed-book-packet'

function bars(n: number, start = 100): SeriesBar[] {
  const out: SeriesBar[] = []
  let px = start
  for (let i = 0; i < n; i++) {
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

const related: RelatedInstrumentStat[] = [
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
  { symbol: 'USD/CNH', role: 'fx', note: 'offshore yuan', unavailable: 'TwelveData error 404: symbol not on plan' },
]

const slow: SlowDataSnapshot = {
  fetchedAt: '2026-08-28T09:00:00.000Z',
  shortVolume: { date: '2026-08-27', shortShares: 5816998, totalShares: 10250219, shortPct: 56.75 },
  putCall: { date: '2026-08-27', total: 0.73, index: 0.92, equity: 0.62 },
  btcEtfFlow: { unavailable: 'Farside farside.co.uk/btc: HTTP 403 (Cloudflare-blocked at probe time 2026-08-28)' },
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

function input(over: Partial<ClosedBookPacketInput> = {}): ClosedBookPacketInput {
  const series = over.series ?? bars(300, 200)
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
    consensus: null,
    crypto: null,
    findings: [
      { query: 'price drivers', summary: 'AAPL rose 1.2% to $232.10 after supplier orders grew 8%.' },
    ],
    researchCacheKey: 'rp_v2|AAPL|1d|high|zh|2026-08-28T06',
    assembledAt: '2026-08-28T09:00:00.000Z',
    related,
    slow,
    nonEnglishFindings: [
      { lang: 'zh', query: '苹果公司 最新 供应链 消息', summary: '"富士康8月出货量增长12%。" EN: Foxconn August shipments grew 12% per Caixin, 2026-08-26.' },
    ],
    synthesis: null,
    ...over,
  }
}

describe('closed-book packet v2 — new sections', () => {
  it('renders RELATED INSTRUMENTS with corr/beta/lead-lag numbers and n', () => {
    const text = assembleClosedBookInjection(input())
    expect(text).toContain('RELATED INSTRUMENTS')
    expect(text).toContain('QQQ [index_proxy — Nasdaq-100 proxy]')
    expect(text).toContain('corr20 +0.87 (n=20)')
    expect(text).toContain('beta20 +1.12 (n=20)')
    expect(text).toContain('t-1 r=+0.31 (n=60)')
  })

  it('a failed related fetch is an UNAVAILABLE line, never dropped', () => {
    const text = assembleClosedBookInjection(input())
    expect(text).toMatch(/USD\/CNH \[fx — offshore yuan\]: UNAVAILABLE/)
  })

  it('renders SLOW PUBLIC DATA with source + informative-horizon labels', () => {
    const text = assembleClosedBookInjection(input())
    expect(text).toContain('SLOW PUBLIC DATA')
    expect(text).toContain('56.8% short-volume ratio')
    expect(text).toContain('FINRA CNMS daily file; informative horizon: days-weeks')
    expect(text).toContain('put/call ratios (2026-08-27): total 0.73 / index 0.92 / equity 0.62')
    expect(text).toContain('informative horizon: weeks-months — weak for 1d')
    expect(text).toMatch(/BTC spot ETF flows: UNAVAILABLE/)
  })

  it('slow-data fields that are null (not applicable) are omitted, not UNAVAILABLE', () => {
    const text = assembleClosedBookInjection(
      input({ slow: { ...slow, btcEtfFlow: null, insider: null } }),
    )
    expect(text).not.toContain('BTC spot ETF')
    expect(text).not.toContain('insider Form 4')
    expect(text).toContain('short-sale volume')
  })

  it('renders NON-ENGLISH FINDINGS with lang tag, original text and EN gloss', () => {
    const text = assembleClosedBookInjection(input())
    expect(text).toContain('NON-ENGLISH FINDINGS')
    expect(text).toContain('[zh] 苹果公司 最新 供应链 消息')
    expect(text).toContain('EN: Foxconn August shipments grew 12%')
  })

  it('synthesis REPLACES prose findings; absent synthesis keeps them', () => {
    const withSynthesis = assembleClosedBookInjection(
      input({ synthesis: 'Foxconn Aug shipments — +12% — Caixin — 2026-08-26' }),
    )
    expect(withSynthesis).toContain('RESEARCH SYNTHESIS')
    expect(withSynthesis).not.toContain('PROSE FINDINGS')

    const withoutSynthesis = assembleClosedBookInjection(input())
    expect(withoutSynthesis).not.toContain('RESEARCH SYNTHESIS')
    expect(withoutSynthesis).toContain('PROSE FINDINGS')
  })

  it('v1-shaped input (no v2 fields) renders no v2 sections — backward compatible', () => {
    const text = assembleClosedBookInjection(
      input({ related: null, slow: null, nonEnglishFindings: [], synthesis: null }),
    )
    expect(text).not.toContain('RELATED INSTRUMENTS')
    expect(text).not.toContain('SLOW PUBLIC DATA')
    expect(text).not.toContain('NON-ENGLISH FINDINGS')
  })

  it('section order: numeric blocks, RELATED, SLOW, NON-ENGLISH, then research text', () => {
    const text = assembleClosedBookInjection(input({ synthesis: 'x — 1 — src — 2026-08-28' }))
    const idx = (s: string) => text.indexOf(s)
    expect(idx('NUMERIC MARKET')).toBeLessThan(idx('RELATED INSTRUMENTS'))
    expect(idx('RELATED INSTRUMENTS')).toBeLessThan(idx('SLOW PUBLIC DATA'))
    expect(idx('SLOW PUBLIC DATA')).toBeLessThan(idx('NON-ENGLISH FINDINGS'))
    expect(idx('NON-ENGLISH FINDINGS')).toBeLessThan(idx('RESEARCH SYNTHESIS'))
  })

  it('write-once audit trail: same frozen inputs reproduce the byte-identical v2 packet', () => {
    const first = assembleClosedBookInjection(input())
    const reproduced = assembleClosedBookInjection(input())
    expect(reproduced).toBe(first)
  })
})
