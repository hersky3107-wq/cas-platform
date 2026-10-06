import { fromZonedTime } from 'date-fns-tz'
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/server', () => ({ supabaseAdmin: { from: vi.fn() } }))
vi.mock('../korea-market-data', () => ({ getOfficialClose: vi.fn() }))
vi.mock('../market-data', () => ({ fetchTwelveDataSessionClose: vi.fn() }))
vi.mock('../korea-universe-store', () => ({ getVisibleUniverseRow: vi.fn() }))

import { buildKrStockRankedRoundInput, resolveKrStockAnchor, type KrStockRoundIo } from '../korea-stock-round'
import { krxSessionCloseIso } from '../krx-calendar'

const KR = 'KRSTOCK:KOSPI:005930'

function kst(ymd: string, hm: string): Date {
  return fromZonedTime(`${ymd} ${hm}:00`, 'Asia/Seoul')
}

function io(over: Partial<KrStockRoundIo> = {}): KrStockRoundIo {
  return {
    now: () => kst('2026-10-02', '16:00'),
    getVisibleRow: async () => ({ name: '삼성전자' }),
    getOfficialClose: async () => 71400,
    getProvisionalClose: async () => 'empty',
    getTwelveDataClose: async () => 71300,
    ...over,
  }
}

describe('resolveKrStockAnchor a/b/c', () => {
  it('a) official KRX close → krx_official', async () => {
    await expect(resolveKrStockAnchor('KOSPI', '005930', '2026-10-02', io())).resolves.toEqual({
      ok: true,
      price: 71400,
      source: 'krx_official',
      provisional: false,
    })
  })

  it('b) missing official after the 08:00 publish clock, Twelve Data bar → twelvedata', async () => {
    await expect(
      resolveKrStockAnchor(
        'KOSPI',
        '005930',
        '2026-10-02',
        io({
          now: () => kst('2026-10-03', '09:00'),
          getOfficialClose: async () => 'not_published',
        }),
      ),
    ).resolves.toEqual({ ok: true, price: 71300, source: 'twelvedata', provisional: false })
  })

  it('uses a same-day portal close after the session when the official file is unpublished', async () => {
    let tdCalls = 0
    let officialDates: string[] = []
    await expect(
      resolveKrStockAnchor(
        'KOSPI',
        '005930',
        '2026-10-06',
        io({
          now: () => kst('2026-10-06', '17:25'),
          getOfficialClose: async (_m, _c, date) => {
            officialDates.push(date)
            return 'not_published'
          },
          getProvisionalClose: async () => 72000,
          getTwelveDataClose: async () => {
            tdCalls += 1
            return 1
          },
        }),
      ),
    ).resolves.toEqual({ ok: true, price: 72000, source: 'krx_data_portal', provisional: true })
    expect(tdCalls).toBe(0)
    expect(officialDates).toEqual(['2026-10-06'])
  })

  it('rejects an older session as the generate anchor', async () => {
    await expect(
      resolveKrStockAnchor(
        'KOSPI',
        '005930',
        '2026-10-02',
        io({
          now: () => kst('2026-10-06', '17:25'),
          getOfficialClose: async () => 71400,
        }),
      ),
    ).resolves.toEqual({ ok: false, reason: 'older_session_rejected' })
  })

  it('surfaces a portal login/session failure instead of waiting on the official file', async () => {
    let tdCalls = 0
    await expect(
      resolveKrStockAnchor(
        'KOSPI',
        '005930',
        '2026-10-06',
        io({
          now: () => kst('2026-10-06', '17:25'),
          getOfficialClose: async () => 'not_published',
          getProvisionalClose: async () => 'unavailable',
          getTwelveDataClose: async () => {
            tdCalls += 1
            return 1
          },
        }),
      ),
    ).resolves.toEqual({ ok: false, reason: 'krx_portal_unavailable' })
    expect(tdCalls).toBe(0)
  })

  it('c) unknown official code and no Twelve Data bar → anchor_unavailable', async () => {
    await expect(
      resolveKrStockAnchor(
        'KOSPI',
        '005930',
        '2026-10-02',
        io({ getOfficialClose: async () => 'unknown_code', getTwelveDataClose: async () => null }),
      ),
    ).resolves.toEqual({ ok: false, reason: 'anchor_unavailable' })
  })
})

describe('buildKrStockRankedRoundInput', () => {
  it('persists KRX proposition, 15:30 KST resolves_at, and the official anchor', async () => {
    const built = await buildKrStockRankedRoundInput(KR, '1d', kst('2026-10-02', '16:00'), io())
    expect(built.ok).toBe(true)
    if (!built.ok) return
    expect(built.input.proposition_text).toContain('KRX regular-session close')
    expect(built.input.proposition_text).toContain('삼성전자')
    expect(built.input.subject_label).toBe('삼성전자')
    expect(built.input.resolves_at).toBe(krxSessionCloseIso('2026-10-06'))
    expect(built.input.anchor_session_date).toBe('2026-10-02')
    expect(built.input.anchor_price).toBe(71400)
    expect(built.input.anchor_source).toBe('krx_official')
    expect(built.input.anchor_provisional).toBe(false)
    expect(built.input.anchor_price_at).toBe(krxSessionCloseIso('2026-10-02'))
  })

  it('after the close, persists today\'s portal close and never yesterday\'s official', async () => {
    const built = await buildKrStockRankedRoundInput(KR, '1d', kst('2026-10-06', '17:25'), io({
      now: () => kst('2026-10-06', '17:25'),
      getOfficialClose: async () => 'not_published',
      getProvisionalClose: async () => 72000,
    }))
    expect(built.ok).toBe(true)
    if (!built.ok) return
    expect(built.input.anchor_session_date).toBe('2026-10-06')
    expect(built.input.anchor_price).toBe(72000)
    expect(built.input.anchor_source).toBe('krx_data_portal')
    expect(built.input.anchor_provisional).toBe(true)
  })

  it('refuses when the KRX calendar is unverified', async () => {
    const built = await buildKrStockRankedRoundInput(KR, '1d', kst('2028-01-03', '16:00'), io({
      now: () => kst('2028-01-03', '16:00'),
    }))
    expect(built).toEqual({ ok: false, reason: 'krx_calendar_unverified' })
  })

  it('refuses a non-universe name miss as unknown_instrument', async () => {
    const built = await buildKrStockRankedRoundInput(KR, '1d', kst('2026-10-02', '16:00'), io({
      getVisibleRow: async () => null,
    }))
    expect(built).toEqual({ ok: false, reason: 'unknown_instrument' })
  })
})
