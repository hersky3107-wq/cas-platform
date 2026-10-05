import { describe, expect, it } from 'vitest'
import {
  cotHistoryStats,
  etfFlowFromBars,
  eventsInWindow,
  fredChangeFromObservations,
  holdingsFromShares,
  parseBlsReleaseDates,
  parseCftcManagedMoney,
  parseCftcSocrataRows,
  parseFomcMeetingDates,
  parseFredApiObservations,
  parseFredCsvLast,
  parseFredCsvObservations,
  parseIsharesSharesOutstanding,
  parseSpdrGoldData,
  parseTreasuryRealYield10y,
  parseTreasuryRealYieldCsv,
  parseTwelveDataBars,
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

describe('FRED change snapshot', () => {
  it('computes latest plus 1w and 1m change from dated observations', () => {
    const obs = parseFredCsvObservations(
      [
        'DATE,DFII10',
        '2026-08-28,1.90',
        '2026-09-04,1.95',
        '2026-09-25,2.10',
        '2026-10-02,2.05',
        '2026-10-03,.',
      ].join('\n'),
    )
    expect(obs.map((o) => o.date)).toEqual(['2026-08-28', '2026-09-04', '2026-09-25', '2026-10-02'])
    expect(fredChangeFromObservations('DFII10', obs)).toEqual({
      seriesId: 'DFII10',
      date: '2026-10-02',
      value: 2.05,
      change1w: -0.05,
      change1m: 0.15,
      date1w: '2026-09-25',
      date1m: '2026-08-28',
    })
  })

  it('leaves change null when there is no prior print — does not invent', () => {
    const snap = fredChangeFromObservations('DFF', [{ date: '2026-10-02', value: 3.88 }])
    expect(snap).toEqual({
      seriesId: 'DFF',
      date: '2026-10-02',
      value: 3.88,
      change1w: null,
      change1m: null,
      date1w: null,
      date1m: null,
    })
  })

  it('reads FRED API observations and skips dots', () => {
    expect(
      parseFredApiObservations({
        observations: [
          { date: '2026-10-01', value: '4.09' },
          { date: '2026-10-02', value: '.' },
          { date: '2026-10-03', value: '4.10' },
        ],
      }),
    ).toEqual([
      { date: '2026-10-01', value: 4.09 },
      { date: '2026-10-03', value: 4.1 },
    ])
  })
})

describe('CFTC history stats', () => {
  it('computes 4w change and 3y percentile from Socrata rows', () => {
    const json = [
      { report_date_as_yyyy_mm_dd: '2026-09-01', cftc_contract_market_code: '088691', market_and_exchange_names: 'GOLD', open_interest_all: '400000', m_money_positions_long_all: '100000', m_money_positions_short_all: '20000' },
      { report_date_as_yyyy_mm_dd: '2026-09-08', cftc_contract_market_code: '088691', market_and_exchange_names: 'GOLD', open_interest_all: '401000', m_money_positions_long_all: '110000', m_money_positions_short_all: '20000' },
      { report_date_as_yyyy_mm_dd: '2026-09-15', cftc_contract_market_code: '088691', market_and_exchange_names: 'GOLD', open_interest_all: '402000', m_money_positions_long_all: '120000', m_money_positions_short_all: '20000' },
      { report_date_as_yyyy_mm_dd: '2026-09-22', cftc_contract_market_code: '088691', market_and_exchange_names: 'GOLD', open_interest_all: '403000', m_money_positions_long_all: '130000', m_money_positions_short_all: '20000' },
      { report_date_as_yyyy_mm_dd: '2026-09-29', cftc_contract_market_code: '088691', market_and_exchange_names: 'GOLD', open_interest_all: '404000', m_money_positions_long_all: '140000', m_money_positions_short_all: '20000' },
      { report_date_as_yyyy_mm_dd: '2026-09-29', cftc_contract_market_code: '084691', market_and_exchange_names: 'SILVER', open_interest_all: '1', m_money_positions_long_all: '1', m_money_positions_short_all: '1' },
    ]
    const rows = parseCftcSocrataRows(json, '088691')
    expect(rows).toHaveLength(5)
    expect(rows[4]).toMatchObject({ date: '2026-09-29', managedMoneyNet: 120000 })
    const stats = cotHistoryStats(rows)!
    expect(stats.change4w).toBe(40000)
    expect(stats.percentile3y).toBe(100)
    expect(stats.historyWeeks).toBe(5)
  })

  it('omits 4w change when history is too short', () => {
    const stats = cotHistoryStats([
      { date: '2026-09-29', contract: 'GOLD', code: '088691', openInterest: 1, managedMoneyLong: 2, managedMoneyShort: 1, managedMoneyNet: 1 },
    ])
    expect(stats).toEqual({ change4w: null, percentile3y: 100, historyWeeks: 1 })
  })
})

describe('ETF flow proxy', () => {
  it('reads Twelve Data bars and computes 5d/20d price and volume vs 20d', () => {
    const values = Array.from({ length: 21 }, (_, i) => ({
      datetime: `2026-09-${String(10 + i).padStart(2, '0')}`,
      close: String(300 + i),
      volume: String(1_000_000 + i * 10_000),
    }))
    values[20]!.datetime = '2026-09-30'
    const bars = parseTwelveDataBars({ values })
    const flow = etfFlowFromBars('GLD', bars, 'Twelve Data /time_series volume+close')!
    expect(flow.date).toBe('2026-09-30')
    expect(flow.lastClose).toBe(320)
    expect(flow.change5dPct).not.toBeNull()
    expect(flow.change20dPct).not.toBeNull()
    expect(flow.volumeVs20dPct).not.toBeNull()
  })

  it('returns null on empty bars — does not invent a flow', () => {
    expect(etfFlowFromBars('SLV', [], 'x')).toBeNull()
  })
})

describe('macro calendar parsers', () => {
  it('reads FOMC decision-day dates from a year block', () => {
    const html = `
      <h4>2026 FOMC Meetings</h4>
      <p>January 27-28</p>
      <p>March 17-18</p>
      <p>October 27-28</p>
    `
    const events = parseFomcMeetingDates(html, 2026)
    expect(events.map((e) => e.date)).toEqual(['2026-01-28', '2026-03-18', '2026-10-28'])
    expect(events.every((e) => e.name === 'FOMC')).toBe(true)
  })

  it('reads BLS CPI dates and windows them; empty window is none measured not invented', () => {
    const html = 'Released October 15, 2026. Next November 13, 2026.'
    const events = parseBlsReleaseDates(html, 'CPI')
    expect(events.map((e) => e.date)).toEqual(['2026-10-15', '2026-11-13'])
    expect(eventsInWindow(events, '2026-10-05', '2026-10-12')).toEqual([])
    expect(eventsInWindow(events, '2026-10-05', '2026-10-16').map((e) => e.date)).toEqual(['2026-10-15'])
  })
})
