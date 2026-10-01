import { describe, expect, it } from 'vitest'
import {
  assembleClosedBookInjection,
  type ClosedBookPacketInput,
  type CotPositioning,
  type SeriesBar,
} from '../closed-book-packet'
import {
  BOTH_SIDES_HEADER,
  CROWDING_HEADER,
  computeCrowding,
  extractCrowdingBlock,
  formatCrowding,
} from '../crowding'
import { buildCrowSystemPrompt, formatFinanceCrowBrief, withCrowdingBlock } from '../extra/crow'
import { entertainmentSearchQueries } from '../gateway/adapters/entertainment-packet'
import { decodeEntertainmentInstrument } from '../gateway/adapters/entertainment-catalog'
import { formatPoliticsBothSides } from '../gateway/adapters/politics-packet'

function series(closes: number[], volumes?: number[]): SeriesBar[] {
  return closes.map((close, i) => ({
    date: new Date(Date.UTC(2026, 0, 1) + i * 86_400_000).toISOString().slice(0, 10),
    close,
    ...(volumes ? { volume: volumes[i] } : {}),
  }))
}

/** Gentle zig-zag, flat on net — no extremes. */
function flat(n: number, base = 100): number[] {
  return Array.from({ length: n }, (_, i) => base + (i % 2 === 0 ? 0.5 : -0.5))
}

/** Flat base then a steep, nearly one-way 20-session run. */
function meltUp(): number[] {
  const out = flat(60)
  let px = out[out.length - 1]!
  for (let i = 0; i < 20; i++) {
    px *= i % 5 === 4 ? 0.995 : 1.025
    out.push(Number(px.toFixed(4)))
  }
  return out
}

function input(over: Partial<ClosedBookPacketInput> = {}): ClosedBookPacketInput {
  const s = over.series ?? series(flat(80))
  const last = s[s.length - 1]!
  return {
    instrument: 'AAPL',
    category: 'stock',
    horizon: '1d',
    series: s,
    seriesSource: 'Twelve Data /time_series+quote',
    seriesAsOf: last.date,
    anchorClose: last.close,
    anchorSessionDate: last.date,
    quoteAsOf: last.date,
    consensus: null,
    crypto: null,
    findings: [],
    researchCacheKey: 'rp_v2|AAPL|1d',
    assembledAt: '2026-08-28T09:00:00.000Z',
    ...over,
  }
}

function cot(long: number, short: number): CotPositioning {
  return {
    contract: 'GOLD - COMMODITY EXCHANGE INC.',
    date: '2026-08-25',
    openInterest: 500_000,
    managedMoneyLong: long,
    managedMoneyShort: short,
    managedMoneyNet: long - short,
  }
}

