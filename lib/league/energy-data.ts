import 'server-only'

import { cotFromDisaggText, fetchCftcDisaggText, fetchFredSeries } from './metals-data'
import { parseEiaWngsr, parseEiaWpsrTable1 } from './energy-parse'
import type { CotPositioning, SlowDataSnapshot } from './closed-book-packet'

/**
 * Free commodities/energy packet feeds. Zero API-key cost.
 * Crude (WTI/Brent): EIA WPSR inventory/production + CFTC COT + OVX.
 * Natgas (UNG): EIA WNGSR storage + CFTC COT. FINRA short % is wired in
 * slow-data.ts (US ticker). Every field is source + as-of; failure is
 * UNAVAILABLE, never guessed.
 */

const FETCH_TIMEOUT_MS = 45_000
const UA = 'cas-platform-league-research/1.0 (contact: admin@cas-platform.example)'
const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'

const EIA_WPSR_TABLE1_URL = 'https://ir.eia.gov/wpsr/table1.csv'
const EIA_WNGSR_JSON_URL = 'https://ir.eia.gov/ngs/wngsr.json'

export const CFTC_WTI_CODE = '067651'
export const CFTC_NATGAS_CODE = '023651'
export const CFTC_BRENT_CODE = '06765T'

const ENERGY_CATEGORIES = new Set(['commodity_energy', 'commodities_energy'])

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

function cotOrFail(disagg: { text: string } | Fail, contractCode: string): CotPositioning {
  if ('unavailable' in disagg) return disagg
  return cotFromDisaggText(disagg.text, contractCode)
}

async function fetchEiaWpsr(): Promise<Exclude<NonNullable<SlowDataSnapshot['eiaCrude']>, Fail> | Fail> {
  return memoDaily('eia-wpsr', async () => {
    const attempts: Array<Record<string, string>> = [
      { Accept: 'text/csv,text/plain,*/*' },
      { 'User-Agent': BROWSER_UA, Accept: 'text/csv,text/plain,*/*' },
    ]
    const errors: string[] = []
    for (const extra of attempts) {
      const res = await getText(EIA_WPSR_TABLE1_URL, extra)
      if ('error' in res) {
        errors.push(res.error)
        continue
      }
      if (res.status !== 200) {
        errors.push(`HTTP ${res.status}`)
        continue
      }
      if (/^\s*</.test(res.text)) {
        errors.push('HTML (not CSV)')
        continue
      }
      const parsed = parseEiaWpsrTable1(res.text)
      if (parsed) return parsed
      errors.push('no commercial/SPR/production/runs/supplied rows parsed')
    }
    return { unavailable: `EIA WPSR table1.csv: ${errors.join('; ')}` }
  })
}

async function fetchEiaWngsr(): Promise<Exclude<NonNullable<SlowDataSnapshot['eiaNatgas']>, Fail> | Fail> {
  return memoDaily('eia-wngsr', async () => {
    const attempts: Array<Record<string, string>> = [
      { Accept: 'application/json,text/plain,*/*' },
      { 'User-Agent': BROWSER_UA, Accept: 'application/json,text/plain,*/*' },
    ]
    const errors: string[] = []
    for (const extra of attempts) {
      const res = await getText(EIA_WNGSR_JSON_URL, extra)
      if ('error' in res) {
        errors.push(res.error)
        continue
      }
      if (res.status !== 200) {
        errors.push(`HTTP ${res.status}`)
        continue
      }
      if (/^\s*</.test(res.text)) {
        errors.push('HTML (not JSON)')
        continue
      }
      try {
        const parsed = parseEiaWngsr(JSON.parse(res.text) as unknown)
        if (parsed) return parsed
        errors.push('no Lower-48 storage series parsed')
      } catch {
        errors.push('invalid JSON')
      }
    }
    return { unavailable: `EIA WNGSR wngsr.json: ${errors.join('; ')}` }
  })
}

function instrumentKey(instrument?: string): string {
  return instrument?.trim().toUpperCase() ?? ''
}

function isNatgasInstrument(instrument?: string): boolean {
  const u = instrumentKey(instrument)
  return u === 'UNG' || u === 'BOIL' || u === 'KOLD' || u === 'NATGAS' || u === 'NATGAS/USD'
}

function isBrentInstrument(instrument?: string): boolean {
  const u = instrumentKey(instrument)
  return u === 'XBR/USD' || u === 'XBR' || u === 'BNO' || u === 'BRENT'
}

export async function fetchEnergySlowFields(
  category: string,
  instrument?: string,
): Promise<{
  eiaCrude?: SlowDataSnapshot['eiaCrude']
  eiaNatgas?: SlowDataSnapshot['eiaNatgas']
  cotWti?: SlowDataSnapshot['cotWti']
  cotBrent?: SlowDataSnapshot['cotBrent']
  cotNatgas?: SlowDataSnapshot['cotNatgas']
  ovx?: SlowDataSnapshot['ovx']
  wtiSpotFred?: SlowDataSnapshot['wtiSpotFred']
  brentSpotFred?: SlowDataSnapshot['brentSpotFred']
  henryHubSpotFred?: SlowDataSnapshot['henryHubSpotFred']
  gasolineRetail?: SlowDataSnapshot['gasolineRetail']
} | null> {
  if (!ENERGY_CATEGORIES.has(category)) return null

  const noInstrument = !instrumentKey(instrument)
  const natgas = noInstrument || isNatgasInstrument(instrument)
  const brent = noInstrument || isBrentInstrument(instrument)
  const wti = noInstrument || (!natgas && !brent)

  const [eiaCrude, eiaNatgas, disagg, ovx, wtiSpotFred, brentSpotFred, henryHubSpotFred, gasolineRetail] =
    await Promise.all([
      wti || brent ? fetchEiaWpsr() : Promise.resolve(null),
      natgas ? fetchEiaWngsr() : Promise.resolve(null),
      fetchCftcDisaggText(),
      wti || brent ? fetchFredSeries('OVXCLS') : Promise.resolve(null),
      wti ? fetchFredSeries('DCOILWTICO') : Promise.resolve(null),
      brent ? fetchFredSeries('DCOILBRENTEU') : Promise.resolve(null),
      natgas ? fetchFredSeries('DHHNGSP') : Promise.resolve(null),
      wti || brent ? fetchFredSeries('GASREGW') : Promise.resolve(null),
    ])

  return {
    ...(eiaCrude ? { eiaCrude } : {}),
    ...(eiaNatgas ? { eiaNatgas } : {}),
    ...(wti ? { cotWti: cotOrFail(disagg, CFTC_WTI_CODE) } : {}),
    ...(brent ? { cotBrent: cotOrFail(disagg, CFTC_BRENT_CODE) } : {}),
    ...(natgas ? { cotNatgas: cotOrFail(disagg, CFTC_NATGAS_CODE) } : {}),
    ...(ovx ? { ovx } : {}),
    ...(wtiSpotFred ? { wtiSpotFred } : {}),
    ...(brentSpotFred ? { brentSpotFred } : {}),
    ...(henryHubSpotFred ? { henryHubSpotFred } : {}),
    ...(gasolineRetail ? { gasolineRetail } : {}),
  }
}
