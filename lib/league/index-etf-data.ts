import 'server-only'

import { fetchFredSeries } from './metals-data'
import {
  CFTC_ES_CODE,
  CFTC_NIKKEI_YEN_CODE,
  CFTC_NQ_CODE,
  CFTC_VIX_CODE,
  CFTC_YM_CODE,
  cotFromLegacyText,
  cotFromTffText,
  indexEtfFieldPlan,
} from './index-etf-parse'
import type { CotPositioning, SlowDataSnapshot } from './closed-book-packet'

/**
 * Free index/ETF packet feeds. Zero API-key cost.
 * FRED VIXCLS + cash-index prints + CFTC TFF FinFutWk.txt (same parser as FX).
 * Per-chip isolation: TQQQ/SQQQ get NQ not ES; UPRO/SPXU get ES not NQ;
 * SOXL gets neither; EWY/EWT/FEZ have no COT (labeled).
 */

const FETCH_TIMEOUT_MS = 45_000
const UA = 'cas-platform-league-research/1.0 (contact: admin@cas-platform.example)'
const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'

const CFTC_TFF_URL = 'https://www.cftc.gov/dea/newcot/FinFutWk.txt'
const CFTC_LEGACY_URL = 'https://www.cftc.gov/dea/newcot/deafut.txt'

const INDEX_ETF_CATEGORIES = new Set(['etf_index'])

type Fail = { unavailable: string }
type CftcFile = { kind: 'tff' | 'legacy'; text: string }

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

async function fetchCftcIndexFile(): Promise<CftcFile | Fail> {
  return memoDaily('cftc-index-etf', async () => {
    const attempts: Array<{ url: string; kind: 'tff' | 'legacy' }> = [
      { url: CFTC_TFF_URL, kind: 'tff' },
      { url: CFTC_LEGACY_URL, kind: 'legacy' },
    ]
    const errors: string[] = []
    for (const { url, kind } of attempts) {
      const extras: Array<Record<string, string>> = [{}, { 'User-Agent': BROWSER_UA }]
      for (const extra of extras) {
        const res = await getText(url, extra)
        if ('error' in res) {
          errors.push(`${kind}: ${res.error}`)
          continue
        }
        if (res.status !== 200) {
          errors.push(`${kind}: HTTP ${res.status}`)
          continue
        }
        if (/^\s*</.test(res.text) || res.text.length < 200) {
          errors.push(`${kind}: empty/HTML`)
          continue
        }
        return { kind, text: res.text }
      }
    }
    return { unavailable: `CFTC index COT (FinFutWk.txt / deafut.txt): ${errors.join('; ')}` }
  })
}

function cotOrFail(file: CftcFile | Fail, contractCode: string): CotPositioning {
  if ('unavailable' in file) return file
  return file.kind === 'tff' ? cotFromTffText(file.text, contractCode) : cotFromLegacyText(file.text, contractCode)
}

export async function fetchIndexEtfSlowFields(
  category: string,
  instrument?: string,
): Promise<{
  vixcls?: SlowDataSnapshot['vixcls']
  sp500Fred?: SlowDataSnapshot['sp500Fred']
  nasdaqComFred?: SlowDataSnapshot['nasdaqComFred']
  djiaFred?: SlowDataSnapshot['djiaFred']
  nikkei225Fred?: SlowDataSnapshot['nikkei225Fred']
  cotEs?: SlowDataSnapshot['cotEs']
  cotNq?: SlowDataSnapshot['cotNq']
  cotYm?: SlowDataSnapshot['cotYm']
  cotNikkei?: SlowDataSnapshot['cotNikkei']
  cotVix?: SlowDataSnapshot['cotVix']
  indexEtfCotGap?: SlowDataSnapshot['indexEtfCotGap']
  indexEtfIdentityNote?: SlowDataSnapshot['indexEtfIdentityNote']
} | null> {
  if (!INDEX_ETF_CATEGORIES.has(category)) return null
  const plan = indexEtfFieldPlan(instrument)
  if (!plan) return {}

  const wantsAnyCot = plan.cotEs || plan.cotNq || plan.cotYm || plan.cotNikkei || plan.cotVix

  const [cftcFile, vixcls, sp500Fred, nasdaqComFred, djiaFred, nikkei225Fred] = await Promise.all([
    wantsAnyCot ? fetchCftcIndexFile() : Promise.resolve(null),
    fetchFredSeries('VIXCLS'),
    plan.fredIndex === 'SP500' ? fetchFredSeries('SP500') : Promise.resolve(null),
    plan.fredIndex === 'NASDAQCOM' ? fetchFredSeries('NASDAQCOM') : Promise.resolve(null),
    plan.fredIndex === 'DJIA' ? fetchFredSeries('DJIA') : Promise.resolve(null),
    plan.fredIndex === 'NIKKEI225' ? fetchFredSeries('NIKKEI225') : Promise.resolve(null),
  ])

  const cotFile = cftcFile ?? { unavailable: 'CFTC index COT not requested' }

  return {
    ...(vixcls ? { vixcls } : {}),
    ...(sp500Fred ? { sp500Fred } : {}),
    ...(nasdaqComFred ? { nasdaqComFred } : {}),
    ...(djiaFred ? { djiaFred } : {}),
    ...(nikkei225Fred ? { nikkei225Fred } : {}),
    ...(plan.cotEs ? { cotEs: cotOrFail(cotFile, CFTC_ES_CODE) } : {}),
    ...(plan.cotNq ? { cotNq: cotOrFail(cotFile, CFTC_NQ_CODE) } : {}),
    ...(plan.cotYm ? { cotYm: cotOrFail(cotFile, CFTC_YM_CODE) } : {}),
    ...(plan.cotNikkei ? { cotNikkei: cotOrFail(cotFile, CFTC_NIKKEI_YEN_CODE) } : {}),
    ...(plan.cotVix ? { cotVix: cotOrFail(cotFile, CFTC_VIX_CODE) } : {}),
    ...(plan.cotGapNote ? { indexEtfCotGap: { note: plan.cotGapNote } } : {}),
    ...(plan.identityNote ? { indexEtfIdentityNote: { note: plan.identityNote } } : {}),
  }
}
