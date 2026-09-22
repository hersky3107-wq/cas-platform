import { describe, expect, it } from 'vitest'
import { buildCatalogRankedRoundInput } from '../../catalog'
import { assertApprovedCopy } from '../../compliance'
import { usesTradingSessions } from '../../horizon'
import { wantsConsensus, wantsCryptoContext } from '../adapters/price-series-packet'
import {
  createCommodityEnergyAdapter,
  createCryptoAdapter,
  createFxAdapter,
  createGoldMetalAdapter,
  createIndexEtfAdapter,
  createMemecoinAdapter,
  createRealEstateAdapter,
} from '../adapters/price-series-family'
import type { PriceSeriesIo } from '../adapters/price-series-packet'
import { refusalMessageForKey } from '../refusal-copy'
import type { CategoryAdapter, NormalizeSlots } from '../types'

const DEAD_IO: PriceSeriesIo = {
  fetchDataPacket: async () => {
    throw new Error('io must not be called')
  },
  fetchMarketConsensus: async () => {
    throw new Error('io must not be called')
  },
  fetchCryptoContext: async () => {
    throw new Error('io must not be called')
  },
  getResearchPacket: async () => {
    throw new Error('io must not be called')
  },
  fetchRelatedInstruments: async () => {
    throw new Error('io must not be called')
  },
  fetchSlowData: async () => {
    throw new Error('io must not be called')
  },
}

const family = {
  index_etf: createIndexEtfAdapter(DEAD_IO),
  gold_metals: createGoldMetalAdapter(DEAD_IO),
  commodities_energy: createCommodityEnergyAdapter(DEAD_IO),
  fx: createFxAdapter(DEAD_IO),
  crypto: createCryptoAdapter(DEAD_IO),
  memecoin: createMemecoinAdapter(DEAD_IO),
  real_estate: createRealEstateAdapter(DEAD_IO),
} as const

function slots(adapter: CategoryAdapter, entity_id: string, over: Partial<NormalizeSlots> = {}): NormalizeSlots {
  return {
    category_id: adapter.category_id,
    entity_id,
    entity_kind: adapter.entity_kinds[0]!,
    entity_label: entity_id,
    horizon: '1d',
    resolve_by: null,
    proposition_kind: 'binary_close_higher',
    slots: {},
    confidence: 0.95,
    ...over,
  }
}

describe('price-series family — Korean / English synonyms', () => {
  it.each([
    ['index_etf', family.index_etf, '나스닥', 'QQQ'],
    ['index_etf', family.index_etf, '다우', 'DIA'],
    ['index_etf', family.index_etf, 'tqqq', 'TQQQ'],
    ['gold_metals', family.gold_metals, '금', 'XAU/USD'],
    ['gold_metals', family.gold_metals, '은', 'XAG/USD'],
    ['gold_metals', family.gold_metals, '백금', 'XPT/USD'],
    ['commodities_energy', family.commodities_energy, '원유', 'WTI/USD'],
    ['commodities_energy', family.commodities_energy, '구리', 'CPER'],
    ['commodities_energy', family.commodities_energy, '옥수수', 'CORN'],
    ['commodities_energy', family.commodities_energy, '밀', 'WEAT'],
    ['commodities_energy', family.commodities_energy, '대두', 'SOYB'],
    ['commodities_energy', family.commodities_energy, '커피', 'COFF'],
    ['fx', family.fx, '달러원', 'USD/KRW'],
    ['fx', family.fx, '엔원', 'JPY/KRW'],
    ['fx', family.fx, '파운드엔', 'GBP/JPY'],
    ['crypto', family.crypto, '비트코인', 'BTC/USD'],
    ['crypto', family.crypto, '리플', 'XRP/USD'],
    ['crypto', family.crypto, 'bnb', 'BNB/USD'],
    ['crypto', family.crypto, '카르다노', 'ADA/USD'],
    ['crypto', family.crypto, '에이다', 'ADA/USD'],
    ['memecoin', family.memecoin, '도지코인', 'DOGE/USD'],
    ['memecoin', family.memecoin, '페페', 'PEPE/USD'],
    ['memecoin', family.memecoin, '봉크', 'BONK/USD'],
    ['real_estate', family.real_estate, 'vnq', 'VNQ'],
  ] as const)('%s resolves the synonym', async (_id, adapter, mention, ticker) => {
    const r = await adapter.resolveEntity(mention, 'ko')
    expect(r).toMatchObject({ ok: true, entity_id: ticker })
  })

  it('a prefix mention clarifies instead of silently resolving', async () => {
    const r = await family.crypto.resolveEntity('비트', 'ko')
    // '비트' is an exact synonym for BTC — not a prefix-only case.
    expect(r).toMatchObject({ ok: true, entity_id: 'BTC/USD' })
    const prefix = await family.fx.resolveEntity('달러', 'ko')
    expect(prefix.ok).toBe(false)
    if (!prefix.ok && 'need' in prefix) {
      expect(prefix.need.options?.map((o) => o.id).sort()).toEqual(['USD/CNH', 'USD/JPY', 'USD/KRW'])
    } else {
      throw new Error('expected clarify chips for 달러')
    }
  })

  it('KR viewer is refused TQQQ at resolveEntity but still resolves SPY', async () => {
    const kr = { userId: 'u', isAdmin: false, jurisdiction: { declaredCountry: 'KR', ipCountry: 'KR' } }
    const tqqq = await family.index_etf.resolveEntity('TQQQ', 'en', kr)
    expect(tqqq.ok).toBe(false)
    if (!tqqq.ok && 'refuse' in tqqq) expect(tqqq.refuse.code).toBe('jurisdiction_blocked')
    const spy = await family.index_etf.resolveEntity('SPY', 'en', kr)
    expect(spy).toMatchObject({ ok: true, entity_id: 'SPY' })
    const us = { userId: 'u', isAdmin: false, jurisdiction: { ipCountry: 'US' } }
    expect(await family.index_etf.resolveEntity('TQQQ', 'en', us)).toMatchObject({ ok: true, entity_id: 'TQQQ' })
  })
})