describe('crowding layer — computed, shared with all 40 models', () => {
  it('flags an overbought, stretched run and lists it on the lower-close side', () => {
    const r = computeCrowding(input({ series: series(meltUp()) }))
    expect(r.flags.some((f) => /RSI14 \d+ — overbought/.test(f))).toBe(true)
    expect(r.flags.some((f) => /above SMA50 .*σ.*overheated run/.test(f))).toBe(true)
    expect(r.down.some((d) => /mean-reversion/.test(d))).toBe(true)
    expect(r.up.some((u) => /positive 20-session momentum/.test(u))).toBe(true)
  })

  it('flags a volume blow-off into overbought', () => {
    const closes = meltUp()
    closes.push(Number((closes[closes.length - 1]! * 1.03).toFixed(4)))
    const vols = closes.map((_, i) => (i === closes.length - 1 ? 5_000_000 : 1_000_000))
    const r = computeCrowding(input({ series: series(closes, vols) }))
    expect(r.flags.some((f) => /volume 5\.0× .*blow-off risk/.test(f))).toBe(true)
  })

  it('a quiet tape says "none measured" — no invented balance', () => {
    const text = formatCrowding(input())
    expect(text).toContain(CROWDING_HEADER)
    expect(text).toContain('flags: none measured')
    expect(text).toContain('argues higher close: none measured')
    expect(text).toContain('argues lower close: none measured')
  })

  it('one-way data stays one-way: the thin side is not padded', () => {
    const r = computeCrowding(
      input({
        category: 'crypto_spot',
        instrument: 'BTC/USD',
        crypto: {
          fetchedAt: '2026-08-28T09:00:00.000Z',
          funding: { rate: 0.0012, nextFundingTime: null },
          openInterest: { contracts: 1 },
          markIv: { unavailable: 'x' },
        },
        slow: {
          fetchedAt: '2026-08-28T09:00:00.000Z',
          topTraderLs: { symbol: 'BTCUSDT', timestamp: 't', period: '1d', longAccountPct: 72 },
          fearGreed: { latest: { date: 'd', value: 84, classification: 'Extreme Greed' }, week: [] },
        },
      }),
    )
    expect(r.flags.some((f) => /funding 0\.1200%\/8h — longs paying at an extreme/.test(f))).toBe(true)
    expect(r.flags.some((f) => /72\.0% long — crowded long/.test(f))).toBe(true)
    expect(r.flags.some((f) => /extreme greed/.test(f))).toBe(true)
    expect(r.down.length).toBeGreaterThanOrEqual(3)
    expect(r.up).toEqual([])
  })

  it('negative funding and crowded shorts argue the squeeze side', () => {
    const r = computeCrowding(
      input({
        category: 'memecoin',
        instrument: 'DOGE/USD',
        crypto: {
          fetchedAt: 'x',
          funding: { rate: -0.0005, nextFundingTime: null },
          openInterest: { unavailable: 'x' },
          markIv: { unavailable: 'x' },
        },
        slow: { fetchedAt: 'x', topTraderLs: { symbol: 'DOGEUSDT', timestamp: 't', period: '1d', longAccountPct: 35 } },
      }),
    )
    expect(r.up).toContain('negative funding (crowded shorts)')
    expect(r.up.some((u) => /crowded short top-trader/.test(u))).toBe(true)
  })

  it('COT: lopsided speculators are flagged, with the managed-money-only caveat', () => {
    const r = computeCrowding(
      input({ category: 'gold_metal', instrument: 'XAU/USD', slow: { fetchedAt: 'x', cotGold: cot(250_000, 40_000) } }),
    )
    expect(r.flags.some((f) => /COT gold: speculators 6\.3:1 long .*crowded long/.test(f))).toBe(true)
    expect(r.flags.some((f) => /commercial hedger positions .* not in this feed/.test(f))).toBe(true)
    const balanced = computeCrowding(
      input({ category: 'gold_metal', instrument: 'XAU/USD', slow: { fetchedAt: 'x', cotGold: cot(150_000, 100_000) } }),
    )
    expect(balanced.flags.some((f) => /COT gold:/.test(f))).toBe(false)
  })

  it('index: put/call and VIX extremes flip sides for inverse / vol ETFs', () => {
    const slow = {
      fetchedAt: 'x',
      putCall: { date: 'd', total: 0.6, index: 0.9, equity: 0.42 },
      vixcls: { date: 'd', value: 11.5 },
    } as ClosedBookPacketInput['slow']
    const spy = computeCrowding(input({ category: 'etf_index', instrument: 'SPY', slow }))
    expect(spy.flags.some((f) => /equity put\/call 0\.42 .*complacency/.test(f))).toBe(true)
    expect(spy.flags.some((f) => /VIX 11\.50/.test(f))).toBe(true)
    expect(spy.down).toEqual(expect.arrayContaining(['low VIX complacency']))
    const sqqq = computeCrowding(input({ category: 'etf_index', instrument: 'SQQQ', slow }))
    expect(sqqq.up).toEqual(expect.arrayContaining(['low VIX complacency']))
    expect(sqqq.down).not.toContain('low VIX complacency')
  })

  it('stocks: insider clusters + short-volume spike; analyst numbers never printed', () => {
    const text = formatCrowding(
      input({
        anchorClose: 260,
        slow: {
          fetchedAt: 'x',
          shortVolume: { date: 'd', shortShares: 65, totalShares: 100, shortPct: 65 },
          insider: { windowDays: 90, buyTxns: 0, buyShares: 0, sellTxns: 9, sellShares: 1, netShares: -1, latestFilingDate: 'd' },
        },
        consensus: {
          priceTarget: { high: 250, median: 220, low: 180, mean: 221, analysts: 40, asOf: 'd' },
          lastEarnings: { unavailable: 'x' },
        } as unknown as ClosedBookPacketInput['consensus'],
      }),
    )
    expect(text).toMatch(/short-sale volume share 65\.0%/)
    expect(text).toMatch(/insider cluster selling: 9 open-market sells/)
    expect(text).toContain('above the highest analyst target')
    expect(text).not.toMatch(/\b(250|220|180)\b/)
    expect(text).not.toMatch(/Twelve Data/i)
  })

  it('never asserts manipulation as fact', () => {
    const text = formatCrowding(input({ series: series(meltUp()) }))
    expect(text).toContain('"세력" / manipulation is a hypothesis you may raise, never a fact')
    expect(text).not.toMatch(/manipulation (detected|confirmed)|세력이 (있다|확인)/)
  })
})

