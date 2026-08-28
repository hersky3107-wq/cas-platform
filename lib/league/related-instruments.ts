import 'server-only'

import { mapInstrumentToTwelveData, twelveDataGet } from './market-data'
import { relationsFor } from './relations'
import { computeRelatedStats } from './related-stats'
import type { RelatedInstrumentStat, SeriesBar } from './closed-book-packet'

/**
 * Packet v2 (A) — RELATED INSTRUMENTS fetch (server engine only).
 *
 * One `time_series` call (1 Twelve Data credit) per related symbol, cached
 * by (symbol, UTC day): the shared heavyweights (SPY/QQQ/VIXY/UUP/TLT) cost
 * ~0 credits across rounds in the same day, and instrument-specific symbols
 * are free on a same-day re-generate. Stats are computed by the PURE
 * `related-stats.ts`; a failed fetch becomes an UNAVAILABLE stat line,
 * never a guess and never a thrown error.
 *
 * THROTTLE: `twelveDataGet` already serializes against the 7-credit/min
 * budget. Callers should run this CONCURRENTLY with the research step (AI
 * seconds are free Twelve Data seconds) — see the orchestrator.
 */

/** 90 daily bars: 20-session corr/beta + 60-pair lead-lag + buffer. Still 1 credit. */
export const RELATED_SERIES_OUTPUT_SIZE = 90
/** Minimum anchor bars before related stats are worth computing. */
const MIN_ANCHOR_BARS = 25

export type RelatedInstrumentsResult = {
  stats: RelatedInstrumentStat[]
  /** Twelve Data credits actually spent (cache hits are free). */
  creditsSpent: number
  cacheHits: number
}

/** (symbol|utcDay) → bars. Success-only cache; failures retry next call. */
const seriesDayCache = new Map<string, SeriesBar[]>()
const DAY_CACHE_MAX = 200

function utcDay(): string {
  return new Date().toISOString().slice(0, 10)
}

async function fetchRelatedSeries(symbol: string): Promise<{ bars: SeriesBar[]; cached: boolean } | { error: string }> {
  const key = `${symbol}|${utcDay()}`
  const hit = seriesDayCache.get(key)
  if (hit) return { bars: hit, cached: true }

  const mapped = mapInstrumentToTwelveData(symbol)
  if (!mapped) return { error: `no Twelve Data mapping for ${symbol}` }

  const params: Record<string, string> = {
    symbol: mapped.symbol,
    interval: '1day',
    outputsize: String(RELATED_SERIES_OUTPUT_SIZE),
  }
  if (mapped.exchange) params.exchange = mapped.exchange

  const res = await twelveDataGet('time_series', params)
  if (!res.ok) return { error: res.error }

  const values: unknown[] = Array.isArray(res.json?.values) ? res.json.values : []
  const bars = values
    .map((v) => {
      const row = v as { datetime?: unknown; close?: unknown }
      const close = Number(row?.close)
      return { date: String(row?.datetime ?? ''), close }
    })
    .filter((b): b is SeriesBar => Number.isFinite(b.close) && !!b.date)
    .reverse() // Twelve Data returns newest-first

  if (!bars.length) return { error: 'time_series returned no usable bars' }

  if (seriesDayCache.size >= DAY_CACHE_MAX) {
    // Day rolled over or map grew unbounded — drop stale entries wholesale.
    const today = utcDay()
    for (const k of seriesDayCache.keys()) {
      if (!k.endsWith(today)) seriesDayCache.delete(k)
    }
  }
  seriesDayCache.set(key, bars)
  return { bars, cached: false }
}

/**
 * Related-instrument stats for a round's anchor. Null when the instrument
 * has no relations entry or the anchor series is too short to compare.
 */
export async function fetchRelatedInstruments(
  instrument: string,
  anchorSeries: readonly SeriesBar[],
): Promise<RelatedInstrumentsResult | null> {
  const entry = relationsFor(instrument)
  if (!entry || !entry.related.length) return null
  if (anchorSeries.length < MIN_ANCHOR_BARS) return null

  const stats: RelatedInstrumentStat[] = []
  let creditsSpent = 0
  let cacheHits = 0

  // Sequential on purpose: twelveDataGet serializes on the credit window
  // anyway, and sequential keeps the UNAVAILABLE attribution per symbol clean.
  for (const ref of entry.related) {
    const base = { symbol: ref.symbol, role: ref.role, note: ref.note }
    const res = await fetchRelatedSeries(ref.symbol)
    if ('error' in res) {
      stats.push({ ...base, unavailable: res.error })
      continue
    }
    if (res.cached) cacheHits += 1
    else creditsSpent += 1

    const computed = computeRelatedStats(anchorSeries, res.bars)
    if (!computed) {
      stats.push({ ...base, unavailable: 'series returned but no aligned sessions with the anchor' })
      continue
    }
    stats.push({
      ...base,
      lastClose: computed.lastClose,
      lastDate: computed.lastDate,
      move1dPct: computed.move1dPct,
      corr: computed.corr,
      beta: computed.beta,
      leadLag: computed.leadLag,
    })
  }

  return { stats, creditsSpent, cacheHits }
}
