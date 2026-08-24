import 'server-only'

import { twelveDataGet } from './market-data'
import type { ConsensusSnapshot, CryptoSnapshot } from './closed-book-packet'

/**
 * Extra numeric context for the closed-book packet. NO AI CALLS.
 * Twelve Data consensus: 5 credits (Basic endpoints confirmed live).
 * Crypto: Binance + Deribit public, $0, no key.
 */

const FETCH_MS = 12_000

function num(v: unknown): number | null {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

export async function fetchMarketConsensus(symbol: string): Promise<ConsensusSnapshot> {
  const fetchedAt = new Date().toISOString()
  const [targetRes, recRes, ratingsRes, epsRes, earnRes] = await Promise.all([
    twelveDataGet('price_target', { symbol }),
    twelveDataGet('recommendations', { symbol }),
    twelveDataGet('analyst_ratings/light', { symbol }),
    twelveDataGet('eps_trend', { symbol }),
    twelveDataGet('earnings', { symbol }),
  ])

  const priceTarget = !targetRes.ok
    ? { unavailable: `Twelve Data /price_target: ${targetRes.error}` }
    : (() => {
        const t = targetRes.json?.price_target ?? {}
        const high = num(t.high)
        const median = num(t.median)
        const low = num(t.low)
        const average = num(t.average)
        if (high == null || median == null || low == null || average == null) {
          return { unavailable: 'Twelve Data /price_target: missing hi/median/lo/avg' }
        }
        return {
          high,
          median,
          low,
          average,
          current: num(t.current),
          currency: typeof t.currency === 'string' ? t.currency : null,
        }
      })()

  const recommendations = !recRes.ok
    ? { unavailable: `Twelve Data /recommendations: ${recRes.error}` }
    : (() => {
        const m = recRes.json?.trends?.current_month
        if (!m) return { unavailable: 'Twelve Data /recommendations: no current_month' }
        return {
          strongBuy: num(m.strong_buy) ?? 0,
          buy: num(m.buy) ?? 0,
          hold: num(m.hold) ?? 0,
          sell: num(m.sell) ?? 0,
          strongSell: num(m.strong_sell) ?? 0,
        }
      })()

  const latestRating = !ratingsRes.ok
    ? { unavailable: `Twelve Data /analyst_ratings/light: ${ratingsRes.error}` }
    : (() => {
        const rows = Array.isArray(ratingsRes.json?.ratings) ? ratingsRes.json.ratings : []
        const first = rows[0]
        if (!first) return { unavailable: 'Twelve Data /analyst_ratings/light: empty' }
        return {
          date: String(first.date ?? 'unknown'),
          firm: String(first.firm ?? 'unknown'),
          rating: String(first.rating_current ?? first.rating_change ?? 'unknown'),
        }
      })()

  const epsTrend = !epsRes.ok
    ? { unavailable: `Twelve Data /eps_trend: ${epsRes.error}` }
    : (() => {
        const rows = Array.isArray(epsRes.json?.eps_trend) ? epsRes.json.eps_trend : []
        const cq = rows.find((r: { period?: string }) => r?.period === 'current_quarter') ?? rows[0]
        const est = num(cq?.current_estimate)
        if (!cq || est == null) return { unavailable: 'Twelve Data /eps_trend: no current_estimate' }
        return { period: String(cq.period ?? 'unknown'), currentEstimate: est }
      })()

  const lastEarnings = !earnRes.ok
    ? { unavailable: `Twelve Data /earnings: ${earnRes.error}` }
    : (() => {
        const rows = Array.isArray(earnRes.json?.earnings) ? earnRes.json.earnings : []
        const row = rows.find((r: { eps_actual?: unknown }) => num(r?.eps_actual) != null) ?? rows[0]
        const actual = num(row?.eps_actual)
        if (!row || actual == null) return { unavailable: 'Twelve Data /earnings: no eps_actual' }
        return {
          date: String(row.date ?? 'unknown'),
          actual,
          estimate: num(row.eps_estimate),
          surprisePct: num(row.surprise_prc),
        }
      })()

  return { fetchedAt, priceTarget, recommendations, lastEarnings, latestRating, epsTrend }
}

function binanceSymbol(instrument: string): string | null {
  const raw = instrument.trim().toUpperCase().replace('-', '/')
  if (raw === 'BTC/USD' || raw === 'BTCUSDT') return 'BTCUSDT'
  if (raw === 'ETH/USD' || raw === 'ETHUSDT') return 'ETHUSDT'
  if (raw === 'SOL/USD' || raw === 'SOLUSDT') return 'SOLUSDT'
  if (raw === 'DOGE/USD' || raw === 'DOGEUSDT') return 'DOGEUSDT'
  if (raw.includes('/')) {
    const [base, quote] = raw.split('/')
    if (quote === 'USD' || quote === 'USDT') return `${base}USDT`
  }
  return null
}

function deribitCurrency(instrument: string): string | null {
  const s = instrument.toUpperCase()
  if (s.startsWith('BTC')) return 'BTC'
  if (s.startsWith('ETH')) return 'ETH'
  if (s.startsWith('SOL')) return 'SOL'
  return null
}

async function getJson(url: string): Promise<{ ok: true; json: any } | { ok: false; error: string }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_MS)
  try {
    const res = await fetch(url, { signal: controller.signal })
    const text = await res.text()
    if (!res.ok) return { ok: false, error: `HTTP ${res.status} ${text.slice(0, 160)}` }
    return { ok: true, json: JSON.parse(text) }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, error: msg }
  } finally {
    clearTimeout(timer)
  }
}

