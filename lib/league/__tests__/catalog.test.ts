import { describe, expect, it } from 'vitest'
import {
  CATALOG_INSTRUMENT_IDS,
  PUBLIC_CATALOG,
  PUBLIC_CATEGORY_IDS,
  defaultCatalogCategoryId,
  buildCatalogRankedRoundInput,
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

  it('builds a server-owned ranked round for a catalog instrument with no existing card', () => {
    const now = new Date('2026-08-24T09:00:00.000Z')
    const input = buildCatalogRankedRoundInput('VNQ', '1d', now)
    expect(input).toMatchObject({
      instrument: 'VNQ',
      category: 'real_estate',
      horizon: '1d',
      item_type: 'ranked',
      cache_key: 'daily|VNQ|1d|2026-08-24',
    })
    expect(input?.proposition_text).toContain('VNQ')
    expect(input?.resolution_rule).toContain('VNQ')
    expect(buildCatalogRankedRoundInput('NOT-A-SYMBOL', '1d', now)).toBeNull()
  })

  it('stores the selected horizon code VERBATIM (one vocabulary, no translation) for all 4', () => {
    const now = new Date('2026-08-24T09:00:00.000Z')
    for (const h of ['1d', '1w', '1m', '3m'] as const) {
      const input = buildCatalogRankedRoundInput('AAPL', h, now)
      expect(input?.horizon).toBe(h)
      expect(input?.cache_key.split('|')[2]).toBe(h)
    }
  })

  it('names the ACTUAL resolve date in the proposition — never a relative phrase, never disagreeing with resolves_at', () => {
    const now = new Date('2026-08-21T20:00:00.000Z') // a Friday
    const input = buildCatalogRankedRoundInput('AAPL', '1m', now)
    expect(input).not.toBeNull()
    const resolveDate = input!.resolves_at.slice(0, 10)
    expect(input!.proposition_text).toContain(`by ${resolveDate}`)
    expect(input!.proposition_text).not.toMatch(/trading day/i)
    expect(input!.proposition_text).not.toMatch(/next 1 month/i)
  })

  it('surfaces the weekday-approximation disclosure on the proposition for a trading-session horizon beyond 1d', () => {
    const now = new Date('2026-08-21T20:00:00.000Z')
    const oneMonth = buildCatalogRankedRoundInput('AAPL', '1m', now)
    expect(oneMonth!.proposition_text).toMatch(/weekday/)
    expect(oneMonth!.proposition_text).toMatch(/holiday calendar/)

    // 1d: no disclosure (an off-by-one-holiday shift is immaterial to a next-session round).
    const oneDay = buildCatalogRankedRoundInput('AAPL', '1d', now)
    expect(oneDay!.proposition_text).not.toMatch(/weekday/)

    // A calendar-day category (crypto) never carries the disclosure at any horizon.
    const crypto = buildCatalogRankedRoundInput('BTC/USD', '3m', now)
    expect(crypto!.proposition_text).not.toMatch(/weekday/)
  })
})
