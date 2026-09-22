import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  CATALOG_INSTRUMENT_IDS,
  KR_LEVERAGE_DENIED_GROUPS,
  PUBLIC_CATALOG,
  PUBLIC_CATEGORY_IDS,
  categoryHasMixedResolutionClocks,
  defaultCatalogCategoryId,
  buildCatalogRankedRoundInput,
  findCatalogInstrument,
  isCatalogInstrumentAllowed,
  visibleChipEntries,
  visibleChipEntriesForViewer,
  type CatalogInstrument,
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

  it('gold_metals chips are XAU/USD, XAG/USD, XPT/USD, GLD, SLV — spots and ETFs side by side; ETFs filed by underlying', () => {
    const gold = PUBLIC_CATALOG.find((c) => c.id === 'gold_metals')!
    expect(gold.instruments.map((i) => i.instrument)).toEqual(['XAU/USD', 'XAG/USD', 'XPT/USD', 'GLD', 'SLV'])
    expect(CATALOG_INSTRUMENT_IDS).toContain('XAG/USD')
    expect(CATALOG_INSTRUMENT_IDS).toContain('XPT/USD')
    expect(findCatalogInstrument('GLD')?.category.id).toBe('gold_metals')
    expect(findCatalogInstrument('SLV')?.category.id).toBe('gold_metals')
    expect(findCatalogInstrument('XAG/USD')?.category.ledgerCategory).toBe('gold_metal')
    expect(findCatalogInstrument('XPT/USD')?.entry.expected_name).toEqual(['Platinum', 'Spot'])
    const index = PUBLIC_CATALOG.find((c) => c.id === 'index_etf')!
    expect(index.instruments.map((i) => i.instrument)).toEqual([
      'SPY',
      'QQQ',
      'DIA',
      'EWJ',
      'EWY',
      'FEZ',
      'EWT',
      'TQQQ',
      'SQQQ',
      'SOXL',
      'UPRO',
      'SPXU',
    ])
    expect(index.instruments.map((i) => i.instrument)).not.toContain('GLD')
    expect(CATALOG_INSTRUMENT_IDS).not.toContain('SPX')
    expect(CATALOG_INSTRUMENT_IDS).not.toContain('NDX')
    expect(CATALOG_INSTRUMENT_IDS).not.toContain('DJI')
    expect(CATALOG_INSTRUMENT_IDS).not.toContain('SPXS')
  })

  it('fx chips are 6 USD-majors plus 3 non-USD crosses', () => {
    const fx = PUBLIC_CATALOG.find((c) => c.id === 'fx')!
    expect(fx.instruments.map((i) => i.instrument)).toEqual([
      'EUR/USD',
      'USD/KRW',
      'USD/JPY',
      'GBP/USD',
      'USD/CNH',
      'AUD/USD',
      'JPY/KRW',
      'EUR/JPY',
      'GBP/JPY',
    ])
    expect(findCatalogInstrument('JPY/KRW')?.entry.expected_name).toEqual(['Yen', 'Won'])
    expect(findCatalogInstrument('EUR/JPY')?.entry.expected_name).toEqual(['Euro', 'Yen'])
    expect(findCatalogInstrument('GBP/USD')?.entry.resolution_rule).toMatch(/spot/)
    expect(findCatalogInstrument('USD/CNH')?.entry.expected_name).toEqual(['Yuan'])
  })

  it('commodities_energy chips are WTI/Brent/UNG plus copper/grains/coffee ETFs', () => {
    const energy = PUBLIC_CATALOG.find((c) => c.id === 'commodities_energy')!
    expect(energy.instruments.map((i) => i.instrument)).toEqual([
      'WTI/USD',
      'XBR/USD',
      'UNG',
      'CPER',
      'CORN',
      'WEAT',
      'SOYB',
      'COFF',
    ])
    expect(CATALOG_INSTRUMENT_IDS).not.toContain('WTICO/USD')
    expect(CATALOG_INSTRUMENT_IDS).not.toContain('NATGAS/USD')
    expect(CATALOG_INSTRUMENT_IDS).not.toContain('JO')
    expect(findCatalogInstrument('UNG')?.entry.resolution_rule).toMatch(/regular-session/)
    expect(findCatalogInstrument('CPER')?.entry.resolution_rule).toMatch(/regular-session/)
    expect(findCatalogInstrument('CORN')?.entry.expected_name).toEqual(['Corn'])
    expect(findCatalogInstrument('COFF')?.entry.expected_name).toEqual(['Coffee'])
    expect(findCatalogInstrument('WTI/USD')?.entry.resolution_rule).toMatch(/spot/)
  })

  it('every catalog chip declares expected_name and none is a poison ticker', () => {
    for (const id of CATALOG_INSTRUMENT_IDS) {
      const entry = findCatalogInstrument(id)!.entry
      expect(entry.expected_name.length, id).toBeGreaterThan(0)
    }
    expect(CATALOG_INSTRUMENT_IDS).not.toContain('SPX')
    expect(CATALOG_INSTRUMENT_IDS).not.toContain('NDX')
    expect(CATALOG_INSTRUMENT_IDS).not.toContain('DJI')
    expect(CATALOG_INSTRUMENT_IDS).not.toContain('SPXS')
  })

  it('gates Layer-2 leverage/inverse with deniedGroups KR; Layer 1 has no deny list', () => {
    const index = PUBLIC_CATALOG.find((c) => c.id === 'index_etf')!
    const layer1 = ['SPY', 'QQQ', 'DIA', 'EWJ', 'EWY', 'FEZ', 'EWT']
    const layer2 = ['TQQQ', 'SQQQ', 'SOXL', 'UPRO', 'SPXU']
    for (const id of layer1) {
      expect(findCatalogInstrument(id)!.entry.deniedGroups, id).toBeUndefined()
    }
    for (const id of layer2) {
      expect(findCatalogInstrument(id)!.entry.deniedGroups, id).toEqual(KR_LEVERAGE_DENIED_GROUPS)
    }
    const kr = { isAdmin: false, jurisdiction: { declaredCountry: 'KR', ipCountry: 'KR' } }
    const us = { isAdmin: false, jurisdiction: { declaredCountry: 'US', ipCountry: 'US' } }
    const krChips = visibleChipEntriesForViewer(index, kr).map((i) => i.instrument)
    const usChips = visibleChipEntriesForViewer(index, us).map((i) => i.instrument)
    expect(krChips).toEqual(layer1)
    expect(usChips).toEqual([...layer1, ...layer2])
    expect(isCatalogInstrumentAllowed('SPY', kr.jurisdiction)).toBe(true)
    expect(isCatalogInstrumentAllowed('TQQQ', kr.jurisdiction)).toBe(false)
    expect(isCatalogInstrumentAllowed('TQQQ', us.jurisdiction)).toBe(true)
    expect(isCatalogInstrumentAllowed('SPY', { declaredCountry: 'KR', ipCountry: 'US' })).toBe(true)
    expect(isCatalogInstrumentAllowed('TQQQ', { declaredCountry: 'KR', ipCountry: 'US' })).toBe(false)
    expect(isCatalogInstrumentAllowed('TQQQ', { declaredCountry: 'US', ipCountry: 'KR' })).toBe(false)
    expect(visibleChipEntriesForViewer(index, { isAdmin: true, jurisdiction: kr.jurisdiction }).map((i) => i.instrument)).toEqual(
      [...layer1, ...layer2],
    )
    expect(PUBLIC_CATALOG.find((c) => c.id === 'gold_metals')!.instruments.map((i) => i.instrument)).toEqual([
      'XAU/USD',
      'XAG/USD',
      'XPT/USD',
      'GLD',
      'SLV',
    ])
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

  it('separates catalog membership from chip visibility', () => {
    for (const category of PUBLIC_CATALOG) {
      for (const entry of category.instruments) {
        expect(entry.chip_visible).toBe(true)
      }
    }
    const hidden: CatalogInstrument = {
      instrument: 'HIDDEN-ROTATED',
      resolution_rule: 'keeps historical rounds',
      chip_visible: false,
      expected_name: ['Hidden'],
    }
    const shown: CatalogInstrument = {
      instrument: 'SHOWN',
      resolution_rule: 'on the rail',
      chip_visible: true,
      expected_name: ['Shown'],
    }
    expect(visibleChipEntries({ ...PUBLIC_CATALOG[2]!, instruments: [hidden, shown] }).map((i) => i.instrument)).toEqual(
      ['SHOWN'],
    )
    expect(findCatalogInstrument('AAPL')).not.toBeNull()
    expect(CATALOG_INSTRUMENT_IDS).toContain('AAPL')
    expect(buildCatalogRankedRoundInput('AAPL', '1d', new Date('2026-08-24T09:00:00.000Z'))?.instrument).toBe('AAPL')
  })

  it('grading, record room, and generate auth stay on catalog membership — not chip visibility', () => {
    const room = readFileSync(join(__dirname, '../record-room.ts'), 'utf8')
    const access = readFileSync(join(__dirname, '../public-access.ts'), 'utf8')
    const policy = readFileSync(join(__dirname, '../access-policy.ts'), 'utf8')
    expect(room).not.toMatch(/chip_visible/)
    expect(access).toContain('CATALOG_INSTRUMENT_IDS')
    expect(access).toContain('isCuratedInstrument')
    expect(policy).toContain('findCatalogInstrument')
    expect(policy).not.toMatch(/chip_visible/)
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
      expect(pack.catalog.spotVsEtfNote.trim().length).toBeGreaterThan(0)
      expect(pack.predictions.heading.trim().length).toBeGreaterThan(0)
    }
    expect(getLeagueUiPack('en').catalog.instruments['XAU/USD']).toBe('Gold spot')
    expect(getLeagueUiPack('en').catalog.instruments.GLD).toBe('Gold ETF')
    expect(getLeagueUiPack('ko').catalog.instruments['XAU/USD']).toBe('금 현물')
    expect(getLeagueUiPack('ko').catalog.instruments.GLD).toBe('금 ETF')
    expect(getLeagueUiPack('ko').catalog.instruments['XPT/USD']).toBe('백금 현물')
    expect(getLeagueUiPack('ko').catalog.instruments.CPER).toBe('구리')
    expect(getLeagueUiPack('ko').catalog.instruments.CORN).toBe('옥수수')
    expect(getLeagueUiPack('ko').catalog.instruments.WEAT).toBe('밀')
    expect(getLeagueUiPack('ko').catalog.instruments.SOYB).toBe('대두')
    expect(getLeagueUiPack('ko').catalog.instruments.COFF).toBe('커피')
    expect(getLeagueUiPack('ko').catalog.instruments['JPY/KRW']).toBe('엔/원')
    expect(getLeagueUiPack('ko').catalog.instruments['GBP/USD']).toBe('파운드/달러')
    expect(getLeagueUiPack('ko').catalog.instruments['USD/CNH']).toBe('달러/위안')
    expect(getLeagueUiPack('ko').catalog.instruments.EWY).toBe('한국 ETF (EWY)')
    expect(getLeagueUiPack('ko').catalog.instruments.TQQQ).toBe('나스닥 3배 (TQQQ)')
  })

  it('spot vs ETF note is shown for mixed-clock categories, not for session-only or calendar-only', () => {
    expect(categoryHasMixedResolutionClocks(PUBLIC_CATALOG.find((c) => c.id === 'gold_metals')!)).toBe(true)
    expect(categoryHasMixedResolutionClocks(PUBLIC_CATALOG.find((c) => c.id === 'commodities_energy')!)).toBe(true)
    expect(categoryHasMixedResolutionClocks(PUBLIC_CATALOG.find((c) => c.id === 'stocks')!)).toBe(false)
    expect(categoryHasMixedResolutionClocks(PUBLIC_CATALOG.find((c) => c.id === 'crypto')!)).toBe(false)
    expect(categoryHasMixedResolutionClocks(PUBLIC_CATALOG.find((c) => c.id === 'fx')!)).toBe(false)
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

    // REIT ETFs share the equity session clock — same disclosure as AAPL.
    const reit = buildCatalogRankedRoundInput('VNQ', '1m', now)
    expect(reit!.proposition_text).toMatch(/weekday/)

    // GLD/SLV share the equity session clock; XAU/XAG stay on calendar days.
    const gld = buildCatalogRankedRoundInput('GLD', '1m', now)
    expect(gld!.proposition_text).toMatch(/weekday/)
    const slv = buildCatalogRankedRoundInput('SLV', '1m', now)
    expect(slv!.proposition_text).toMatch(/weekday/)
    const xau = buildCatalogRankedRoundInput('XAU/USD', '1m', now)
    expect(xau!.proposition_text).not.toMatch(/weekday/)
    const xag = buildCatalogRankedRoundInput('XAG/USD', '1m', now)
    expect(xag!.proposition_text).not.toMatch(/weekday/)
    const xpt = buildCatalogRankedRoundInput('XPT/USD', '1m', now)
    expect(xpt!.proposition_text).not.toMatch(/weekday/)
    const ung = buildCatalogRankedRoundInput('UNG', '1m', now)
    expect(ung!.proposition_text).toMatch(/weekday/)
    const wti = buildCatalogRankedRoundInput('WTI/USD', '1m', now)
    expect(wti!.proposition_text).not.toMatch(/weekday/)
  })
})
