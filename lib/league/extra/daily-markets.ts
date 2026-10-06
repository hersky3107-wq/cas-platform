/**
 * Daily and weekly price markets for the consensus extra seat (pure).
 *
 * A price round asks "is the close at resolves_at above the round's reference?".
 * Kalshi strike ladders (KXINX, KXEURUSD, KXBTCD…) price P(settle > X) directly;
 * Polymarket "<Asset> Up or Down on <date>" prices P(close > open) for one day.
 * Relevance = asset tracking × how much of the round's window the market covers,
 * so a 1-day market on a 1-month round falls below MARKET_RELEVANCE_MIN.
 */

import { usesTradingSessions } from '../horizon'
import type { DailyMarketSpec } from './daily-market-specs'
import { acceptMarketPick, type AcceptedMarketMatch, type MarketVenue } from './market-match'
import { asList, yesFromDollars } from './market-search'

export type PriceWindow = { startMs: number; endMs: number }

export type PriceRoundTiming = {
  category: string | null
  instrument: string | null
  resolves_at: string | null
  opened_at?: string | null
  anchor_price_at?: string | null
  anchor_session_date?: string | null
}

export type KalshiEventRow = { eventTicker: string; seriesTicker: string; strikeAt: string }

export type KalshiStrikeType = 'greater' | 'greater_or_equal' | 'less' | 'less_or_equal' | 'between'

export type KalshiStrikeMarket = {
  ticker: string
  strikeType: KalshiStrikeType
  floor: number | null
  cap: number | null
  yes: number
}

export type KalshiSettledValue = { eventTicker: string; strikeAt: string; value: number }

export type DailyMarketCandidate = {
  venue: MarketVenue
  id: string
  title: string
  outcome: string
  impliedYes: number
  resolvesAt: string
  windowStartMs: number
}

const HOUR_MS = 3_600_000
const DAY_MS = 86_400_000
/** A venue settlement this far before the round start can still be its reference (covers weekends). */
const VENUE_REFERENCE_LOOKBACK_MS = 4 * DAY_MS
const VENUE_REFERENCE_LOOKAHEAD_MS = 6 * HOUR_MS
const STRIKE_TYPES: ReadonlySet<string> = new Set(['greater', 'greater_or_equal', 'less', 'less_or_equal', 'between'])

function asRecord(raw: unknown): Record<string, unknown> | null {
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null
}

function asArray(raw: unknown): unknown[] {
  return Array.isArray(raw) ? raw : []
}

function finiteOrNull(raw: unknown): number | null {
  if (raw == null || raw === '') return null
  const n = typeof raw === 'number' ? raw : Number(raw)
  return Number.isFinite(n) ? n : null
}

function isoOrNull(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const ms = Date.parse(raw)
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null
}

/* ── Kalshi ─────────────────────────────────────────────────────────────── */

/** GET /trade-api/v2/events?series_ticker=…&status=open */
export function parseKalshiEventList(body: unknown): KalshiEventRow[] {
  const out: KalshiEventRow[] = []
  for (const raw of asArray(asRecord(body)?.events)) {
    const row = asRecord(raw)
    const eventTicker = typeof row?.event_ticker === 'string' ? row.event_ticker : ''
    const seriesTicker = typeof row?.series_ticker === 'string' ? row.series_ticker : ''
    const strikeAt = isoOrNull(row?.strike_date)
    if (!eventTicker || !strikeAt) continue
    out.push({ eventTicker, seriesTicker, strikeAt })
  }
  return out
}

/** GET /trade-api/v2/events/{ticker} — the strike ladder with live prices. */
export function parseKalshiEventMarkets(body: unknown): KalshiStrikeMarket[] {
  const out: KalshiStrikeMarket[] = []
  for (const raw of asArray(asRecord(body)?.markets)) {
    const m = asRecord(raw)
    if (!m) continue
    const ticker = typeof m.ticker === 'string' ? m.ticker : ''
    const strikeType = typeof m.strike_type === 'string' ? m.strike_type : ''
    if (!ticker || !STRIKE_TYPES.has(strikeType)) continue
    if (typeof m.status === 'string' && !['active', 'open', 'initialized'].includes(m.status)) continue
    const yes = yesFromDollars(m.yes_bid_dollars, m.yes_ask_dollars, m.last_price_dollars)
    if (yes == null) continue
    out.push({
      ticker,
      strikeType: strikeType as KalshiStrikeType,
      floor: finiteOrNull(m.floor_strike),
      cap: finiteOrNull(m.cap_strike),
      yes,
    })
  }
  return out
}