export async function fetchCryptoContext(instrument: string): Promise<CryptoSnapshot> {
  const fetchedAt = new Date().toISOString()
  const bsym = binanceSymbol(instrument)
  const dcur = deribitCurrency(instrument)

  const funding =
    !bsym
      ? { unavailable: `no Binance perp mapping for ${instrument}` }
      : await (async () => {
          const r = await getJson(`https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${bsym}`)
          if (!r.ok) return { unavailable: `Binance /fapi/v1/premiumIndex: ${r.error}` }
          const rate = num(r.json?.lastFundingRate)
          if (rate == null) return { unavailable: 'Binance /fapi/v1/premiumIndex: no lastFundingRate' }
          const nextMs = num(r.json?.nextFundingTime)
          return {
            rate,
            nextFundingTime: nextMs != null ? new Date(nextMs).toISOString() : null,
          }
        })()

  const openInterest =
    !bsym
      ? { unavailable: `no Binance perp mapping for ${instrument}` }
      : await (async () => {
          const r = await getJson(`https://fapi.binance.com/fapi/v1/openInterest?symbol=${bsym}`)
          if (!r.ok) return { unavailable: `Binance /fapi/v1/openInterest: ${r.error}` }
          const contracts = num(r.json?.openInterest)
          if (contracts == null) return { unavailable: 'Binance /fapi/v1/openInterest: no openInterest' }
          return { contracts }
        })()

  const markIv =
    !dcur
      ? { unavailable: `no Deribit currency mapping for ${instrument}` }
      : await (async () => {
          const r = await getJson(
            `https://www.deribit.com/api/v2/public/get_book_summary_by_currency?currency=${dcur}&kind=option`,
          )
          if (!r.ok) return { unavailable: `Deribit get_book_summary_by_currency: ${r.error}` }
          const rows: any[] = Array.isArray(r.json?.result) ? r.json.result : []
          let best: { iv: number; oi: number; name: string } | null = null
          for (const row of rows) {
            const iv = num(row?.mark_iv)
            const oi = num(row?.open_interest) ?? 0
            if (iv == null) continue
            if (!best || oi > best.oi) best = { iv, oi, name: String(row.instrument_name ?? 'unknown') }
          }
          if (!best) return { unavailable: 'Deribit book_summary: no mark_iv on listed options' }
          return { ivPct: best.iv, instrument: best.name }
        })()

  return { fetchedAt, funding, openInterest, markIv }
}

export function wantsCryptoContext(category: string): boolean {
  return category === 'crypto_spot' || category === 'crypto_perps' || category === 'memecoin'
}

/** Equities/ETFs have the analyst endpoints; FX/crypto/commodities typically do not. */
export function wantsConsensus(category: string): boolean {
  return category === 'stock' || category === 'etf_index'
}
