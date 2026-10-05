import 'server-only'

import { XMLParser } from 'fast-xml-parser'
import { twelveDataGet } from './market-data'
import {
  GLD_OZ_PER_SHARE,
  SLV_OZ_PER_SHARE,
  TROY_OZ_PER_TONNE,
  cotHistoryStats,
  etfFlowFromBars,
  eventsInWindow,
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
  fredChangeFromObservations,
} from './metals-parse'
import { CALENDAR_DAY_COUNT, isUiHorizon } from './horizon'
import type { CotPositioning, EtfFlowProxy, EtfHoldings, FredChange, MacroCalendar, SlowDataSnapshot } from './closed-book-packet'

/**
 * Free gold/metals packet feeds. Zero API-key cost.
 * Gold/silver ratio is omitted: GLD/SLV share prices are not ounces of
 * silver per ounce of gold. Never print a share-price quotient as the ratio.
 * Every field is source + as-of; failure is UNAVAILABLE, never guessed.
 */

const FETCH_TIMEOUT_MS = 45_000
const UA = 'cas-platform-league-research/1.0 (contact: admin@cas-platform.example)'
const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'

const CFTC_DISAGG_URL = 'https://www.cftc.gov/dea/newcot/f_disagg.txt'
export const CFTC_GOLD_CODE = '088691'
export const CFTC_SILVER_CODE = '084691'
export const CFTC_PLATINUM_CODE = '076651'
export const CFTC_PALLADIUM_CODE = '075651'

const SPDR_GLD_DATA_URL = 'https://api.spdrgoldshares.com/api/v1/data?product=gld&exchange=NYSE&lang=en'
const SLV_JSON_URL =
  'https://www.ishares.com/us/products/239855/ishares-silver-trust-fund/1467271812596.ajax?fileType=json&fileName=SLV_holdings&dataType=fund'
const SLV_PRODUCT_URL = 'https://www.ishares.com/us/products/239855/ishares-silver-trust-fund'

type Fail = { unavailable: string }

async function getText(
  url: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; text: string } | { error: string }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': UA, ...headers },
    })
    const text = await res.text()
    return { status: res.status, text }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { error: msg.toLowerCase().includes('abort') ? `timeout after ${FETCH_TIMEOUT_MS}ms` : msg }
  } finally {
    clearTimeout(timer)
  }
}

const dayMemo = new Map<string, unknown>()
function utcDay(): string {
  return new Date().toISOString().slice(0, 10)
}
async function memoDaily<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const k = `${key}|${utcDay()}`
  const hit = dayMemo.get(k)
  if (hit !== undefined) return hit as T
  const value = await fn()
  dayMemo.set(k, value)
  return value
}

export async function fetchCftcDisaggText(): Promise<{ text: string } | Fail> {
  return memoDaily('cftc-disagg', async () => {
    const res = await getText(CFTC_DISAGG_URL)
    if ('error' in res) return { unavailable: `CFTC f_disagg.txt: ${res.error}` }
    if (res.status !== 200) return { unavailable: `CFTC f_disagg.txt: HTTP ${res.status}` }
    return { text: res.text }
  })
}

export function cotFromDisaggText(text: string, contractCode: string): CotPositioning {
  for (const line of text.split(/\r?\n/)) {
    if (!line.includes(contractCode)) continue
    const parsed = parseCftcManagedMoney(line, contractCode)
    if (parsed) return parsed
  }
  return { unavailable: `CFTC f_disagg.txt: no row for contract ${contractCode}` }
}

function cotOrFail(disagg: { text: string } | Fail, contractCode: string): CotPositioning {
  if ('unavailable' in disagg) return disagg
  return cotFromDisaggText(disagg.text, contractCode)
}