/** GET /trade-api/v2/events?status=settled&with_nested_markets=true — the venue's own settled values. */
export function parseKalshiSettledValues(body: unknown): KalshiSettledValue[] {
  const out: KalshiSettledValue[] = []
  for (const raw of asArray(asRecord(body)?.events)) {
    const row = asRecord(raw)
    const eventTicker = typeof row?.event_ticker === 'string' ? row.event_ticker : ''
    const strikeAt = isoOrNull(row?.strike_date)
    if (!eventTicker || !strikeAt) continue
    let value: number | null = null
    for (const m of asArray(row?.markets)) {
      value = finiteOrNull(asRecord(m)?.expiration_value)
      if (value != null) break
    }
    if (value != null && value > 0) out.push({ eventTicker, strikeAt, value })
  }
  return out
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000
}

function clampProbability(p: number): number {
  return Math.min(0.99, Math.max(0.01, p))
}

/**
 * P(settle > reference) off one event's ladder. Threshold ladders (greater /
 * less) give it directly at the nearest strike; range ladders (between) sum
 * every bucket at or above the reference, normalized by the ladder total.
 */
export function probabilityAbove(
  markets: readonly KalshiStrikeMarket[],
  reference: number,
): { probability: number; ticker: string } | null {
  if (!Number.isFinite(reference) || reference <= 0 || markets.length === 0) return null

  const thresholds = markets
    .map((m) => {
      if ((m.strikeType === 'greater' || m.strikeType === 'greater_or_equal') && m.floor != null) {
        return { strike: m.floor, above: m.yes, ticker: m.ticker }
      }
      if ((m.strikeType === 'less' || m.strikeType === 'less_or_equal') && m.cap != null) {
        return { strike: m.cap, above: 1 - m.yes, ticker: m.ticker }
      }
      return null
    })
    .filter((t): t is { strike: number; above: number; ticker: string } => t != null)

  const ranges = markets.filter((m) => m.strikeType === 'between' && m.floor != null && m.cap != null)

  if (ranges.length >= 3) {
    const lows = markets.filter((m) => m.strikeType === 'less' && m.cap != null)
    const highs = markets.filter((m) => m.strikeType === 'greater' && m.floor != null)
    const lowest = Math.min(...ranges.map((m) => m.floor as number))
    const highest = Math.max(...ranges.map((m) => m.cap as number))
    if (reference <= lowest || reference >= highest) return null
    const total = [...ranges, ...lows, ...highs].reduce((sum, m) => sum + m.yes, 0)
    if (total <= 0) return null
    let above = highs.reduce((sum, m) => sum + m.yes, 0)
    let nearest: KalshiStrikeMarket | null = null
    for (const m of ranges) {
      const floor = m.floor as number
      const cap = m.cap as number
      if (floor >= reference) above += m.yes
      else if (cap > reference) {
        above += m.yes * ((cap - reference) / (cap - floor))
        nearest = m
      }
    }
    return {
      probability: round3(clampProbability(above / total)),
      ticker: (nearest ?? ranges[0]!).ticker,
    }
  }

  if (thresholds.length === 0) return null
  const sorted = [...thresholds].sort((a, b) => a.strike - b.strike)
  for (let i = 0; i < sorted.length - 1; i++) {
    const lo = sorted[i]!
    const hi = sorted[i + 1]!
    if (lo.strike <= reference && reference <= hi.strike) {
      const span = hi.strike - lo.strike
      const t = span > 0 ? (reference - lo.strike) / span : 0
      const nearest = t <= 0.5 ? lo : hi
      return {
        probability: round3(clampProbability(lo.above + (hi.above - lo.above) * t)),
        ticker: nearest.ticker,
      }
    }
  }
  const strikes = sorted.map((t) => t.strike)
  const step = strikes.length >= 2 ? (strikes[strikes.length - 1]! - strikes[0]!) / (strikes.length - 1) : 0
  const edge = reference < sorted[0]!.strike ? sorted[0]! : sorted[sorted.length - 1]!
  if (Math.abs(edge.strike - reference) > Math.max(step, reference * 0.002)) return null
  return { probability: round3(clampProbability(edge.above)), ticker: edge.ticker }
}

