import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NextResponse } from 'next/server'
import { gatePublicGenerateInstrument } from '../access-policy'
import { encodeKrStockInstrument, orderVisibleUniverseRows } from '../korea-equity-catalog'
import {
  canReadKrUniverseApi,
  instrumentForUniverseRow,
  parseUniverseMarketParam,
  toKrUniverseClientRow,
} from '../korea-universe-api'
import { encodeStockInstrument, decodeStockInstrument, stockQuoteSymbol } from '../gateway/adapters/stock-catalog'
import type { UniverseRecord } from '../korea-universe-apply'

const ROOT = join(__dirname, '../../..')

const mocks = vi.hoisted(() => ({
  resolveLeagueViewer: vi.fn(),
  listVisibleUniverse: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/league/public-access', () => ({
  resolveLeagueViewer: mocks.resolveLeagueViewer,
  forbiddenResponse: (code: string) =>
    NextResponse.json({ error: 'Not available for your account or region', code }, { status: 403 }),
}))
vi.mock('@/lib/league/korea-universe-store', () => ({
  listVisibleUniverse: mocks.listVisibleUniverse,
  isUniverseCodeVisible: vi.fn(),
}))

function rec(over: Partial<UniverseRecord> = {}): UniverseRecord {
  return {
    market: 'KOSPI',
    code: '005930',
    name: '삼성전자',
    groupId: 'semis',
    status: 'auto',
    popularityRank: 1,
    avgTrdval20dEok: 10000,
    mktcapEok: 4000000,
    visible: true,
    removedAt: null,
    flags: ['theme_smallcap'],
    updatedAt: '2026-10-02T00:00:00.000Z',
    exchange: null,
    ...over,
  }
}

const krViewer = { isAdmin: false, jurisdiction: { declaredCountry: 'KR' as const, ipCountry: 'KR' as const } }
const krAdmin = { isAdmin: true, jurisdiction: { declaredCountry: 'KR' as const, ipCountry: 'KR' as const } }
const usViewer = { isAdmin: false, jurisdiction: { declaredCountry: 'US' as const, ipCountry: 'US' as const } }

describe('kr-universe API helpers', () => {
  it('parses market and allows Korean-lane or admin only', () => {
    expect(parseUniverseMarketParam('kospi')).toBe('KOSPI')
    expect(parseUniverseMarketParam('US')).toBe('US')
    expect(parseUniverseMarketParam('NYSE')).toBeNull()
    expect(canReadKrUniverseApi(krViewer)).toBe(true)
    expect(canReadKrUniverseApi(krAdmin)).toBe(true)
    expect(canReadKrUniverseApi(usViewer)).toBe(false)
    expect(canReadKrUniverseApi({ isAdmin: true, jurisdiction: usViewer.jurisdiction })).toBe(true)
  })

  it('builds KRSTOCK / STOCK instruments and strips flags and values', () => {
    const kr = toKrUniverseClientRow(rec())
    expect(kr).toEqual({
      market: 'KOSPI',
      code: '005930',
      name: '삼성전자',
      groupId: 'semis',
      popularityRank: 1,
      instrument: 'KRSTOCK:KOSPI:005930',
    })
    expect(kr).not.toHaveProperty('flags')
    expect(kr).not.toHaveProperty('avgTrdval20dEok')
    expect(kr).not.toHaveProperty('mktcapEok')

    const us = toKrUniverseClientRow(
      rec({
        market: 'US',
        code: 'BRK.B',
        name: '버크셔해서웨이 B',
        groupId: null,
        popularityRank: 27,
        exchange: 'NYSE',
      }),
    )
    expect(us?.instrument).toBe('STOCK:NYSE:BRK.B')
    expect(instrumentForUniverseRow({ market: 'US', code: 'TSLA', exchange: null })).toBeNull()
  })

  it('orders KR by group then rank, and US by popularity only', () => {
    const krRows = orderVisibleUniverseRows(
      [
        rec({ code: '035420', groupId: 'internet_ent', popularityRank: 1, name: 'NAVER' }),
        rec({ code: '000660', groupId: 'semis', popularityRank: 2, name: 'SK하이닉스' }),
        rec({ code: '005930', groupId: 'semis', popularityRank: 1 }),
      ],
      'KOSPI',
    ).map((row) => toKrUniverseClientRow(row)?.code)
    expect(krRows).toEqual(['005930', '000660', '035420'])

    const usRows = orderVisibleUniverseRows(
      [
        rec({ market: 'US', code: 'NVDA', groupId: null, popularityRank: 2, exchange: 'NASDAQ', name: '엔비디아' }),
        rec({ market: 'US', code: 'TSLA', groupId: null, popularityRank: 1, exchange: 'NASDAQ', name: '테슬라' }),
      ],
      'US',
    ).map((row) => toKrUniverseClientRow(row)?.code)
    expect(usRows).toEqual(['TSLA', 'NVDA'])
  })
})

