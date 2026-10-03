import { describe, expect, it } from 'vitest'
import { gatePublicGenerateInstrument } from '../access-policy'
import {
  KR_ENTER_RANK,
  KR_EXIT_RANK,
  KR_GROUPS,
  decideUniverseStatus,
  decodeKrStockInstrument,
  encodeKrStockInstrument,
  isKrStockInstrument,
  type UniverseRow,
} from '../korea-equity-catalog'

const NOW = '2026-10-02T09:00:00.000Z'

function autoRow(over: Partial<UniverseRow> = {}): UniverseRow {
  return {
    code: '005930',
    name: 'Samsung Electronics',
    market: 'KOSPI',
    groupId: 'semis',
    status: 'auto',
    popularityRank: 1,
    removedAt: null,
    ...over,
  }
}

describe('KRSTOCK codec', () => {
  it('round-trips KOSPI 005930 and KOSDAQ 247540', () => {
    expect(encodeKrStockInstrument('KOSPI', '005930')).toBe('KRSTOCK:KOSPI:005930')
    expect(decodeKrStockInstrument('KRSTOCK:KOSPI:005930')).toEqual({ market: 'KOSPI', code: '005930' })
    expect(isKrStockInstrument('KRSTOCK:KOSPI:005930')).toBe(true)

    expect(encodeKrStockInstrument('KOSDAQ', '247540')).toBe('KRSTOCK:KOSDAQ:247540')
    expect(decodeKrStockInstrument('KRSTOCK:KOSDAQ:247540')).toEqual({ market: 'KOSDAQ', code: '247540' })
    expect(decodeKrStockInstrument(encodeKrStockInstrument('KOSDAQ', '247540')!)).toEqual({
      market: 'KOSDAQ',
      code: '247540',
    })
  })

  it('rejects invalid instrument strings', () => {
    const rejects = [
      'STOCK:KOSPI:005930',
      'KRSTOCK:KONEX:005930',
      'KRSTOCK:KOSPI:5930',
      'KRSTOCK:KOSPI:005930:X',
      'krstock:kospi:005930',
      'KRSTOCK:KOSPI:00593%30',
      'KRSTOCK:KOSPI: 005930',
    ]
    for (const s of rejects) {
      expect(decodeKrStockInstrument(s), s).toBeNull()
      expect(isKrStockInstrument(s), s).toBe(false)
    }
  })
})

describe('KR_GROUPS', () => {
  it('lists sector groups in product order', () => {
    expect(KR_GROUPS.map((g) => g.id)).toEqual([
      'semis',
      'electronics',
      'battery',
      'auto',
      'bio',
      'ship_defense',
      'power_machinery',
      'robot_ai',
      'internet_ent',
      'finance',
      'materials_energy',
      'consumer',
      'infra',
      'other',
    ])
    expect(KR_GROUPS.find((g) => g.id === 'semis')?.label).toBe('반도체·장비')
  })
})

describe('decideUniverseStatus — auto hysteresis', () => {
  it('enters at rank 175, not at 176', () => {
    expect(decideUniverseStatus(undefined, KR_ENTER_RANK, false, NOW)).toEqual({
      visible: true,
      removedAt: null,
    })
    expect(decideUniverseStatus(undefined, KR_ENTER_RANK + 1, false, NOW)).toEqual({
      visible: false,
      removedAt: null,
    })
  })

  it('stays visible at rank 200 while in the band', () => {
    expect(decideUniverseStatus(autoRow({ popularityRank: 200 }), 200, false, NOW)).toEqual({
      visible: true,
      removedAt: null,
    })
  })

  it('leaves at rank 221 or when rank is null', () => {
    expect(decideUniverseStatus(autoRow({ popularityRank: 200 }), KR_EXIT_RANK + 1, false, NOW)).toEqual({
      visible: false,
      removedAt: NOW,
    })
    expect(decideUniverseStatus(autoRow({ popularityRank: 200 }), null, false, NOW)).toEqual({
      visible: false,
      removedAt: NOW,
    })
  })

  it('re-entry after removal clears removedAt', () => {
    const removed = autoRow({ removedAt: '2026-09-01T00:00:00.000Z', popularityRank: null })
    expect(decideUniverseStatus(removed, KR_ENTER_RANK, false, NOW)).toEqual({
      visible: true,
      removedAt: null,
    })
  })
})

describe('decideUniverseStatus — pinned, hidden, excluded', () => {
  it('pinned survives rank null; hidden is never visible', () => {
    expect(
      decideUniverseStatus(autoRow({ status: 'pinned' }), null, false, NOW),
    ).toEqual({ visible: true, removedAt: null })
    expect(
      decideUniverseStatus(autoRow({ status: 'hidden' }), KR_ENTER_RANK, false, NOW),
    ).toEqual({ visible: false, removedAt: null })
  })

  it('excluded overrides pinned and keeps an existing removedAt', () => {
    const pinned = autoRow({ status: 'pinned' })
    expect(decideUniverseStatus(pinned, 1, true, NOW)).toEqual({
      visible: false,
      removedAt: NOW,
    })
    const alreadyRemoved = autoRow({
      status: 'pinned',
      removedAt: '2026-08-01T00:00:00.000Z',
    })
    expect(decideUniverseStatus(alreadyRemoved, 1, true, NOW)).toEqual({
      visible: false,
      removedAt: '2026-08-01T00:00:00.000Z',
    })
  })
})

describe('generate path — KRSTOCK admin-only', () => {
  const instrument = encodeKrStockInstrument('KOSPI', '005930')!
  const visible = {
    isKrUniverseVisible: (market: 'KOSPI' | 'KOSDAQ', code: string) => market === 'KOSPI' && code === '005930',
  }
  const krPublic = { isAdmin: false, jurisdiction: { declaredCountry: 'KR', ipCountry: 'KR' } }
  const usPublic = { isAdmin: false, jurisdiction: { declaredCountry: 'US', ipCountry: 'US' } }
  const admin = { isAdmin: true, jurisdiction: { declaredCountry: 'KR', ipCountry: 'KR' } }

  it('non-admin is 403 kr_stock_not_open on both lanes when the code is visible', () => {
    expect(decodeKrStockInstrument(instrument)).not.toBeNull()
    expect(gatePublicGenerateInstrument(instrument, krPublic, '1d', undefined, visible)).toEqual({
      ok: false,
      status: 403,
      code: 'kr_stock_not_open',
    })
    expect(gatePublicGenerateInstrument(instrument, usPublic, '1d', undefined, visible)).toEqual({
      ok: false,
      status: 403,
      code: 'kr_stock_not_open',
    })
  })

  it('admin with a visible universe code is allowed', () => {
    expect(gatePublicGenerateInstrument(instrument, admin, '1d', undefined, visible)).toEqual({
      ok: true,
      instrument,
      category: 'stock',
      horizon: '1d',
    })
  })

  it('a code missing from the visible universe is 400 unknown_instrument even for admin', () => {
    expect(
      gatePublicGenerateInstrument('KRSTOCK:KOSDAQ:247540', admin, '1d', undefined, visible),
    ).toEqual({ ok: false, status: 400, code: 'unknown_instrument' })
    expect(gatePublicGenerateInstrument(instrument, admin, '1d')).toEqual({
      ok: false,
      status: 400,
      code: 'unknown_instrument',
    })
  })
})
