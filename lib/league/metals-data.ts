import 'server-only'

import { XMLParser } from 'fast-xml-parser'
import { twelveDataGet } from './market-data'
import {
  GLD_OZ_PER_SHARE,
  SLV_OZ_PER_SHARE,
  TROY_OZ_PER_TONNE,
  holdingsFromShares,
  parseCftcManagedMoney,
  parseFredCsvLast,
  parseIsharesSharesOutstanding,
  parseSpdrGoldData,
  parseTreasuryRealYield10y,
  parseTreasuryRealYieldCsv,
  parseTwelveDataSharesOutstanding,
} from './metals-parse'
import type { CotPositioning, EtfHoldings, SlowDataSnapshot } from './closed-book-packet'

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
    const url = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${encodeURIComponent(seriesId)}`
    const res = await getText(url, { Accept: 'text/csv,text/plain,*/*' })
    if ('error' in res) return { unavailable: `FRED ${seriesId}: ${res.error}` }
    if (res.status !== 200) return { unavailable: `FRED ${seriesId}: HTTP ${res.status}` }
    if (/^\s*</.test(res.text)) return { unavailable: `FRED ${seriesId}: HTML (not CSV)` }
    const parsed = parseFredCsvLast(res.text)
    if (!parsed) return { unavailable: `FRED ${seriesId}: no numeric observation` }
    return parsed
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
} | null> {
  if (!GOLD_CATEGORIES.has(category)) return null
  const silver = !instrument || isSilverInstrument(instrument)
  const platinum = !instrument || isPlatinumInstrument(instrument)

  const [realYield10y, disagg, gldHoldings, slvHoldings, gvz, indpro, semiProduction] = await Promise.all([
    fetchTreasuryRealYield10y(),
    fetchCftcDisaggText(),
    fetchEtfHoldings('GLD'),
    fetchEtfHoldings('SLV'),
    fetchFredSeries('GVZCLS'),
    silver ? fetchFredSeries('INDPRO') : Promise.resolve(null),
    silver ? fetchFredSeries('IPG3344S') : Promise.resolve(null),
  ])
  const cotGold = cotOrFail(disagg, CFTC_GOLD_CODE)
  const cotSilver = cotOrFail(disagg, CFTC_SILVER_CODE)
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
  }
}