describe('GET /api/league/kr-universe', () => {
  afterEach(() => {
    mocks.resolveLeagueViewer.mockReset()
    mocks.listVisibleUniverse.mockReset()
  })

  it('returns 403 for a world-lane viewer', async () => {
    mocks.resolveLeagueViewer.mockResolvedValue({
      ok: true,
      viewer: { userId: 'u', isAdmin: false, jurisdiction: usViewer.jurisdiction, visibleCategories: [] },
    })
    const { GET } = await import('../../../app/api/league/kr-universe/route')
    const res = await GET(new Request('http://localhost/api/league/kr-universe?market=US'))
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.code).toBe('jurisdiction_blocked')
    expect(mocks.listVisibleUniverse).not.toHaveBeenCalled()
  })

  it('returns ordered rows without flags or values for a Korean-lane viewer', async () => {
    mocks.resolveLeagueViewer.mockResolvedValue({
      ok: true,
      viewer: { userId: 'u', isAdmin: false, jurisdiction: krViewer.jurisdiction, visibleCategories: [] },
    })
    mocks.listVisibleUniverse.mockResolvedValue(
      orderVisibleUniverseRows(
        [
          rec({
            market: 'US',
            code: 'NVDA',
            name: '엔비디아',
            groupId: null,
            popularityRank: 2,
            exchange: 'NASDAQ',
            flags: ['crypto_linked'],
            avgTrdval20dEok: 99,
            mktcapEok: 1,
          }),
          rec({
            market: 'US',
            code: 'TSLA',
            name: '테슬라',
            groupId: null,
            popularityRank: 1,
            exchange: 'NASDAQ',
          }),
        ],
        'US',
      ),
    )
    const { GET } = await import('../../../app/api/league/kr-universe/route')
    const res = await GET(new Request('http://localhost/api/league/kr-universe?market=US'))
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('private, max-age=300')
    const body = (await res.json()) as { rows: Record<string, unknown>[] }
    expect(body.rows.map((r) => r.code)).toEqual(['TSLA', 'NVDA'])
    expect(body.rows[0]).toEqual({
      market: 'US',
      code: 'TSLA',
      name: '테슬라',
      groupId: null,
      popularityRank: 1,
      instrument: 'STOCK:NASDAQ:TSLA',
    })
    for (const row of body.rows) {
      expect(row).not.toHaveProperty('flags')
      expect(row).not.toHaveProperty('avgTrdval20dEok')
      expect(row).not.toHaveProperty('mktcapEok')
      expect(row).not.toHaveProperty('avg_trdval_20d_eok')
      expect(row).not.toHaveProperty('mktcap_eok')
    }
  })
})

describe('Korean-lane STOCK generate allowlist', () => {
  const visible = { isUsUniverseVisible: (code: string) => code === 'BRK.B' || code === 'TSLA' }

  it('allows a visible US row and rejects a non-universe STOCK for the Korean lane', () => {
    const prev = process.env.KR_ADVISORY_REG_NO
    process.env.KR_ADVISORY_REG_NO = '2026-TEST'
    try {
      expect(gatePublicGenerateInstrument('STOCK:NYSE:BRK.B', krViewer, '1d', undefined, visible)).toEqual({
        ok: true,
        instrument: 'STOCK:NYSE:BRK.B',
        category: 'stock',
        horizon: '1d',
      })
      expect(gatePublicGenerateInstrument('STOCK:NASDAQ:IBM', krViewer, '1d', undefined, visible)).toEqual({
        ok: false,
        status: 403,
        code: 'jurisdiction_blocked',
      })
      expect(gatePublicGenerateInstrument('STOCK:NASDAQ:IBM', krViewer, '1d')).toEqual({
        ok: false,
        status: 403,
        code: 'jurisdiction_blocked',
      })
    } finally {
      if (prev === undefined) delete process.env.KR_ADVISORY_REG_NO
      else process.env.KR_ADVISORY_REG_NO = prev
    }
  })

  it('keeps the registration gate and leaves the world lane unchanged', () => {
    const prev = process.env.KR_ADVISORY_REG_NO
    delete process.env.KR_ADVISORY_REG_NO
    try {
      expect(gatePublicGenerateInstrument('STOCK:NASDAQ:TSLA', krViewer, '1d', undefined, visible)).toEqual({
        ok: false,
        status: 403,
        code: 'jurisdiction_blocked',
      })
      expect(gatePublicGenerateInstrument('STOCK:NYSE:BRK.B', krAdmin, '1d', undefined, visible)).toMatchObject({
        ok: true,
        instrument: 'STOCK:NYSE:BRK.B',
      })
      expect(gatePublicGenerateInstrument('STOCK:NASDAQ:IBM', usViewer, '1d')).toMatchObject({
        ok: true,
        instrument: 'STOCK:NASDAQ:IBM',
        category: 'stock',
      })
    } finally {
      if (prev === undefined) delete process.env.KR_ADVISORY_REG_NO
      else process.env.KR_ADVISORY_REG_NO = prev
    }
  })

  it('still rejects KRSTOCK', () => {
    const instrument = encodeKrStockInstrument('KOSPI', '005930')!
    expect(
      gatePublicGenerateInstrument(instrument, krAdmin, '1d', undefined, visible),
    ).toEqual({ ok: false, status: 400, code: 'unknown_instrument' })
  })
})

describe('BRK.B codec and Twelve Data symbol', () => {
  it('round-trips STOCK:NYSE:BRK.B and does not mangle the dot in the quote symbol', () => {
    const instrument = encodeStockInstrument({ exchange: 'NYSE', symbol: 'BRK.B' })
    expect(instrument).toBe('STOCK:NYSE:BRK.B')
    expect(decodeStockInstrument(instrument)).toEqual({ exchange: 'NYSE', symbol: 'BRK.B' })
    expect(stockQuoteSymbol(instrument!)).toBe('BRK.B')

    const qs = new URLSearchParams({ symbol: 'BRK.B', interval: '1day', outputsize: '90' }).toString()
    expect(qs).toContain('symbol=BRK.B')
    expect(qs).not.toMatch(/BRK%2E|BRK-B/)
    expect(encodeURIComponent('BRK.B')).toBe('BRK.B')

    const md = readFileSync(join(ROOT, 'lib/league/market-data.ts'), 'utf8')
    expect(md).toContain('symbol: listing.symbol')
    expect(md).toContain('exchange: listing.exchange')
  })
})
