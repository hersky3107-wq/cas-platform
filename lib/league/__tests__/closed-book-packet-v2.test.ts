import { describe, expect, it } from 'vitest'
import {
  assembleClosedBookInjection,
  isOzOzGoldSilverRatio,
  type ClosedBookPacketInput,
  type RelatedInstrumentStat,
  type SeriesBar,
  type SlowDataSnapshot,
} from '../closed-book-packet'

function bars(n: number, start = 100): SeriesBar[] {
  const out: SeriesBar[] = []
  let px = start
  for (let i = 0; i < n; i++) {
    px = px + (i % 2 === 0 ? 1 : -0.4)
    const day = 10 + (i % 18)
    const month = 1 + Math.floor(i / 18) % 12
    out.push({
      date: `2024-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
      close: Number(px.toFixed(4)),
    })
  }
  return out
}

const related: RelatedInstrumentStat[] = [
  {
    symbol: 'QQQ',
    role: 'index_proxy',
    note: 'Nasdaq-100 proxy',
    lastClose: 512.34,
    lastDate: '2026-08-27',
    move1dPct: -0.85,
    corr: { r: 0.87, n: 20 },
    beta: { beta: 1.12, n: 20 },
    leadLag: [{ lag: 1, r: 0.31, n: 60 }],
  },
  { symbol: 'USD/CNH', role: 'fx', note: 'offshore yuan', unavailable: 'TwelveData error 404: symbol not on plan' },
]

const slow: SlowDataSnapshot = {
  fetchedAt: '2026-08-28T09:00:00.000Z',
  shortVolume: { date: '2026-08-27', shortShares: 5816998, totalShares: 10250219, shortPct: 56.75 },
  putCall: { date: '2026-08-27', total: 0.73, index: 0.92, equity: 0.62 },
  btcEtfFlow: { unavailable: 'Farside farside.co.uk/btc: HTTP 403 (Cloudflare-blocked at probe time 2026-08-28)' },
  insider: {
    windowDays: 90,
    buyTxns: 0,
    buyShares: 0,
    sellTxns: 12,
    sellShares: 1433000,
    netShares: -1433000,
    latestFilingDate: '2026-08-27',
  },
}

function input(over: Partial<ClosedBookPacketInput> = {}): ClosedBookPacketInput {
  const series = over.series ?? bars(300, 200)
  const last = series[series.length - 1]
  return {
    instrument: 'AAPL',
    category: 'stock',
    horizon: '1d',
    series,
    seriesSource: 'Twelve Data /time_series+quote',
    seriesAsOf: last.date,
    anchorClose: last.close,
    anchorSessionDate: last.date,
    quoteAsOf: last.date,
    consensus: null,
    crypto: null,
    findings: [
      { query: 'price drivers', summary: 'AAPL rose 1.2% to $232.10 after supplier orders grew 8%.' },
    ],
    researchCacheKey: 'rp_v2|AAPL|1d|high|zh|2026-08-28T06',
    assembledAt: '2026-08-28T09:00:00.000Z',
    related,
    slow,
    nonEnglishFindings: [
      { lang: 'zh', query: '苹果公司 最新 供应链 消息', summary: '"富士康8月出货量增长12%。" EN: Foxconn August shipments grew 12% per Caixin, 2026-08-26.' },
    ],
    synthesis: null,
    ...over,
  }
}

describe('closed-book packet v2 — new sections', () => {
  it('renders RELATED INSTRUMENTS with corr/beta/lead-lag numbers and n', () => {
    const text = assembleClosedBookInjection(input())
    expect(text).toContain('RELATED INSTRUMENTS')
    expect(text).toContain('QQQ [index_proxy — Nasdaq-100 proxy]')
    expect(text).toContain('corr20 +0.87 (n=20)')
    expect(text).toContain('beta20 +1.12 (n=20)')
    expect(text).toContain('t-1 r=+0.31 (n=60)')
  })

  it('a failed related fetch is an UNAVAILABLE line, never dropped', () => {
    const text = assembleClosedBookInjection(input())
    expect(text).toMatch(/USD\/CNH \[fx — offshore yuan\]: UNAVAILABLE/)
  })

  it('renders SLOW PUBLIC DATA with source + informative-horizon labels', () => {
    const text = assembleClosedBookInjection(input())
    expect(text).toContain('SLOW PUBLIC DATA')
    expect(text).toContain('56.8% short-volume ratio')
    expect(text).toContain('FINRA CNMS daily file; informative horizon: days-weeks')
    expect(text).toContain('put/call ratios (2026-08-27): total 0.73 / index 0.92 / equity 0.62')
    expect(text).toContain('informative horizon: weeks-months — weak for 1d')
    expect(text).toMatch(/BTC spot ETF flows: UNAVAILABLE/)
  })

  it('renders metals slow fields with source + as-of, and UNAVAILABLE on failure', () => {
    const text = assembleClosedBookInjection(
      input({
        instrument: 'XAU/USD',
        category: 'gold_metal',
        slow: {
          fetchedAt: '2026-09-13T00:00:00.000Z',
          shortVolume: null,
          putCall: null,
          btcEtfFlow: null,
          insider: null,
          realYield10y: { date: '2026-09-11', yieldPct: 1.82 },
          cotGold: {
            contract: 'GOLD - COMMODITY EXCHANGE INC.',
            date: '2026-09-08',
            openInterest: 411227,
            managedMoneyLong: 145804,
            managedMoneyShort: 10832,
            managedMoneyNet: 134972,
          },
          cotSilver: { unavailable: 'CFTC f_disagg.txt: HTTP 500' },
          gldHoldings: { unavailable: 'GLD holdings: HTML (bot wall or missing CSV)' },
          slvHoldings: { date: '2026-09-12', tonnes: 14123.45, ounces: 454000000 },
          goldSilverRatio: {
            ratio: 7.21,
            goldLast: 310.5,
            silverLast: 43.07,
            goldSymbol: 'GLD',
            silverSymbol: 'SLV',
            asOf: '2026-09-12',
          },
        },
      }),
    )
    expect(text).toContain('10Y TIPS real yield (2026-09-11): 1.82%')
    expect(text).toContain('US Treasury daily real yield curve')
    expect(text).toContain('CFTC gold managed-money (2026-09-08): managed-money net 134,972 contracts')
    expect(text).toMatch(/CFTC silver managed-money: UNAVAILABLE/)
    expect(text).toMatch(/GLD holdings: UNAVAILABLE/)
    expect(text).toContain('SLV holdings (2026-09-12): 14123.45 t')
    expect(text).toMatch(/gold\/silver ratio: UNAVAILABLE/)
    expect(text).not.toContain('7.210')
    expect(text).not.toContain('ETF-share proxy')
  })

  it('renders GVZ, industrial production, and platinum/palladium COT', () => {
    const text = assembleClosedBookInjection(
      input({
        instrument: 'XPT/USD',
        category: 'gold_metal',
        slow: {
          fetchedAt: '2026-09-21T00:00:00.000Z',
          shortVolume: null,
          putCall: { date: '2026-09-18', total: 0.81, index: 1.02, equity: 0.7 },
          btcEtfFlow: null,
          insider: null,
          gvz: { date: '2026-09-17', value: 24.98 },
          indpro: { date: '2026-08-01', value: 103.0682 },
          semiProduction: { date: '2026-08-01', value: 99.4 },
          cotPlatinum: {
            contract: 'PLATINUM - NEW YORK MERCANTILE EXCHANGE',
            date: '2026-09-15',
            openInterest: 65478,
            managedMoneyLong: 15220,
            managedMoneyShort: 3100,
            managedMoneyNet: 12120,
          },
          cotPalladium: {
            contract: 'PALLADIUM - NEW YORK MERCANTILE EXCHANGE',
            date: '2026-09-15',
            openInterest: 16707,
            managedMoneyLong: 4000,
            managedMoneyShort: 1200,
            managedMoneyNet: 2800,
          },
          gldHoldings: {
            date: '2026-09-18',
            tonnes: 1057.122,
            ounces: 33987513.34,
            source: 'SPDR Gold Shares api.spdrgoldshares.com',
          },
        },
      }),
    )
    expect(text).toContain('CBOE gold ETF volatility GVZ (2026-09-17): 24.98')
    expect(text).toContain('FRED GVZCLS')
    expect(text).toContain('US industrial production (2026-08-01): 103.07')
    expect(text).toContain('FRED INDPRO')
    expect(text).toContain('US semiconductor production (2026-08-01): 99.40')
    expect(text).toContain('CFTC platinum managed-money (2026-09-15): managed-money net 12,120 contracts')
    expect(text).toContain('CFTC palladium managed-money')
    expect(text).toContain('put/call ratios (2026-09-18): total 0.81')
    expect(text).toContain('SPDR Gold Shares api.spdrgoldshares.com')
    expect(text).not.toContain('EIA US commercial crude')
    expect(text).not.toContain('CFTC WTI')
    expect(text).not.toContain('OVXCLS')
  })

  it('renders energy slow fields per-commodity and UNAVAILABLE on failure', () => {
    const wti = assembleClosedBookInjection(
      input({
        instrument: 'WTI/USD',
        category: 'commodity_energy',
        slow: {
          fetchedAt: '2026-09-22T00:00:00.000Z',
          shortVolume: null,
          putCall: { date: '2026-09-21', total: 0.9, index: 1.1, equity: 0.7 },
          btcEtfFlow: null,
          insider: null,
          eiaCrude: {
            weekEnding: '2026-09-11',
            commercialStocksMMbbl: 423.429,
            commercialWowChangeMMbbl: -0.64,
            sprMMbbl: 284.957,
            productionKbpd: 13944,
            refineryRunsKbpd: 17330,
            productSuppliedKbpd: 21255,
          },
          cotWti: {
            contract: 'WTI-PHYSICAL - NEW YORK MERCANTILE EXCHANGE',
            date: '2026-09-15',
            openInterest: 1955764,
            managedMoneyLong: 221896,
            managedMoneyShort: 115617,
            managedMoneyNet: 106279,
          },
          ovx: { date: '2026-09-18', value: 50.39 },
          wtiSpotFred: { date: '2026-09-15', value: 107.02 },
          gasolineRetail: { date: '2026-09-07', value: 4.157 },
        },
      }),
    )
    expect(wti).toContain('EIA US commercial crude stocks ex-SPR (2026-09-11): 423.43 million bbl (wow -0.64')
    expect(wti).toContain('SPR 284.96 million bbl')
    expect(wti).toContain('EIA US crude production (2026-09-11): 13,944 thousand b/d')
    expect(wti).toContain('refinery runs 17,330 thousand b/d')
    expect(wti).toContain('products supplied 21,255 thousand b/d')
    expect(wti).toContain('CFTC WTI managed-money (2026-09-15): managed-money net 106,279 contracts')
    expect(wti).toContain('CBOE crude oil volatility OVX (2026-09-18): 50.39')
    expect(wti).toContain('FRED OVXCLS')
    expect(wti).toContain('FRED WTI Cushing spot (2026-09-15): 107.02 USD/bbl')
    expect(wti).toContain('US retail gasoline (2026-09-07): 4.157 USD/gal')
    expect(wti).toContain('put/call ratios (2026-09-21): total 0.90')
    expect(wti).not.toContain('working gas storage')
    expect(wti).not.toContain('CFTC natural-gas')
    expect(wti).not.toContain('10Y TIPS')
    expect(wti).not.toContain('GVZCLS')

    const ung = assembleClosedBookInjection(
      input({
        instrument: 'UNG',
        category: 'commodity_energy',
        slow: {
          fetchedAt: '2026-09-22T00:00:00.000Z',
          shortVolume: { date: '2026-09-21', shortShares: 1000, totalShares: 4000, shortPct: 25 },
          putCall: { unavailable: 'CBOE daily market statistics: timeout' },
          btcEtfFlow: null,
          insider: null,
          eiaNatgas: {
            weekEnding: '2026-09-11',
            storageBcf: 3298,
            netChangeBcf: 44,
            vs5yrAvgPct: 3.7,
            vsYearAgoPct: -3.6,
            fiveYearAvgBcf: 3180,
          },
          cotNatgas: { unavailable: 'CFTC f_disagg.txt: HTTP 500' },
          henryHubSpotFred: { date: '2026-09-15', value: 2.97 },
        },
      }),
    )
    expect(ung).toContain('EIA US working gas storage (2026-09-11): 3,298 Bcf (net +44 Bcf; vs 5yr avg +3.7%; vs year-ago -3.6%')
    expect(ung).toContain('25.0% short-volume ratio')
    expect(ung).toMatch(/CFTC natural-gas managed-money: UNAVAILABLE/)
    expect(ung).toMatch(/put\/call ratios: UNAVAILABLE/)
    expect(ung).toContain('FRED Henry Hub spot (2026-09-15): 2.97 USD/MMBtu')
    expect(ung).not.toContain('commercial crude stocks')
    expect(ung).not.toContain('CFTC WTI')
    expect(ung).not.toContain('OVX')
  })

  it('renders copper/grain/coffee fields without EIA crude or OVX', () => {
    const copper = assembleClosedBookInjection(
      input({
        instrument: 'CPER',
        category: 'commodity_energy',
        slow: {
          fetchedAt: '2026-09-22T00:00:00.000Z',
          shortVolume: { date: '2026-09-21', shortShares: 200, totalShares: 1000, shortPct: 20 },
          putCall: { date: '2026-09-21', total: 0.74, index: 0.8, equity: 0.53 },
          btcEtfFlow: null,
          insider: null,
          cotCopper: {
            contract: 'COPPER- #1 - COMMODITY EXCHANGE INC.',
            date: '2026-09-15',
            openInterest: 289463,
            managedMoneyLong: 83704,
            managedMoneyShort: 18598,
            managedMoneyNet: 65106,
          },
          copperSpotFred: { date: '2026-07-01', value: 13542.82 },
        },
      }),
    )
    expect(copper).toContain('CFTC copper managed-money (2026-09-15): managed-money net 65,106 contracts')
    expect(copper).toContain('IMF copper price (2026-07-01): 13542.82 USD/metric ton')
    expect(copper).toContain('FRED PCOPPUSDM')
    expect(copper).toContain('20.0% short-volume ratio')
    expect(copper).not.toContain('EIA US commercial crude')
    expect(copper).not.toContain('OVX')
    expect(copper).not.toContain('working gas storage')

    const corn = assembleClosedBookInjection(
      input({
        instrument: 'CORN',
        category: 'commodity_energy',
        slow: {
          fetchedAt: '2026-09-22T00:00:00.000Z',
          shortVolume: null,
          putCall: null,
          btcEtfFlow: null,
          insider: null,
          cotCorn: {
            contract: 'CORN - CHICAGO BOARD OF TRADE',
            date: '2026-09-15',
            openInterest: 1843824,
            managedMoneyLong: 483738,
            managedMoneyShort: 69278,
            managedMoneyNet: 414460,
          },
          cornSpotFred: { date: '2026-07-01', value: 213.19 },
        },
      }),
    )
    expect(corn).toContain('CFTC corn managed-money')
    expect(corn).toContain('414,460 contracts')
    expect(corn).toContain('IMF corn price (2026-07-01): 213.19 USD/metric ton')
    expect(corn).not.toContain('OVX')
    expect(corn).not.toContain('EIA US')

    const coffee = assembleClosedBookInjection(
      input({
        instrument: 'COFF',
        category: 'commodity_energy',
        slow: {
          fetchedAt: '2026-09-22T00:00:00.000Z',
          shortVolume: null,
          putCall: null,
          btcEtfFlow: null,
          insider: null,
          cotCoffee: {
            contract: 'COFFEE C - ICE FUTURES U.S.',
            date: '2026-09-15',
            openInterest: 150458,
            managedMoneyLong: 35227,
            managedMoneyShort: 14566,
            managedMoneyNet: 20661,
          },
          coffeeSpotFred: { date: '2026-07-01', value: 359.16 },
        },
      }),
    )
    expect(coffee).toContain('CFTC coffee C managed-money')
    expect(coffee).toContain('IMF other-mild arabica coffee (2026-07-01): 359.16 US cents/lb')
    expect(coffee).not.toContain('EIA')
    expect(coffee).not.toContain('OVX')
  })

  it('renders FX fields per-pair: USD pair vs KRW/cross isolation', () => {
    const eurusd = assembleClosedBookInjection(
      input({
        instrument: 'EUR/USD',
        category: 'fx',
        slow: {
          fetchedAt: '2026-09-22T00:00:00.000Z',
          shortVolume: null,
          putCall: { date: '2026-09-21', total: 0.81, index: 0.9, equity: 0.6 },
          btcEtfFlow: null,
          insider: null,
          fedFunds: { date: '2026-09-18', value: 3.88 },
          ust10y: { date: '2026-09-18', value: 5.01 },
          ecbDeposit: { date: '2026-09-21', value: 2.5 },
          germanBund10y: { date: '2026-08-01', value: 3.18 },
          euroHicp: { date: '2026-08-01', value: 103.66 },
          policyRateDiff: {
            leftLabel: 'Fed funds',
            rightLabel: 'ECB deposit',
            leftValue: 3.88,
            rightValue: 2.5,
            leftDate: '2026-09-18',
            rightDate: '2026-09-21',
            diffPp: 1.38,
          },
          cotEur: {
            contract: 'EURO FX - CHICAGO MERCANTILE EXCHANGE',
            date: '2026-09-15',
            openInterest: 920035,
            managedMoneyLong: 103260,
            managedMoneyShort: 131416,
            managedMoneyNet: -28156,
            source: 'CFTC TFF FinFutWk.txt (leveraged-funds ≈ managed-money analog)',
          },
          cotDxy: {
            contract: 'USD INDEX - ICE FUTURES U.S.',
            date: '2026-09-15',
            openInterest: 43744,
            managedMoneyLong: 25971,
            managedMoneyShort: 15378,
            managedMoneyNet: 10593,
            source: 'CFTC TFF FinFutWk.txt (leveraged-funds ≈ managed-money analog)',
          },
          fxEtfShortVolume: [{ symbol: 'FXE', date: '2026-09-21', shortShares: 100, totalShares: 1000, shortPct: 10 }],
        },
      }),
    )
    expect(eurusd).toContain('Fed funds effective (2026-09-18): 3.88%')
    expect(eurusd).toContain('FRED DFF')
    expect(eurusd).toContain('ECB deposit facility rate (2026-09-21): 2.50%')
    expect(eurusd).toContain('Policy-rate differential: Fed funds 3.88% (2026-09-18) − ECB deposit 2.50% (2026-09-21) = +1.38 pp')
    expect(eurusd).toContain('CFTC euro FX leveraged-funds (2026-09-15): managed-money net -28,156 contracts')
    expect(eurusd).toContain('FinFutWk.txt')
    expect(eurusd).toContain('CFTC USD index (DXY) leveraged-funds')
    expect(eurusd).toContain('FINRA short-sale volume FXE')
    expect(eurusd).toContain('put/call ratios (2026-09-21): total 0.81')
    expect(eurusd).not.toContain('BOK')
    expect(eurusd).not.toContain('JGB')
    expect(eurusd).not.toContain('EIA US commercial crude')
    expect(eurusd).not.toContain('GVZ')
    expect(eurusd).not.toContain('component leg')

    const jpykrw = assembleClosedBookInjection(
      input({
        instrument: 'JPY/KRW',
        category: 'fx',
        slow: {
          fetchedAt: '2026-09-22T00:00:00.000Z',
          shortVolume: null,
          putCall: { date: '2026-09-21', total: 0.81, index: null, equity: null },
          btcEtfFlow: null,
          insider: null,
          bojPolicy: { date: '2023-12-01', value: 0.3 },
          jgb10y: { date: '2026-08-01', value: 2.94 },
          bokRate: { date: '2026-06-01', value: 1 },
          ktb10y: { date: '2026-08-01', value: 4.286 },
          yield10yDiff: {
            leftLabel: 'KTB 10Y',
            rightLabel: 'JGB 10Y',
            leftValue: 4.286,
            rightValue: 2.94,
            leftDate: '2026-08-01',
            rightDate: '2026-08-01',
            diffPp: 1.346,
          },
          cotJpy: {
            contract: 'JAPANESE YEN - CHICAGO MERCANTILE EXCHANGE',
            date: '2026-09-15',
            openInterest: 542802,
            managedMoneyLong: 110000,
            managedMoneyShort: 50000,
            managedMoneyNet: 60000,
            source: 'CFTC TFF FinFutWk.txt (leveraged-funds ≈ managed-money analog)',
          },
          fxCotGap: {
            note: 'CFTC JPY/KRW cross: none. KRW has no CME futures. JPY TFF below is the JPY leg only, not a cross COT.',
          },
        },
      }),
    )
    expect(jpykrw).toContain('Korea 10Y treasury yield (2026-08-01): 4.29%')
    expect(jpykrw).toContain('Japan 10Y JGB yield (2026-08-01): 2.94%')
    expect(jpykrw).toContain('10Y yield differential: KTB 10Y 4.29% (2026-08-01) − JGB 10Y 2.94% (2026-08-01) = +1.35 pp')
    expect(jpykrw).toContain('CFTC JPY/KRW cross: none')
    expect(jpykrw).toContain('CFTC yen leveraged-funds (component leg, not a cross COT)')
    expect(jpykrw).not.toContain('Fed funds effective')
    expect(jpykrw).not.toContain('DTWEXBGS')
    expect(jpykrw).not.toContain('USD index (DXY)')
    expect(jpykrw).not.toContain('ECB deposit')
    expect(jpykrw).not.toContain('EIA US')
    expect(jpykrw).not.toContain('OVX')

    const usdkrw = assembleClosedBookInjection(
      input({
        instrument: 'USD/KRW',
        category: 'fx',
        slow: {
          fetchedAt: '2026-09-22T00:00:00.000Z',
          shortVolume: null,
          putCall: null,
          btcEtfFlow: null,
          insider: null,
          fedFunds: { date: '2026-09-18', value: 3.88 },
          bokRate: { date: '2026-06-01', value: 1 },
          dxyEme: { date: '2026-09-18', value: 127.666 },
          fxCotGap: {
            note: 'CFTC KRW futures: none — CME does not list KRW (offshore NDF). No KRW COT. DXY TFF below is the USD-index contract, not KRW.',
          },
          cotDxy: {
            contract: 'USD INDEX - ICE FUTURES U.S.',
            date: '2026-09-15',
            openInterest: 43744,
            managedMoneyLong: 25971,
            managedMoneyShort: 15378,
            managedMoneyNet: 10593,
          },
        },
      }),
    )
    expect(usdkrw).toContain('CFTC KRW futures: none')
    expect(usdkrw).toContain('Fed funds effective')
    expect(usdkrw).toContain('Bank of Korea')
    expect(usdkrw).toContain('emerging-markets')
    expect(usdkrw).not.toContain('ECB deposit')
    expect(usdkrw).not.toContain('CFTC euro FX')
    expect(usdkrw).not.toContain('CFTC yen leveraged-funds')
  })

  it('renders index_etf FRED/CFTC per-chip: TQQQ gets NQ not ES; EWY has no COT; no EIA/GVZ leak', () => {
    const tqqq = assembleClosedBookInjection(
      input({
        instrument: 'TQQQ',
        category: 'etf_index',
        slow: {
          fetchedAt: '2026-09-22T00:00:00.000Z',
          shortVolume: { date: '2026-09-21', shortShares: 10, totalShares: 100, shortPct: 10 },
          putCall: { date: '2026-09-21', total: 0.81, index: 0.9, equity: 0.6 },
          btcEtfFlow: null,
          insider: null,
          vixcls: { date: '2026-09-18', value: 14.81 },
          nasdaqComFred: { date: '2026-09-18', value: 27122.09 },
          cotNq: {
            contract: 'NASDAQ MINI - CHICAGO MERCANTILE EXCHANGE',
            date: '2026-09-15',
            openInterest: 325784,
            managedMoneyLong: 100,
            managedMoneyShort: 6387,
            managedMoneyNet: -6287,
            source: 'CFTC TFF FinFutWk.txt (leveraged-funds ≈ managed-money analog)',
          },
          cotVix: {
            contract: 'VIX FUTURES - CBOE FUTURES EXCHANGE',
            date: '2026-09-15',
            openInterest: 446060,
            managedMoneyLong: 1,
            managedMoneyShort: 16505,
            managedMoneyNet: -16504,
            source: 'CFTC TFF FinFutWk.txt (leveraged-funds ≈ managed-money analog)',
          },
        },
      }),
    )
    expect(tqqq).toContain('CBOE VIX (2026-09-18): 14.81')
    expect(tqqq).toContain('FRED VIXCLS')
    expect(tqqq).toContain('FRED Nasdaq Composite (2026-09-18): 27122.09')
    expect(tqqq).toContain('CFTC Nasdaq mini leveraged-funds')
    expect(tqqq).toContain('CFTC VIX futures leveraged-funds')
    expect(tqqq).toContain('put/call ratios')
    expect(tqqq).not.toContain('CFTC E-mini S&P 500')
    expect(tqqq).not.toContain('FRED S&P 500 cash')
    expect(tqqq).not.toContain('EIA US commercial crude')
    expect(tqqq).not.toContain('GVZ')
    expect(tqqq).not.toContain('Fed funds effective')

    const ewy = assembleClosedBookInjection(
      input({
        instrument: 'EWY',
        category: 'etf_index',
        slow: {
          fetchedAt: '2026-09-22T00:00:00.000Z',
          shortVolume: null,
          putCall: { date: '2026-09-21', total: 0.81, index: null, equity: null },
          btcEtfFlow: null,
          insider: null,
          vixcls: { date: '2026-09-18', value: 14.81 },
          cotVix: {
            contract: 'VIX FUTURES - CBOE FUTURES EXCHANGE',
            date: '2026-09-15',
            openInterest: 1,
            managedMoneyLong: 1,
            managedMoneyShort: 2,
            managedMoneyNet: -1,
          },
          indexEtfCotGap: {
            note: 'CFTC KOSPI/Korea: none in FinFutWk. EWY is a US-listed MSCI Korea ETF, not KOSPI 200 / KODEX 200. No Korea-index COT.',
          },
          indexEtfIdentityNote: {
            note: 'EWY is iShares MSCI Korea (US-listed country ETF), not a KOSPI cash index. No free KOSPI series on FRED.',
          },
        },
      }),
    )
    expect(ewy).toContain('CFTC KOSPI/Korea: none')
    expect(ewy).toContain('iShares MSCI Korea')
    expect(ewy).toContain('CBOE VIX')
    expect(ewy).not.toContain('CFTC E-mini S&P 500')
    expect(ewy).not.toContain('CFTC Nasdaq mini')
    expect(ewy).not.toContain('FRED S&P 500 cash')
  })

  it('renders memecoin Fear & Greed + Binance L/S + taker; no EIA/GVZ/Fed leak', () => {
    const text = assembleClosedBookInjection(
      input({
        instrument: 'SHIB/USD',
        category: 'memecoin',
        crypto: {
          fetchedAt: '2026-09-22T00:00:00.000Z',
          funding: { rate: 0.0001, nextFundingTime: '2026-09-22T08:00:00.000Z' },
          openInterest: { contracts: 12345.5 },
          markIv: { unavailable: 'no Deribit currency mapping for SHIB/USD' },
        },
        slow: {
          fetchedAt: '2026-09-22T00:00:00.000Z',
          shortVolume: null,
          putCall: null,
          btcEtfFlow: { date: '22 Sep 2026', netFlowUsdM: 120.5 },
          insider: null,
          fearGreed: {
            latest: { date: '2026-09-22', value: 64, classification: 'Greed' },
            week: [
              { date: '2026-09-22', value: 64, classification: 'Greed' },
              { date: '2026-09-21', value: 58, classification: 'Greed' },
            ],
          },
          topTraderLs: {
            symbol: '1000SHIBUSDT',
            timestamp: '2026-09-22T01:00:00.000Z',
            period: '1h',
            longAccountPct: 55.5,
            shortAccountPct: 44.5,
            longShortRatio: 1.247,
          },
          takerRatio: {
            symbol: '1000SHIBUSDT',
            timestamp: '2026-09-22T01:00:00.000Z',
            period: '1h',
            buySellRatio: 1.08,
            buyVol: 1000,
            sellVol: 900,
          },
        },
      }),
    )
    expect(text).toContain('CRYPTO POSITIONING')
    expect(text).toContain('funding: 0.0100%')
    expect(text).toContain('open interest: 12345.500 contracts')
    expect(text).toContain('1000SHIBUSDT')
    expect(text).toContain('Crypto Fear & Greed (2026-09-22): 64 Greed')
    expect(text).toContain('Alternative.me /fng')
    expect(text).toContain('Binance top-trader long/short (1000SHIBUSDT, 1h): long 55.5% / short 44.5% (ratio 1.247')
    expect(text).toContain('Binance taker buy/sell (1000SHIBUSDT, 1h): ratio 1.080')
    expect(text).toContain('BTC spot ETF net flow')
    expect(text).not.toContain('EIA US commercial crude')
    expect(text).not.toContain('GVZ')
    expect(text).not.toContain('Fed funds effective')
    expect(text).not.toContain('CFTC E-mini S&P 500')
  })

  it('renders crypto_spot BTC on-chain + dominance + IBIT short; XRP has no on-chain leak', () => {
    const btc = assembleClosedBookInjection(
      input({
        instrument: 'BTC/USD',
        category: 'crypto_spot',
        crypto: {
          fetchedAt: '2026-09-22T00:00:00.000Z',
          funding: { rate: 0.00008, nextFundingTime: null },
          openInterest: { contracts: 109000 },
          markIv: { ivPct: 48.2, instrument: 'BTC-27SEP26-100000-C' },
        },
        slow: {
          fetchedAt: '2026-09-22T00:00:00.000Z',
          shortVolume: null,
          putCall: null,
          btcEtfFlow: { date: '22 Sep 2026', netFlowUsdM: 210 },
          insider: null,
          fearGreed: {
            latest: { date: '2026-09-22', value: 72, classification: 'Greed' },
            week: [{ date: '2026-09-22', value: 72, classification: 'Greed' }],
          },
          topTraderLs: {
            symbol: 'BTCUSDT',
            timestamp: '2026-09-22T01:00:00.000Z',
            period: '1h',
            longShortRatio: 2.24,
          },
          takerRatio: {
            symbol: 'BTCUSDT',
            timestamp: '2026-09-22T01:00:00.000Z',
            period: '1h',
            buySellRatio: 0.86,
          },
          hashRate: { date: '2026-09-22', value: 720.5, unit: 'TH/s' },
          activeAddresses: { date: '2026-09-22', value: 812000 },
          difficultyAdjustment: {
            progressPct: 45.2,
            changePct: 2.1,
            estimatedDate: '2026-09-28T00:00:00.000Z',
            remainingBlocks: 1100,
          },
          mempoolFees: { fastest: 8, halfHour: 5, hour: 3, economy: 1, unit: 'sat/vB' },
          btcDominance: { date: '2026-09-22', pct: 57.2 },
          cryptoEtfShortVolume: [
            { symbol: 'IBIT', date: '2026-09-19', shortShares: 1_000_000, totalShares: 4_000_000, shortPct: 25 },
          ],
        },
      }),
    )
    expect(btc).toContain('CRYPTO POSITIONING')
    expect(btc).toContain('funding: 0.0080%')
    expect(btc).toContain('mark_iv: 48.20%')
    expect(btc).toContain('BTC hash rate (2026-09-22): 720.50 TH/s')
    expect(btc).toContain('BTC active addresses')
    expect(btc).toContain('BTC difficulty adjustment')
    expect(btc).toContain('BTC mempool fees')
    expect(btc).toContain('BTC dominance (2026-09-22): 57.20%')
    expect(btc).toContain('FINRA short-sale volume IBIT')
    expect(btc).toContain('Crypto Fear & Greed')
    expect(btc).not.toContain('ETH dominance')
    expect(btc).not.toContain('EIA US commercial crude')

    const xrp = assembleClosedBookInjection(
      input({
        instrument: 'XRP/USD',
        category: 'crypto_spot',
        crypto: {
          fetchedAt: '2026-09-22T00:00:00.000Z',
          funding: { rate: 0.0001, nextFundingTime: null },
          openInterest: { contracts: 1 },
          markIv: { unavailable: 'no Deribit currency mapping for XRP/USD' },
        },
        slow: {
          fetchedAt: '2026-09-22T00:00:00.000Z',
          shortVolume: null,
          putCall: null,
          btcEtfFlow: { unavailable: 'Farside farside.co.uk/btc: HTTP 403 (Cloudflare-blocked at probe time 2026-08-28)' },
          insider: null,
          fearGreed: {
            latest: { date: '2026-09-22', value: 72, classification: 'Greed' },
            week: [{ date: '2026-09-22', value: 72, classification: 'Greed' }],
          },
          topTraderLs: {
            symbol: 'XRPUSDT',
            timestamp: '2026-09-22T01:00:00.000Z',
            period: '1h',
            longShortRatio: 2.25,
          },
          takerRatio: {
            symbol: 'XRPUSDT',
            timestamp: '2026-09-22T01:00:00.000Z',
            period: '1h',
            buySellRatio: 0.85,
          },
        },
      }),
    )
    expect(xrp).toContain('XRPUSDT')
    expect(xrp).toContain('no Deribit currency mapping for XRP/USD')
    expect(xrp).toContain('Crypto Fear & Greed')
    expect(xrp).toContain('BTC spot ETF flows')
    expect(xrp).not.toContain('BTC hash rate')
    expect(xrp).not.toContain('BTC dominance')
    expect(xrp).not.toContain('IBIT')

    const eth = assembleClosedBookInjection(
      input({
        instrument: 'ETH/USD',
        category: 'crypto_spot',
        crypto: {
          fetchedAt: '2026-09-22T00:00:00.000Z',
          funding: { rate: 0.00005, nextFundingTime: null },
          openInterest: { contracts: 88000 },
          markIv: { ivPct: 62.4, instrument: 'ETH-27SEP26-4000-C' },
        },
        slow: {
          fetchedAt: '2026-09-22T00:00:00.000Z',
          shortVolume: null,
          putCall: null,
          btcEtfFlow: { date: '22 Sep 2026', netFlowUsdM: 210 },
          insider: null,
          fearGreed: {
            latest: { date: '2026-09-22', value: 72, classification: 'Greed' },
            week: [{ date: '2026-09-22', value: 72, classification: 'Greed' }],
          },
          topTraderLs: {
            symbol: 'ETHUSDT',
            timestamp: '2026-09-22T01:00:00.000Z',
            period: '1h',
            longShortRatio: 1.41,
          },
          takerRatio: {
            symbol: 'ETHUSDT',
            timestamp: '2026-09-22T01:00:00.000Z',
            period: '1h',
            buySellRatio: 1.02,
          },
          ethDominance: { date: '2026-09-22', pct: 12.4 },
          ethEtfFlow: { date: '22 Sep 2026', netFlowUsdM: 84 },
          cryptoEtfShortVolume: [
            { symbol: 'ETHA', date: '2026-09-19', shortShares: 400_000, totalShares: 2_000_000, shortPct: 20 },
          ],
        },
      }),
    )
    expect(eth).toContain('mark_iv: 62.40%')
    expect(eth).toContain('ETH dominance (2026-09-22): 12.40%')
    expect(eth).toContain('ETH spot ETF net flow')
    expect(eth).toContain('FINRA short-sale volume ETHA')
    expect(eth).not.toContain('BTC hash rate')
    expect(eth).not.toContain('IBIT')
    expect(eth).not.toContain('BTC dominance')
  })

  it('prints gold/silver ratio only when the number is ounces of silver per ounce of gold', () => {
    expect(isOzOzGoldSilverRatio(7.21)).toBe(false)
    expect(isOzOzGoldSilverRatio(72.9)).toBe(true)
    const ozOz = assembleClosedBookInjection(
      input({
        instrument: 'XAU/USD',
        category: 'gold_metal',
        slow: {
          fetchedAt: '2026-09-13T00:00:00.000Z',
          shortVolume: null,
          putCall: null,
          btcEtfFlow: null,
          insider: null,
          goldSilverRatio: {
            ratio: 72.9,
            goldLast: 3375,
            silverLast: 46.3,
            goldSymbol: 'XAU/USD',
            silverSymbol: 'XAG/USD',
            asOf: '2026-09-12',
          },
        },
      }),
    )
    expect(ozOz).toContain('gold/silver ratio (2026-09-12): 72.9 oz silver per oz gold')
    expect(ozOz).not.toContain('ETF-share proxy')
  })

  it('slow-data fields that are null (not applicable) are omitted, not UNAVAILABLE', () => {
    const text = assembleClosedBookInjection(
      input({ slow: { ...slow, btcEtfFlow: null, insider: null } }),
    )
    expect(text).not.toContain('BTC spot ETF')
    expect(text).not.toContain('insider Form 4')
    expect(text).toContain('short-sale volume')
  })

  it('renders NON-ENGLISH FINDINGS with lang tag, original text and EN gloss', () => {
    const text = assembleClosedBookInjection(input())
    expect(text).toContain('NON-ENGLISH FINDINGS')
    expect(text).toContain('[zh] 苹果公司 最新 供应链 消息')
    expect(text).toContain('EN: Foxconn August shipments grew 12%')
  })

  it('synthesis REPLACES prose findings; absent synthesis keeps them', () => {
    const withSynthesis = assembleClosedBookInjection(
      input({ synthesis: 'Foxconn Aug shipments — +12% — Caixin — 2026-08-26' }),
    )
    expect(withSynthesis).toContain('RESEARCH SYNTHESIS')
    expect(withSynthesis).not.toContain('PROSE FINDINGS')

    const withoutSynthesis = assembleClosedBookInjection(input())
    expect(withoutSynthesis).not.toContain('RESEARCH SYNTHESIS')
    expect(withoutSynthesis).toContain('PROSE FINDINGS')
  })

  it('v1-shaped input (no v2 fields) renders no v2 sections — backward compatible', () => {
    const text = assembleClosedBookInjection(
      input({ related: null, slow: null, nonEnglishFindings: [], synthesis: null }),
    )
    expect(text).not.toContain('RELATED INSTRUMENTS')
    expect(text).not.toContain('SLOW PUBLIC DATA')
    expect(text).not.toContain('NON-ENGLISH FINDINGS')
  })

  it('section order: numeric blocks, RELATED, SLOW, NON-ENGLISH, then research text', () => {
    const text = assembleClosedBookInjection(input({ synthesis: 'x — 1 — src — 2026-08-28' }))
    const idx = (s: string) => text.indexOf(s)
    expect(idx('NUMERIC MARKET')).toBeLessThan(idx('RELATED INSTRUMENTS'))
    expect(idx('RELATED INSTRUMENTS')).toBeLessThan(idx('SLOW PUBLIC DATA'))
    expect(idx('SLOW PUBLIC DATA')).toBeLessThan(idx('NON-ENGLISH FINDINGS'))
    expect(idx('NON-ENGLISH FINDINGS')).toBeLessThan(idx('RESEARCH SYNTHESIS'))
  })

  it('write-once audit trail: same frozen inputs reproduce the byte-identical v2 packet', () => {
    const first = assembleClosedBookInjection(input())
    const reproduced = assembleClosedBookInjection(input())
    expect(reproduced).toBe(first)
  })
})