/**
 * Settled value the venue itself recorded closest before the round started.
 * Used when the venue's unit differs from the instrument (S&P 500 vs SPY).
 */
export function venueReferenceFor(
  settled: readonly KalshiSettledValue[],
  roundStartMs: number,
): KalshiSettledValue | null {
  let best: KalshiSettledValue | null = null
  let bestMs = -Infinity
  for (const row of settled) {
    const ms = Date.parse(row.strikeAt)
    if (!Number.isFinite(ms)) continue
    if (ms > roundStartMs + VENUE_REFERENCE_LOOKAHEAD_MS) continue
    if (ms < roundStartMs - VENUE_REFERENCE_LOOKBACK_MS) continue
    if (ms > bestMs) {
      best = row
      bestMs = ms
    }
  }
  return best
}

function formatLevel(value: number): string {
  if (value >= 1000) return value.toLocaleString('en-US', { maximumFractionDigits: 2 })
  if (value >= 10) return value.toFixed(2)
  return value.toFixed(4)
}

export function kalshiLadderCandidate(args: {
  event: KalshiEventRow
  markets: readonly KalshiStrikeMarket[]
  reference: number
  referenceStartMs: number
  underlying: string
}): DailyMarketCandidate | null {
  const above = probabilityAbove(args.markets, args.reference)
  if (!above) return null
  const level = formatLevel(args.reference)
  return {
    venue: 'kalshi',
    id: args.event.eventTicker,
    title: `${args.underlying} above ${level} at ${args.event.strikeAt}`,
    outcome: `above ${level}`,
    impliedYes: above.probability,
    resolvesAt: args.event.strikeAt,
    windowStartMs: args.referenceStartMs,
  }
}

/* ── Polymarket ─────────────────────────────────────────────────────────── */

const UP_OR_DOWN_RE = /\bup or down\b/i
const INTRADAY_RE = /\b\d{1,2}(?::\d{2})?\s*(?:am|pm)\b|\bhourly\b|\b\d+\s*(?:m|min|minutes?)\b/i

