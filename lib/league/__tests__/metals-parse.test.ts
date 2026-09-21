import { describe, expect, it } from 'vitest'
import {
  holdingsFromShares,
  parseCftcManagedMoney,
  parseFredCsvLast,
  parseIsharesSharesOutstanding,
  parseSpdrGoldData,
  parseTreasuryRealYield10y,
  parseTreasuryRealYieldCsv,
  parseTwelveDataSharesOutstanding,
  SLV_OZ_PER_SHARE,
  splitCsvLine,
} from '../metals-parse'

/** Captured from CFTC f_disagg.txt 2026-09-08 gold row (first 15 columns). */
const GOLD_COT_PREFIX =
  '"GOLD - COMMODITY EXCHANGE INC.",260908,2026-09-08,088691,CMX,01,088,411227,16588,47549,14542,253855,23273,145804,10832'

describe('CFTC disagg parser', () => {
  it('reads managed-money long/short/net from the documented columns', () => {
    const parsed = parseCftcManagedMoney(GOLD_COT_PREFIX, '088691')
    expect(parsed).toEqual({
      contract: 'GOLD - COMMODITY EXCHANGE INC.',
      date: '2026-09-08',
      openInterest: 411227,
      managedMoneyLong: 145804,
      managedMoneyShort: 10832,
      managedMoneyNet: 134972,
    })
  })

  it('returns null for a different contract code', () => {
    expect(parseCftcManagedMoney(GOLD_COT_PREFIX, '084691')).toBeNull()
  })

  it('parses NYMEX platinum (076651) from the same disagg layout', () => {
    const platinum =
      '"PLATINUM - NEW YORK MERCANTILE EXCHANGE",260915,2026-09-15,076651,NYME,01,076,65478,2832,14801,16263,0,0,15220,3100'
    const parsed = parseCftcManagedMoney(platinum, '076651')
    expect(parsed).toEqual({
      contract: 'PLATINUM - NEW YORK MERCANTILE EXCHANGE',
      date: '2026-09-15',
      openInterest: 65478,
      managedMoneyLong: 15220,
      managedMoneyShort: 3100,
      managedMoneyNet: 12120,
    })
  })

  it('splitCsvLine keeps the quoted market name intact', () => {
    expect(splitCsvLine(GOLD_COT_PREFIX)[0]).toBe('GOLD - COMMODITY EXCHANGE INC.')
    expect(splitCsvLine(GOLD_COT_PREFIX)[3]).toBe('088691')
  })
})

describe('Treasury real-yield parsers', () => {
  it('picks the latest 10 YR from the daily CSV', () => {
    const csv = [
      'Date,"5 YR","7 YR","10 YR","20 YR","30 YR"',
      '09/10/2026,2.29,2.41,2.55,2.87,3.05',
      '09/11/2026,2.38,2.48,2.60,2.89,3.07',
    ].join('\n')
    expect(parseTreasuryRealYieldCsv(csv)).toEqual({ date: '2026-09-11', yieldPct: 2.6 })
  })

  it('picks the latest TC_10YEAR from a namespace-stripped Atom feed', () => {
    const xml = {
      feed: {
        entry: [
          { content: { properties: { NEW_DATE: '2026-09-10T00:00:00', TC_10YEAR: 1.81 } } },
          { content: { properties: { NEW_DATE: '2026-09-11T00:00:00', TC_10YEAR: 1.82 } } },
        ],
      },
    }
    expect(parseTreasuryRealYield10y(xml)).toEqual({ date: '2026-09-11', yieldPct: 1.82 })
  })
})

describe('FRED / SPDR / iShares metals parsers', () => {
  it('picks the last numeric FRED observation and skips dots', () => {
    const csv = ['DATE,GVZCLS', '2026-09-15,26.90', '2026-09-16,.', '2026-09-17,24.98'].join('\n')
    expect(parseFredCsvLast(csv)).toEqual({ date: '2026-09-17', value: 24.98 })
  })

  it('reads official SPDR GLD JSON ounces and tonnes', () => {
    const parsed = parseSpdrGoldData({
      data: {
        total_ounces: { value: '33,987,513.34', date: 'September 18, 2026' },
        total_tonnes: { value: '1,057.122', date: 'September 18, 2026' },
        shares_outstanding: { value: '370,600,000', date: 'September 18, 2026' },
      },
    })
    expect(parsed).toMatchObject({
      date: '2026-09-18',
      ounces: 33987513.34,
      tonnes: 1057.122,
      source: 'SPDR Gold Shares api.spdrgoldshares.com',
    })
  })

  it('reads iShares HTML-escaped sharesOutstanding and converts to ounces', () => {
    const html =
      'sharesOutstanding&quot;:{&quot;visible&quot;:true,&quot;label&quot;:&quot;Shares Outstanding&quot;,&quot;formattedValue&quot;:&quot;541,850,000&quot;,&quot;sortOrder&quot;:44,&quot;prefix&quot;:null,&quot;infoBubble&quot;:&quot;&quot;,&quot;formattedAsOfDate&quot;:&quot;Sep 18, 2026&quot;}'
    const shares = parseIsharesSharesOutstanding(html)
    expect(shares).toEqual({ date: '2026-09-18', shares: 541850000 })
    const holdings = holdingsFromShares(shares!.date, shares!.shares, SLV_OZ_PER_SHARE, 'test')
    expect(holdings?.ounces).toBeCloseTo(541850000 * 0.92)
  })

  it('reads Twelve Data shares_outstanding when the quote carries it', () => {
    expect(parseTwelveDataSharesOutstanding({ shares_outstanding: 370600000 })).toBe(370600000)
    expect(parseTwelveDataSharesOutstanding({ name: 'SPDR Gold Shares' })).toBeNull()
  })
})