export async function fetchTreasuryRealYield10y(): Promise<{ date: string; yieldPct: number } | Fail> {
  return memoDaily('tips10y', async () => {
    const year = new Date().getUTCFullYear()
    const years = [year, year - 1]
    const errors: string[] = []
    for (const y of years) {
      const csvUrl = `https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/${y}/all?type=daily_treasury_real_yield_curve&field_tdr_date_value=${y}&_format=csv`
      const csvRes = await getText(csvUrl)
      if (!('error' in csvRes) && csvRes.status === 200 && !/^\s*</.test(csvRes.text)) {
        const parsed = parseTreasuryRealYieldCsv(csvRes.text)
        if (parsed) return parsed
        errors.push(`csv ${y}: no 10 YR row parsed`)
      } else if ('error' in csvRes) {
        errors.push(`csv ${y}: ${csvRes.error}`)
      } else {
        errors.push(`csv ${y}: HTTP ${csvRes.status}`)
      }
    }
    const parser = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true })
    for (const y of years) {
      const url = `https://home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml?data=daily_treasury_real_yield_curve&field_tdr_date_value=${y}`
      const res = await getText(url)
      if ('error' in res) {
        errors.push(`xml ${y}: ${res.error}`)
        continue
      }
      if (res.status !== 200) {
        errors.push(`xml ${y}: HTTP ${res.status}`)
        continue
      }
      const xml = parser.parse(res.text) as unknown
      const best = parseTreasuryRealYield10y(xml)
      if (best) return best
      errors.push(`xml ${y}: no TC_10YEAR row parsed`)
    }
    return { unavailable: `US Treasury real yield: ${errors.join('; ')}` }
  })
}

function parseHoldingsText(text: string, symbol: string): Exclude<EtfHoldings, Fail> | Fail {
  const tonnesMatch = text.match(/([\d,.]+)\s*(?:tonnes|metric tons|mt\b)/i)
  const ozMatch = text.match(/([\d,.]+)\s*(?:troy\s*)?ounces/i)
  const dateMatch = text.match(/(\d{4}-\d{2}-\d{2})/) ?? text.match(/(\d{1,2}\/\d{1,2}\/\d{4})/)
  const tonnes = tonnesMatch ? Number(tonnesMatch[1].replace(/,/g, '')) : null
  const ounces = ozMatch ? Number(ozMatch[1].replace(/,/g, '')) : null
  if ((tonnes == null || !Number.isFinite(tonnes)) && (ounces == null || !Number.isFinite(ounces))) {
    return { unavailable: `${symbol} holdings: no tonnes/ounces in issuer file` }
  }
  const date = dateMatch ? (dateMatch[1].includes('/') ? utcDay() : dateMatch[1]) : utcDay()
  const t = tonnes != null && Number.isFinite(tonnes) ? tonnes : ounces != null ? ounces / TROY_OZ_PER_TONNE : null
  const oz = ounces != null && Number.isFinite(ounces) ? ounces : tonnes != null ? tonnes * TROY_OZ_PER_TONNE : null
  return { date, tonnes: t, ounces: oz, source: `${symbol} issuer file` }
}

async function holdingsFromTwelveDataShares(
  symbol: 'GLD' | 'SLV',
): Promise<Exclude<EtfHoldings, Fail> | Fail> {
  const res = await twelveDataGet('quote', { symbol })
  if (!res.ok) return { unavailable: `${symbol} Twelve Data shares_outstanding: ${res.error}` }
  const shares = parseTwelveDataSharesOutstanding(res.json)
  if (shares == null) {
    return { unavailable: `${symbol} Twelve Data quote has no shares_outstanding` }
  }
  const ozPerShare = symbol === 'GLD' ? GLD_OZ_PER_SHARE : SLV_OZ_PER_SHARE
  const date =
    typeof res.json?.datetime === 'string' && /^\d{4}-\d{2}-\d{2}/.test(res.json.datetime)
      ? res.json.datetime.slice(0, 10)
      : utcDay()
  const parsed = holdingsFromShares(
    date,
    shares,
    ozPerShare,
    `Twelve Data shares_outstanding × ${ozPerShare} oz/share`,
  )
  return parsed ?? { unavailable: `${symbol} Twelve Data shares_outstanding unusable` }
}