describe('price-series family — compose matches the catalog chip path', () => {
  const NOW = new Date('2026-08-28T09:00:00.000Z')

  it.each([
    ['index_etf', family.index_etf, 'SPY'],
    ['gold_metals', family.gold_metals, 'XAU/USD'],
    ['commodities_energy', family.commodities_energy, 'WTI/USD'],
    ['fx', family.fx, 'EUR/USD'],
    ['crypto', family.crypto, 'BTC/USD'],
    ['memecoin', family.memecoin, 'DOGE/USD'],
    ['real_estate', family.real_estate, 'VNQ'],
  ] as const)('%s compose equals buildCatalogRankedRoundInput', (_id, adapter, ticker) => {
    const composed = adapter.composeProposition(slots(adapter, ticker), NOW)
    expect(composed).toEqual(buildCatalogRankedRoundInput(ticker, '1d', NOW))
    expect(composed.proposition_text).toContain(ticker)
  })
})

describe('price-series family — real_estate refusals', () => {
  it('refuses a specific-property mention with the Korean copy already in refusal-copy', async () => {
    const r = await family.real_estate.resolveEntity('강남 아파트 시세', 'ko')
    expect(r.ok).toBe(false)
    if (!r.ok && 'refuse' in r) {
      expect(r.refuse.code).toBe('specific_property')
      expect(refusalMessageForKey(r.refuse.message_i18n_key, 'ko')).toBe(
        '특정 부동산(주소·매물)에 대한 가치 판단은 제공하지 않습니다.',
      )
      assertApprovedCopy(refusalMessageForKey(r.refuse.message_i18n_key, 'ko'))
    } else {
      throw new Error('expected specific_property')
    }
  })

  it('refuses brokerage framing', async () => {
    const r = await family.real_estate.resolveEntity('리츠 매수추천', 'ko')
    expect(r.ok).toBe(false)
    if (!r.ok && 'refuse' in r) {
      expect(r.refuse.code).toBe('brokerage_advice')
      expect(refusalMessageForKey(r.refuse.message_i18n_key, 'ko')).toBe(
        '중개·매매 권유에 해당하는 질문은 제공하지 않습니다.',
      )
    } else {
      throw new Error('expected brokerage_advice')
    }
  })

  it('still opens a REIT ticker', async () => {
    expect(await family.real_estate.resolveEntity('SCHH', 'en')).toMatchObject({ ok: true, entity_id: 'SCHH' })
  })
})

describe('price-series family — packet predicates', () => {
  it('crypto and memecoin request the free positioning feeds; gold/fx/energy do not', () => {
    expect(wantsCryptoContext('crypto_spot')).toBe(true)
    expect(wantsCryptoContext('memecoin')).toBe(true)
    expect(wantsCryptoContext('fx')).toBe(false)
    expect(wantsCryptoContext('gold_metal')).toBe(false)
    expect(wantsConsensus('etf_index')).toBe(true)
    expect(wantsConsensus('real_estate')).toBe(false)
  })
})

describe('price-series family — clocks', () => {
  it('index / REIT chips use trading sessions; crypto / FX / gold-spot / energy use calendar days', () => {
    expect(usesTradingSessions(family.index_etf.ledger_category)).toBe(true)
    expect(usesTradingSessions(family.real_estate.ledger_category)).toBe(true)
    expect(usesTradingSessions(family.crypto.ledger_category)).toBe(false)
    expect(usesTradingSessions(family.fx.ledger_category)).toBe(false)
    expect(usesTradingSessions(family.gold_metals.ledger_category)).toBe(false)
    expect(usesTradingSessions(family.commodities_energy.ledger_category)).toBe(false)
    expect(usesTradingSessions(family.memecoin.ledger_category)).toBe(false)
  })

  it('GLD / SLV / UNG override onto the NYSE session clock; XAU/XAG/WTI stay calendar', () => {
    expect(usesTradingSessions('gold_metal', 'GLD')).toBe(true)
    expect(usesTradingSessions('gold_metal', 'SLV')).toBe(true)
    expect(usesTradingSessions('gold_metal', 'XAU/USD')).toBe(false)
    expect(usesTradingSessions('gold_metal', 'XPT/USD')).toBe(false)
    expect(usesTradingSessions('gold_metal', 'XAG/USD')).toBe(false)
    expect(usesTradingSessions('commodity_energy', 'UNG')).toBe(true)
    expect(usesTradingSessions('commodity_energy', 'CPER')).toBe(true)
    expect(usesTradingSessions('commodity_energy', 'CORN')).toBe(true)
    expect(usesTradingSessions('commodity_energy', 'WTI/USD')).toBe(false)
  })
})
