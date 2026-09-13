import 'server-only'

import { XMLParser } from 'fast-xml-parser'
import { parseCftcManagedMoney, parseTreasuryRealYield10y, parseTreasuryRealYieldCsv } from './metals-parse'
import type { CotPositioning, EtfHoldings, SlowDataSnapshot } from './closed-book-packet'

/**
 * Free gold/metals packet feeds. Zero API-key cost.
 * Gold/silver ratio is omitted: GLD/SLV share prices are not ounces of
 * silver per ounce of gold, and issuer ounces-per-share is not fetchable
 * on the current free URLs. Never print a share-price quotient as the ratio.
 * Every field is source + as-of; failure is UNAVAILABLE, never guessed.
 */

const FETCH_TIMEOUT_MS = 45_000
const UA = 'cas-platform-league-research/1.0 (contact: admin@cas-platform.example)'

const CFTC_DISAGG_URL = 'https://www.cftc.gov/dea/newcot/f_disagg.txt'
export const CFTC_GOLD_CODE = '088691'
export const CFTC_SILVER_CODE = '084691'

type Fail = { unavailable: string }

async function getText(url: string): Promise<{ status: number; text: string } | { error: string }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { 'User-Agent': UA } })
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

const TROY_OZ_PER_TONNE = 32150.7466

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
  return { date, tonnes: t, ounces: oz }
}

export async function fetchEtfHoldings(symbol: 'GLD' | 'SLV'): Promise<EtfHoldings> {
  return memoDaily(`holdings|${symbol}`, async () => {
    const urls =
      symbol === 'GLD'
        ? [
            'https://www.spdrgoldshares.com/assets/dynamic/GLD/GLD_US_archive_EN.csv',
            'https://www.ssga.com/library-content/products/fund-data/etfs/us/holdings-daily-us-en-gld.csv',
          ]
        : [
            'https://www.ishares.com/us/products/239855/ishares-silver-trust-fund/1467271812596.ajax?fileType=csv&fileName=SLV_holdings&dataType=fund',
          ]
    const errors: string[] = []
    for (const url of urls) {
      const res = await getText(url)
      if ('error' in res) {
        errors.push(`${url}: ${res.error}`)
        continue
      }
      if (res.status !== 200) {
        errors.push(`${url}: HTTP ${res.status}`)
        continue
      }
      if (/^\s*</.test(res.text)) {
        errors.push(`${url}: HTML (bot wall or missing CSV)`)
        continue
      }
      const parsed = parseHoldingsText(res.text, symbol)
      if (!('unavailable' in parsed)) return parsed
      errors.push(parsed.unavailable)
    }
    return { unavailable: errors.join('; ') || `${symbol} holdings: no working issuer URL` }
  })
}

const GOLD_CATEGORIES = new Set(['gold_metal'])

export async function fetchMetalsSlowFields(category: string): Promise<{
  realYield10y: SlowDataSnapshot['realYield10y']
  cotGold: SlowDataSnapshot['cotGold']
  cotSilver: SlowDataSnapshot['cotSilver']
  gldHoldings: SlowDataSnapshot['gldHoldings']
  slvHoldings: SlowDataSnapshot['slvHoldings']
} | null> {
  if (!GOLD_CATEGORIES.has(category)) return null
  const [realYield10y, disagg, gldHoldings, slvHoldings] = await Promise.all([
    fetchTreasuryRealYield10y(),
    fetchCftcDisaggText(),
    fetchEtfHoldings('GLD'),
    fetchEtfHoldings('SLV'),
  ])
  const cotGold = 'unavailable' in disagg ? disagg : cotFromDisaggText(disagg.text, CFTC_GOLD_CODE)
  const cotSilver = 'unavailable' in disagg ? disagg : cotFromDisaggText(disagg.text, CFTC_SILVER_CODE)
  return {
    realYield10y,
    cotGold,
    cotSilver,
    gldHoldings,
    slvHoldings,
  }
}
