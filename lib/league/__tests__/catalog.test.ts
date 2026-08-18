import { describe, expect, it } from 'vitest'
import {
  CATALOG_INSTRUMENT_IDS,
  PUBLIC_CATALOG,
  PUBLIC_CATEGORY_IDS,
  defaultCatalogCategoryId,
  findCatalogInstrument,
} from '../catalog'
import { LEAGUE_LOCALES, LEAGUE_SELECTABLE_LOCALES } from '../i18n/locales'
import { getLeagueUiPack } from '../i18n/dictionary'

const FINANCIAL = [
  'crypto',
  'stocks',
  'fx',
  'gold_metals',
  'index_etf',
  'commodities_energy',
  'memecoin',
  'real_estate',
] as const

const COMING_SOON = ['sports', 'politics_election', 'entertainment', 'macro_econ'] as const

describe('PUBLIC_CATALOG', () => {
  it('is exactly the 12 final public categories, in the product order', () => {
    expect(PUBLIC_CATALOG.map((c) => c.id)).toEqual([...PUBLIC_CATEGORY_IDS])
    expect(PUBLIC_CATEGORY_IDS).toHaveLength(12)
  })

  it('maps each public id onto a ledger category and a tone', () => {
    expect(PUBLIC_CATALOG.find((c) => c.id === 'stocks')?.ledgerCategory).toBe('stock')
    expect(PUBLIC_CATALOG.find((c) => c.id === 'crypto')?.ledgerCategory).toBe('crypto_spot')
    expect(PUBLIC_CATALOG.find((c) => c.id === 'gold_metals')?.ledgerCategory).toBe('gold_metal')
    expect(PUBLIC_CATALOG.find((c) => c.id === 'index_etf')?.ledgerCategory).toBe('etf_index')
    expect(PUBLIC_CATALOG.find((c) => c.id === 'entertainment')?.ledgerCategory).toBe('entertainment_awards')
    expect(PUBLIC_CATALOG.find((c) => c.id === 'real_estate')?.ledgerCategory).toBe('real_estate')
    expect(PUBLIC_CATALOG.find((c) => c.id === 'macro_econ')?.tone).toBe('green')
    expect(PUBLIC_CATALOG.find((c) => c.id === 'sports')?.tone).toBe('red')
    expect(PUBLIC_CATALOG.find((c) => c.id === 'politics_election')?.tone).toBe('yellow')
  })

  it('gives financial categories flagship chips and non-financial ones a coming-soon placeholder', () => {
    for (const id of FINANCIAL) {
      const c = PUBLIC_CATALOG.find((row) => row.id === id)!
      expect(c.kind).toBe('instruments')
      expect(c.instruments.length).toBeGreaterThan(0)
      expect(c.instruments.length).toBeLessThanOrEqual(40)
    }
    for (const id of COMING_SOON) {
      const c = PUBLIC_CATALOG.find((row) => row.id === id)!
      expect(c.kind).toBe('coming_soon')
      expect(c.instruments).toEqual([])
    }
  })

  it('keeps instrument ids unique and includes the existing AAPL / BTC/USD / EUR/USD keys', () => {
    expect(new Set(CATALOG_INSTRUMENT_IDS).size).toBe(CATALOG_INSTRUMENT_IDS.length)
    expect(CATALOG_INSTRUMENT_IDS).toContain('AAPL')
    expect(CATALOG_INSTRUMENT_IDS).toContain('BTC/USD')
    expect(CATALOG_INSTRUMENT_IDS).toContain('EUR/USD')
    expect(findCatalogInstrument('AAPL')?.category.id).toBe('stocks')
  })

  it('defaults the Cards tab to stocks when that category is visible', () => {
    expect(defaultCatalogCategoryId(PUBLIC_CATALOG)).toBe('stocks')
    expect(defaultCatalogCategoryId(PUBLIC_CATALOG.filter((c) => c.id !== 'stocks'))).toBe('crypto')
  })
})

describe('catalog i18n', () => {
  it('every locale has a human label for every public category and instrument', () => {
    for (const locale of LEAGUE_LOCALES) {
      const pack = getLeagueUiPack(locale)
      for (const id of PUBLIC_CATEGORY_IDS) {
        expect(pack.catalog.categories[id].trim().length).toBeGreaterThan(0)
        expect(pack.catalog.categories[id]).not.toBe(id)
      }
      for (const instrument of CATALOG_INSTRUMENT_IDS) {
        const label = pack.catalog.instruments[instrument]
        expect(label, `${locale} missing ${instrument}`).toBeTruthy()
        expect(label.trim().length).toBeGreaterThan(0)
      }
      expect(pack.disclaimer.realEstate.trim().length).toBeGreaterThan(0)
    }
  })

  it('selectable locales do not show raw ledger keys as category labels', () => {
    for (const locale of LEAGUE_SELECTABLE_LOCALES) {
      const labels = Object.values(getLeagueUiPack(locale).catalog.categories)
      expect(labels).not.toContain('gold_metal')
      expect(labels).not.toContain('etf_index')
      expect(labels).not.toContain('entertainment_awards')
    }
  })
})