describe('closed-book packet carries the crowding block', () => {
  it('sits after the numeric sections and before prose, extractable for the crow', () => {
    const packet = assembleClosedBookInjection(
      input({
        series: series(meltUp()),
        findings: [{ query: 'drivers', summary: 'Supplier orders grew 8% per Reuters.' }],
      }),
    )
    expect(packet).toContain(CROWDING_HEADER)
    expect(packet).toContain(BOTH_SIDES_HEADER)
    expect(packet.indexOf(CROWDING_HEADER)).toBeGreaterThan(packet.indexOf('BASE RATE'))
    const block = extractCrowdingBlock(packet)!
    expect(block.startsWith(CROWDING_HEADER)).toBe(true)
    expect(block).toContain('argues lower close:')
    expect(block).not.toContain('Supplier orders')
  })

  it('no series and no positioning → no block', () => {
    expect(formatCrowding(input({ series: series(flat(10)) }))).toBe('')
    expect(extractCrowdingBlock(null)).toBeNull()
    expect(extractCrowdingBlock('no block here')).toBeNull()
  })
})

describe('까마귀 — sharpest crowding reader', () => {
  it('finance lens reads the shared CROWDING block; 세력 is a hypothesis', () => {
    const p = buildCrowSystemPrompt('commodity')
    expect(p).toContain('mean-reversion')
    expect(p).toContain('CROWDING & OVERHEATING')
    expect(p).toMatch(/squeeze/)
    expect(p).toMatch(/hypothesis you may raise, never a fact/)
  })

  it('finance brief gets the computed block appended, never the research prose', () => {
    const closes = meltUp()
    const packet = assembleClosedBookInjection(
      input({ series: series(closes), findings: [{ query: 'q', summary: 'Analyst target raised to 300 per Twelve Data.' }] }),
    )
    const brief = withCrowdingBlock(formatFinanceCrowBrief(series(closes)), packet)
    expect(brief).toContain('SHARED POSITIONING')
    expect(brief).toContain(CROWDING_HEADER)
    expect(brief).not.toMatch(/Twelve Data|target raised/i)
    expect(withCrowdingBlock('price path', null)).toBe('price path')
  })
})

describe('both-sides fills — genuine factors, no invented balance', () => {
  it('politics: priced other side + documented-risk guidance; heavy favorite may stay the call', () => {
    const lines = formatPoliticsBothSides({ kalshiPct: 80, polymarketPct: 80 }, 'Kim').join('\n')
    expect(lines).toContain('Do not invent balance')
    expect(lines).toMatch(/not-Kim 20\.0%/)
    expect(lines).toContain('can still be the call')
    expect(formatPoliticsBothSides(null, 'Kim').join('\n')).toContain('UNAVAILABLE')
  })

  it('entertainment: one query looks for flop / competition risk', () => {
    const parts = decodeEntertainmentInstrument('SHOW:boxoffice:KR:opening_1:x:1')
    expect(parts).not.toBeNull()
    expect(entertainmentSearchQueries(parts!).some((q) => /flop|counter-programming/i.test(q.q))).toBe(true)
  })
})