/** public-search events → "<Asset> Up or Down on <date>" daily markets, Up priced as yes. */
export function parsePolymarketDailyUpDown(body: unknown, asset: string): DailyMarketCandidate[] {
  const out: DailyMarketCandidate[] = []
  const assetRe = new RegExp(`\\b${asset.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i')
  for (const rawEvent of asArray(asRecord(body)?.events)) {
    const event = asRecord(rawEvent)
    if (!event || event.closed === true) continue
    const eventTitle = typeof event.title === 'string' ? event.title : ''
    for (const rawMarket of asArray(event.markets)) {
      const m = asRecord(rawMarket)
      if (!m || m.closed === true || m.active === false) continue
      const title = typeof m.question === 'string' && m.question ? m.question : eventTitle
      if (!UP_OR_DOWN_RE.test(title) || !assetRe.test(title) || INTRADAY_RE.test(title)) continue
      const outcomes = asList(m.outcomes).map((o) => o.trim().toLowerCase())
      const prices = asList(m.outcomePrices).map(Number)
      const upIndex = outcomes.indexOf('up')
      if (upIndex < 0 || outcomes.indexOf('down') < 0) continue
      const up = prices[upIndex]
      if (up == null || !Number.isFinite(up) || up <= 0 || up >= 1) continue
      const resolvesAt = isoOrNull(m.endDate) ?? isoOrNull(event.endDate)
      if (!resolvesAt) continue
      const startIso = isoOrNull(m.eventStartTime) ?? isoOrNull(event.startTime)
      const endMs = Date.parse(resolvesAt)
      const windowStartMs = startIso ? Date.parse(startIso) : endMs - DAY_MS
      if (!(windowStartMs < endMs) || endMs - windowStartMs > 2 * DAY_MS) continue
      const id = String(m.slug ?? m.id ?? event.slug ?? event.id ?? '')
      if (!id) continue
      out.push({ venue: 'polymarket', id, title, outcome: 'Up', impliedYes: round3(up), resolvesAt, windowStartMs })
    }
  }
  return out
}

/* ── Round window and relevance ─────────────────────────────────────────── */

const NY_TIME_ZONE = 'America/New_York'

function nyOffsetMs(instantMs: number): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: NY_TIME_ZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(new Date(instantMs))
      .filter((p) => p.type !== 'literal')
      .map((p) => [p.type, p.value]),
  )
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
  )
  return asUtc - instantMs
}

/** 16:00 New York on a civil date, as a UTC instant. */
export function usCloseMs(ymd: string): number {
  const wallAsUtc = Date.parse(`${ymd}T16:00:00Z`)
  return wallAsUtc - nyOffsetMs(wallAsUtc + 4 * HOUR_MS)
}

/** The price interval the round grades on: reference close → resolving close. */
export function roundPriceWindow(round: PriceRoundTiming): PriceWindow | null {
  if (!round.resolves_at || !round.instrument) return null
  const equity = usesTradingSessions(round.category ?? '', round.instrument)
  const endMs = equity ? usCloseMs(round.resolves_at.slice(0, 10)) : Date.parse(round.resolves_at)
  let startMs: number
  if (round.anchor_session_date) {
    startMs = equity
      ? usCloseMs(round.anchor_session_date)
      : Date.parse(`${round.anchor_session_date}T23:59:59.999Z`)
  } else {
    startMs = Date.parse(round.anchor_price_at ?? round.opened_at ?? '')
  }
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs >= endMs) return null
  return { startMs, endMs }
}

/** Overlap over the longer window, square-rooted: 1 for the same window, ~0.3 for 1 day of 10. */
export function windowAlignment(round: PriceWindow, market: PriceWindow): number {
  const overlap = Math.min(round.endMs, market.endMs) - Math.max(round.startMs, market.startMs)
  if (overlap <= 0) return 0
  const longer = Math.max(round.endMs - round.startMs, market.endMs - market.startMs)
  if (longer <= 0) return 0
  return Math.sqrt(overlap / longer)
}

export function dailyMarketRelevance(
  candidate: DailyMarketCandidate,
  roundWindow: PriceWindow,
  assetRelevance: number,
): number {
  const marketWindow = { startMs: candidate.windowStartMs, endMs: Date.parse(candidate.resolvesAt) }
  return round3(assetRelevance * windowAlignment(roundWindow, marketWindow))
}

/** Kalshi events worth fetching for this round: strike near the round end, best aligned first. */
export function rankKalshiEvents(
  events: readonly KalshiEventRow[],
  roundWindow: PriceWindow,
  referenceStartMs: number,
): KalshiEventRow[] {
  return events
    .map((event) => {
      const endMs = Date.parse(event.strikeAt)
      const alignment = windowAlignment(roundWindow, { startMs: referenceStartMs, endMs })
      return { event, alignment, gap: Math.abs(endMs - roundWindow.endMs) }
    })
    .filter((row) => row.alignment > 0 && row.gap <= 7 * DAY_MS)
    .sort((a, b) => b.alignment - a.alignment || a.gap - b.gap)
    .map((row) => row.event)
}

/**
 * Highest-relevance candidate that clears acceptMarketPick (≥ 0.7, ±7 days).
 * Ties go to Polymarket, whose up/down market prices the round's own question.
 */
export function pickDailyMarket(args: {
  candidates: readonly DailyMarketCandidate[]
  roundWindow: PriceWindow
  spec: Pick<DailyMarketSpec, 'assetRelevance'>
}): AcceptedMarketMatch | null {
  const deadline = new Date(args.roundWindow.endMs).toISOString()
  let best: { candidate: DailyMarketCandidate; relevance: number } | null = null
  for (const candidate of args.candidates) {
    const relevance = dailyMarketRelevance(candidate, args.roundWindow, args.spec.assetRelevance)
    const accepted = acceptMarketPick({
      relevance,
      marketResolvesAt: candidate.resolvesAt,
      deadline,
      sameEvent: false,
    })
    if (!accepted) continue
    if (
      !best ||
      relevance > best.relevance ||
      (relevance === best.relevance && candidate.venue === 'polymarket' && best.candidate.venue !== 'polymarket')
    ) {
      best = { candidate, relevance }
    }
  }
  if (!best) return null
  const { candidate, relevance } = best
  return {
    venue: candidate.venue,
    id: candidate.id,
    title: candidate.title.slice(0, 300),
    outcome: candidate.outcome.slice(0, 120),
    impliedYes: candidate.impliedYes,
    relevance,
    resolvesAt: candidate.resolvesAt,
    sameEvent: false,
    brand: null,
    kind: 'price_direction',
  }
}
