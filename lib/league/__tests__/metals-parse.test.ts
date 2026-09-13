import { describe, expect, it } from 'vitest'
import {
  parseCftcManagedMoney,
  parseTreasuryRealYield10y,
  parseTreasuryRealYieldCsv,
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