async function fetchGldHoldings(): Promise<EtfHoldings> {
  const errors: string[] = []
  const jsonRes = await getText(SPDR_GLD_DATA_URL, {
    'User-Agent': BROWSER_UA,
    Accept: 'application/json',
  })
  if ('error' in jsonRes) {
    errors.push(`SPDR JSON: ${jsonRes.error}`)
  } else if (jsonRes.status !== 200) {
    errors.push(`SPDR JSON: HTTP ${jsonRes.status}`)
  } else if (/^\s*</.test(jsonRes.text)) {
    errors.push('SPDR JSON: HTML (bot wall)')
  } else {
    try {
      const parsed = parseSpdrGoldData(JSON.parse(jsonRes.text) as unknown)
      if (parsed) return parsed
      errors.push('SPDR JSON: no total_ounces/total_tonnes')
    } catch {
      errors.push('SPDR JSON: invalid JSON')
    }
  }

  const csvUrls = [
    'https://www.spdrgoldshares.com/assets/dynamic/GLD/GLD_US_archive_EN.csv',
    'https://www.ssga.com/library-content/products/fund-data/etfs/us/holdings-daily-us-en-gld.csv',
  ]
  for (const url of csvUrls) {
    const res = await getText(url, { 'User-Agent': BROWSER_UA, Accept: 'text/csv,text/plain,*/*' })
    if ('error' in res) {
      errors.push(`${url}: ${res.error}`)
      continue
    }
    if (res.status !== 200) {
      errors.push(`${url}: HTTP ${res.status}`)
      continue
    }
    if (/^\s*</.test(res.text) || res.text.startsWith('%PDF')) {
      errors.push(`${url}: not CSV`)
      continue
    }
    const parsed = parseHoldingsText(res.text, 'GLD')
    if (!('unavailable' in parsed)) return parsed
    errors.push(parsed.unavailable)
  }

  const td = await holdingsFromTwelveDataShares('GLD')
  if (!('unavailable' in td)) return td
  errors.push(td.unavailable)
  return { unavailable: errors.join('; ') }
}

async function fetchSlvHoldings(): Promise<EtfHoldings> {
  const errors: string[] = []
  const jsonRes = await getText(SLV_JSON_URL, {
    'User-Agent': BROWSER_UA,
    Accept: 'application/json,text/csv,text/plain,*/*',
    Referer: SLV_PRODUCT_URL,
    'Accept-Language': 'en-US,en;q=0.9',
  })
  if ('error' in jsonRes) {
    errors.push(`iShares JSON: ${jsonRes.error}`)
  } else if (jsonRes.status !== 200) {
    errors.push(`iShares JSON: HTTP ${jsonRes.status}`)
  } else if (/^\s*</.test(jsonRes.text)) {
    errors.push('iShares JSON: HTML (bot wall)')
  } else {
    const parsed = parseHoldingsText(jsonRes.text, 'SLV')
    if (!('unavailable' in parsed)) return { ...parsed, source: 'iShares SLV holdings JSON' }
    errors.push(parsed.unavailable)
  }

  const page = await getText(SLV_PRODUCT_URL, {
    'User-Agent': BROWSER_UA,
    Accept: 'text/html',
    Referer: 'https://www.ishares.com/',
  })
  if ('error' in page) {
    errors.push(`iShares product page: ${page.error}`)
  } else if (page.status !== 200) {
    errors.push(`iShares product page: HTTP ${page.status}`)
  } else {
    const shares = parseIsharesSharesOutstanding(page.text)
    if (shares) {
      const parsed = holdingsFromShares(
        shares.date,
        shares.shares,
        SLV_OZ_PER_SHARE,
        `iShares product page shares outstanding × ${SLV_OZ_PER_SHARE} oz/share`,
      )
      if (parsed) return parsed
    }
    errors.push('iShares product page: no sharesOutstanding')
  }

  const td = await holdingsFromTwelveDataShares('SLV')
  if (!('unavailable' in td)) return td
  errors.push(td.unavailable)
  return { unavailable: errors.join('; ') }
}

