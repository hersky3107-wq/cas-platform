import { describe, expect, it } from 'vitest'
import {
  US_UNIVERSE_SEED,
  flagsForUsUniverse,
  formatUsUniverseTable,
  planUsUniverseWrites,
  type UsUniverseVerifyRow,
} from './us-universe-apply'

function verified(over: Partial<UsUniverseVerifyRow> = {}): UsUniverseVerifyRow {
  return {
    rank: 1,
    ticker: 'TSLA',
    nameKo: '테슬라',
    exchange: 'NASDAQ',
    instrument: 'STOCK:NASDAQ:TSLA',
    bars: 90,
    flags: [],
    ok: true,
    vendorName: 'Tesla Inc',
    ...over,
  }
}

describe('US_UNIVERSE_SEED', () => {
  it('has 35 unique ranks, names, and expected tickers', () => {
    expect(US_UNIVERSE_SEED).toHaveLength(35)
    expect(new Set(US_UNIVERSE_SEED.map((r) => r.rank)).size).toBe(35)
    expect(US_UNIVERSE_SEED.map((r) => r.rank)).toEqual([...Array(35)].map((_, i) => i + 1))
    expect(new Set(US_UNIVERSE_SEED.map((r) => r.nameKo)).size).toBe(35)

    const tickers = US_UNIVERSE_SEED.map((r) => r.ticker).filter((t): t is string => Boolean(t))
    expect(new Set(tickers).size).toBe(tickers.length)
    expect(tickers.length + US_UNIVERSE_SEED.filter((r) => r.ticker == null).length).toBe(35)

    const spacex = US_UNIVERSE_SEED.find((r) => r.rank === 11)
    expect(spacex).toMatchObject({
      ticker: null,
      nameKo: '스페이스X',
      search: 'Space Exploration Technologies',
    })
  })
})

describe('flagsForUsUniverse', () => {
  it('assigns short_history and crypto_linked independently', () => {
    expect(flagsForUsUniverse('AAPL', 90)).toEqual([])
    expect(flagsForUsUniverse('AAPL', 59)).toEqual(['short_history'])
    expect(flagsForUsUniverse('MSTR', 90)).toEqual(['crypto_linked'])
    expect(flagsForUsUniverse('IREN', 10)).toEqual(['short_history', 'crypto_linked'])
    expect(flagsForUsUniverse('BMNR', 60)).toEqual(['crypto_linked'])
    expect(flagsForUsUniverse('CRCL', 1)).toEqual(['short_history', 'crypto_linked'])
    expect(flagsForUsUniverse('mstr', 80)).toEqual(['crypto_linked'])
  })
})

describe('planUsUniverseWrites', () => {
  it('writes only OK rows as pinned US listings and skips FAILED', () => {
    const now = '2026-10-02T00:00:00.000Z'
    const writes = planUsUniverseWrites(
      [
        verified({ rank: 1, ticker: 'TSLA', flags: [] }),
        verified({
          rank: 11,
          ticker: '?',
          nameKo: '스페이스X',
          exchange: '',
          instrument: '',
          bars: 0,
          ok: false,
          error: 'symbol_search: no NYSE/NASDAQ hit',
        }),
        verified({
          rank: 20,
          ticker: 'MSTR',
          nameKo: '스트래티지',
          instrument: 'STOCK:NASDAQ:MSTR',
          flags: ['crypto_linked'],
        }),
        verified({
          rank: 10,
          ticker: 'SNDK',
          nameKo: '샌디스크',
          instrument: 'STOCK:NASDAQ:SNDK',
          bars: 12,
          flags: ['short_history'],
        }),
      ],
      now,
    )
    expect(writes.map((w) => w.code)).toEqual(['TSLA', 'MSTR', 'SNDK'])
    expect(writes.every((w) => w.market === 'US')).toBe(true)
    expect(writes.every((w) => w.group_id === null)).toBe(true)
    expect(writes.every((w) => w.status === 'pinned')).toBe(true)
    expect(writes.every((w) => w.visible === true)).toBe(true)
    expect(writes.every((w) => w.removed_at === null)).toBe(true)
    expect(writes.find((w) => w.code === 'MSTR')?.flags).toEqual(['crypto_linked'])
    expect(writes.find((w) => w.code === 'SNDK')).toMatchObject({
      popularity_rank: 10,
      flags: ['short_history'],
    })
  })
})

describe('formatUsUniverseTable', () => {
  it('prints OK/FAILED with flags', () => {
    const table = formatUsUniverseTable([
      verified({ flags: ['crypto_linked'] }),
      verified({
        rank: 11,
        ticker: '?',
        nameKo: '스페이스X',
        exchange: '',
        instrument: '',
        ok: false,
        error: 'symbol_search: no NYSE/NASDAQ hit',
      }),
    ])
    expect(table).toContain('OK')
    expect(table).toContain('FAILED')
    expect(table).toContain('crypto_linked')
    expect(table).toContain('STOCK:NASDAQ:TSLA')
  })
})