export async function fetchEtfHoldings(symbol: 'GLD' | 'SLV'): Promise<EtfHoldings> {
  return memoDaily(`holdings|${symbol}`, async () => (symbol === 'GLD' ? fetchGldHoldings() : fetchSlvHoldings()))
}

export async function fetchFredSeries(
  seriesId: string,
): Promise<{ date: string; value: number } | Fail> {
  return memoDaily(`fred|${seriesId}`, async () => {
    const hist = await fetchFredObservations(seriesId)
    if ('unavailable' in hist) return hist
    const last = hist.obs[hist.obs.length - 1]
    if (!last) return { unavailable: `FRED ${seriesId}: no numeric observation` }
    return last
  })
}

export async function fetchFredObservations(
  seriesId: string,
): Promise<{ obs: { date: string; value: number }[] } | Fail> {
  return memoDaily(`fred-obs|${seriesId}`, async () => {
    const key = process.env.FRED_API_KEY?.trim()
    if (key) {
      const start = new Date()
      start.setUTCDate(start.getUTCDate() - 120)
      const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${encodeURIComponent(seriesId)}&file_type=json&observation_start=${start.toISOString().slice(0, 10)}&sort_order=asc&api_key=${encodeURIComponent(key)}`
      const res = await getText(url, { Accept: 'application/json' })
      if (!('error' in res) && res.status === 200 && !/^\s*</.test(res.text)) {
        try {
          const obs = parseFredApiObservations(JSON.parse(res.text) as unknown)
          if (obs.length) return { obs }
        } catch {
          // fall through to CSV
        }
      }
    }
    const url = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${encodeURIComponent(seriesId)}`
    const res = await getText(url, { Accept: 'text/csv,text/plain,*/*' })
    if ('error' in res) return { unavailable: `FRED ${seriesId}: ${res.error}` }
    if (res.status !== 200) return { unavailable: `FRED ${seriesId}: HTTP ${res.status}` }
    if (/^\s*</.test(res.text)) return { unavailable: `FRED ${seriesId}: HTML (not CSV)` }
    const obs = parseFredCsvObservations(res.text)
    if (!obs.length) return { unavailable: `FRED ${seriesId}: no numeric observation` }
    return { obs }
  })
}

async function fetchFredChange(seriesId: string): Promise<FredChange | Fail> {
  const hist = await fetchFredObservations(seriesId)
  if ('unavailable' in hist) return hist
  const snap = fredChangeFromObservations(seriesId, hist.obs)
  return snap ?? { unavailable: `FRED ${seriesId}: no numeric observation` }
}

const CFTC_SOCRATA =
  'https://publicreporting.cftc.gov/resource/jun7-fc8e.json?$select=report_date_as_yyyy_mm_dd,cftc_contract_market_code,market_and_exchange_names,open_interest_all,m_money_positions_long_all,m_money_positions_short_all&$where=cftc_contract_market_code%20in(%27088691%27,%27084691%27)&$order=report_date_as_yyyy_mm_dd%20DESC&$limit=400'

async function fetchCftcHistoryJson(): Promise<{ json: unknown } | Fail> {
  return memoDaily('cftc-socrata', async () => {
    const res = await getText(CFTC_SOCRATA, { Accept: 'application/json' })
    if ('error' in res) return { unavailable: `CFTC Socrata: ${res.error}` }
    if (res.status !== 200) return { unavailable: `CFTC Socrata: HTTP ${res.status}` }
    try {
      return { json: JSON.parse(res.text) as unknown }
    } catch {
      return { unavailable: 'CFTC Socrata: invalid JSON' }
    }
  })
}

function mergeCotHistory(latest: CotPositioning, history: { json: unknown } | Fail, code: string): CotPositioning {
  if ('unavailable' in latest) return latest
  if ('unavailable' in history) return latest
  const rows = parseCftcSocrataRows(history.json, code)
  const stats = cotHistoryStats(rows)
  if (!stats) return latest
  return {
    ...latest,
    ...(stats.change4w != null ? { change4w: stats.change4w } : {}),
    ...(stats.percentile3y != null ? { percentile3y: stats.percentile3y, historyWeeks: stats.historyWeeks } : {}),
  }
}

async function fetchEtfFlow(symbol: 'GLD' | 'SLV'): Promise<EtfFlowProxy> {
  return memoDaily(`etf-flow|${symbol}`, async () => {
    const res = await twelveDataGet('time_series', { symbol, interval: '1day', outputsize: '40' })
    if (!res.ok) return { unavailable: `${symbol} Twelve Data time_series: ${res.error}` }
    const bars = parseTwelveDataBars(res.json)
    const snap = etfFlowFromBars(symbol, bars, 'Twelve Data /time_series volume+close')
    return snap ?? { unavailable: `${symbol} Twelve Data time_series: no usable bars` }
  })
}

const FOMC_CAL_URL = 'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm'
const BLS_CPI_URL = 'https://www.bls.gov/schedule/news_release/cpi.htm'
const BLS_EMP_URL = 'https://www.bls.gov/schedule/news_release/empsit.htm'

async function fetchMetalsCalendar(horizon?: string): Promise<MacroCalendar> {
  const h = isUiHorizon(horizon) ? horizon : '1w'
  const days = CALENDAR_DAY_COUNT[h]
  const today = utcDay()
  const end = new Date(`${today}T00:00:00.000Z`)
  end.setUTCDate(end.getUTCDate() + days)
  const windowEnd = end.toISOString().slice(0, 10)
  return memoDaily(`macro-cal|${today}|${windowEnd}`, async () => {
    const year = Number(today.slice(0, 4))
    const errors: string[] = []
    const events = []
    const fomc = await getText(FOMC_CAL_URL, { 'User-Agent': BROWSER_UA, Accept: 'text/html' })
    if ('error' in fomc) errors.push(`FOMC: ${fomc.error}`)
    else if (fomc.status !== 200) errors.push(`FOMC: HTTP ${fomc.status}`)
    else events.push(...parseFomcMeetingDates(fomc.text, year), ...parseFomcMeetingDates(fomc.text, year + 1))
    const cpi = await getText(BLS_CPI_URL, { 'User-Agent': BROWSER_UA, Accept: 'text/html' })
    if ('error' in cpi) errors.push(`CPI: ${cpi.error}`)
    else if (cpi.status !== 200) errors.push(`CPI: HTTP ${cpi.status}`)
    else events.push(...parseBlsReleaseDates(cpi.text, 'CPI'))
    const emp = await getText(BLS_EMP_URL, { 'User-Agent': BROWSER_UA, Accept: 'text/html' })
    if ('error' in emp) errors.push(`payrolls: ${emp.error}`)
    else if (emp.status !== 200) errors.push(`payrolls: HTTP ${emp.status}`)
    else events.push(...parseBlsReleaseDates(emp.text, 'payrolls'))
    const inWindow = eventsInWindow(events, today, windowEnd)
    if (!events.length) return { unavailable: errors.join('; ') || 'macro calendar: no dates parsed' }
    return { windowStart: today, windowEnd, events: inWindow }
  })
}

const GOLD_CATEGORIES = new Set(['gold_metal'])

function isSilverInstrument(instrument?: string): boolean {
  const u = instrument?.trim().toUpperCase() ?? ''
  return u === 'XAG/USD' || u === 'XAG' || u === 'SLV'
}

function isPlatinumInstrument(instrument?: string): boolean {
  const u = instrument?.trim().toUpperCase() ?? ''
  return u === 'XPT/USD' || u === 'XPT' || u === 'PPLT'
}

export async function fetchMetalsSlowFields(
  category: string,
  instrument?: string,
  opts?: { horizon?: string },
): Promise<{
  realYield10y: SlowDataSnapshot['realYield10y']
  cotGold: SlowDataSnapshot['cotGold']
  cotSilver: SlowDataSnapshot['cotSilver']
  cotPlatinum?: SlowDataSnapshot['cotPlatinum']
  cotPalladium?: SlowDataSnapshot['cotPalladium']
  gldHoldings: SlowDataSnapshot['gldHoldings']
  slvHoldings: SlowDataSnapshot['slvHoldings']
  gvz: SlowDataSnapshot['gvz']
  indpro?: SlowDataSnapshot['indpro']
  semiProduction?: SlowDataSnapshot['semiProduction']
  metalsDfii10?: SlowDataSnapshot['metalsDfii10']
  metalsDgs10?: SlowDataSnapshot['metalsDgs10']
  metalsDollar?: SlowDataSnapshot['metalsDollar']
  metalsFedFunds?: SlowDataSnapshot['metalsFedFunds']
  gldFlow?: SlowDataSnapshot['gldFlow']
  slvFlow?: SlowDataSnapshot['slvFlow']
  metalsCalendar?: SlowDataSnapshot['metalsCalendar']
} | null> {
  if (!GOLD_CATEGORIES.has(category)) return null
  const silver = !instrument || isSilverInstrument(instrument)
  const platinum = !instrument || isPlatinumInstrument(instrument)

  const [
    realYield10y,
    disagg,
    cotHistory,
    gldHoldings,
    slvHoldings,
    gvz,
    indpro,
    semiProduction,
    metalsDfii10,
    metalsDgs10,
    metalsDollar,
    metalsFedFunds,
    gldFlow,
    slvFlow,
    metalsCalendar,
  ] = await Promise.all([
    fetchTreasuryRealYield10y(),
    fetchCftcDisaggText(),
    fetchCftcHistoryJson(),
    fetchEtfHoldings('GLD'),
    fetchEtfHoldings('SLV'),
    fetchFredSeries('GVZCLS'),
    silver ? fetchFredSeries('INDPRO') : Promise.resolve(null),
    silver ? fetchFredSeries('IPG3344S') : Promise.resolve(null),
    fetchFredChange('DFII10'),
    fetchFredChange('DGS10'),
    fetchFredChange('DTWEXBGS'),
    fetchFredChange('DFF'),
    fetchEtfFlow('GLD'),
    fetchEtfFlow('SLV'),
    fetchMetalsCalendar(opts?.horizon),
  ])
  const cotGold = mergeCotHistory(cotOrFail(disagg, CFTC_GOLD_CODE), cotHistory, CFTC_GOLD_CODE)
  const cotSilver = mergeCotHistory(cotOrFail(disagg, CFTC_SILVER_CODE), cotHistory, CFTC_SILVER_CODE)
  return {
    realYield10y,
    cotGold,
    cotSilver,
    ...(platinum
      ? {
          cotPlatinum: cotOrFail(disagg, CFTC_PLATINUM_CODE),
          cotPalladium: cotOrFail(disagg, CFTC_PALLADIUM_CODE),
        }
      : {}),
    gldHoldings,
    slvHoldings,
    gvz,
    ...(silver && indpro ? { indpro } : {}),
    ...(silver && semiProduction ? { semiProduction } : {}),
    metalsDfii10,
    metalsDgs10,
    metalsDollar,
    metalsFedFunds,
    gldFlow,
    slvFlow,
    metalsCalendar,
  }
}
