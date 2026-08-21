/**
 * AI Prediction League — RESOLUTION CONTRACT (pure, no I/O).
 *
 * This is the credibility layer: it decides, from a round's PERSISTED baseline
 * and a fetched daily-close series, exactly which number and which session date
 * a round is graded against — or refuses to grade at all.
 *
 * THE CONTRACT:
 *  - baseline  = `prediction_rounds.anchor_price`, observed at `anchor_price_at`.
 *                Never re-derived, never re-fetched, never inferred from a
 *                "previous close" the provider happens to report today.
 *  - resolution = the close of the LAST daily session that closed strictly
 *                AFTER `anchor_price_at` and at or before `resolves_at`.
 *  - direction  = resolution > anchor -> 'up'; resolution < anchor -> 'down'.
 *
 * NO FLAT BAND. The propositions this grades are binary ("closes higher than
 * its last close") and the models only ever answer up/down, so a third outcome
 * they could not have predicted must never be invented. On an EXACTLY equal
 * close the round is left UNRESOLVABLE rather than arbitrarily rewarding one
 * side.
 *
 * EVERY failure path is explicit and returns a reason. Nothing here guesses:
 * an ungraded round is acceptable, a wrongly graded one is not.
 *
 * SESSION-CLOSE CONVENTION: a daily bar dated D is treated as closing at the
 * END of UTC day D. Twelve Data's 1-day bars carry a date, not a close
 * timestamp, and we deliberately do not model per-exchange closing bells here.
 * Two consequences, both chosen:
 *  - UPPER bound: a bar is only eligible once its whole UTC day fits inside the
 *    window, so a deadline falling between a real closing bell and midnight UTC
 *    yields an EARLIER in-window session (or 'no_session_in_window') — never a
 *    price from after the deadline.
 *  - LOWER bound: a bar dated the same UTC day as the anchor observation IS
 *    eligible (that is the normal case — rounds open outside US market hours, so
 *    the anchor is the PREVIOUS session's close and the same-day bar closes
 *    later). When the anchor was instead taken FROM that session's close, the
 *    two prices coincide and the round is refused as 'equal_close' rather than
 *    graded against a price that predates its own baseline.
 */

/** One daily close from the price series. `sessionDate` is 'YYYY-MM-DD' (UTC-dated). */
export type DailyBar = { sessionDate: string; close: number }

/** The only two outcomes a binary "higher/lower than its last close" round can have. */
export type ResolutionDirection = 'up' | 'down'

export type UnresolvableReason =
  /** Instrument is not a market price symbol (e.g. a 'MATCH:…' sports handle). */
  | 'not_price_instrument'
  /** No persisted baseline — anchor_price (or its timestamp) is null. */
  | 'missing_anchor'
  /** Timestamps unparseable, or resolves_at is not after anchor_price_at. */
  | 'invalid_window'
  /** The price-series call failed (HTTP/plan/rate-limit/timeout). */
  | 'series_unavailable'
  /** The call succeeded but returned no usable bars at all. */
  | 'no_series_data'
  /** Bars exist, but none closed inside (anchor_price_at, resolves_at] — weekend/holiday. */
  | 'no_session_in_window'
  /** Resolution close is exactly the anchor: nobody is wrong, so nobody is graded. */
  | 'equal_close'

/** What a graded round is graded against — persisted verbatim for later audit. */
export type ResolvedOutcome = {
  /** Human-readable audit string stored on `prediction_rounds.actual_outcome`. */
  rawOutcome: string
  actualDirection: ResolutionDirection
  anchorPrice: number
  anchorPriceAt: string
  resolutionPrice: number
  /** 'YYYY-MM-DD' session whose close was used. */
  resolutionSessionDate: string
}

export type ResolutionResult =
  | { ok: true; outcome: ResolvedOutcome }
  | { ok: false; reason: UnresolvableReason; detail: string }

/** The round fields grading is allowed to read. Nothing else influences a grade. */
export type RoundResolutionInput = {
  instrument: string
  anchorPrice: number | null
  anchorPriceAt: string | null
  resolvesAt: string
}

export type SeriesResult = { ok: true; bars: DailyBar[] } | { ok: false; error: string }

/** Normalizes '2026-08-18' / '2026-08-18 00:00:00' to '2026-08-18'; null when unusable. */
export function normalizeSessionDate(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const date = raw.trim().slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null
}

/** End of UTC day D — see the SESSION-CLOSE CONVENTION note above. */
function sessionCloseMs(sessionDate: string): number {
  return Date.parse(`${sessionDate}T23:59:59.999Z`)
}

function parseMs(iso: string | null): number | null {
  if (!iso) return null
  const ms = Date.parse(iso)
  return Number.isFinite(ms) ? ms : null
}

function isUsablePrice(value: number | null): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

export function toUtcDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

export function addUtcDays(date: string, days: number): string {
  return toUtcDate(Date.parse(`${date}T00:00:00.000Z`) + days * 86_400_000)
}

/**
 * Validates the baseline and the window BEFORE any network call, so a round
 * that can never be graded (no anchor) never spends a price-feed credit.
 * Returns null when the window is usable.
 */
export function precheckResolutionWindow(
  round: RoundResolutionInput
): { ok: false; reason: UnresolvableReason; detail: string } | null {
  if (!isUsablePrice(round.anchorPrice)) {
    return {
      ok: false,
      reason: 'missing_anchor',
      detail: 'anchor_price is null or unusable — round has no persisted baseline to grade against',
    }
  }
  if (!round.anchorPriceAt) {
    return { ok: false, reason: 'missing_anchor', detail: 'anchor_price_at is null — baseline has no observation time' }
  }

  const anchorMs = parseMs(round.anchorPriceAt)
  const resolvesMs = parseMs(round.resolvesAt)
  if (anchorMs === null || resolvesMs === null) {
    return {
      ok: false,
      reason: 'invalid_window',
      detail: `unparseable window (anchor_price_at=${round.anchorPriceAt}, resolves_at=${round.resolvesAt})`,
    }
  }
  if (resolvesMs <= anchorMs) {
    return {
      ok: false,
      reason: 'invalid_window',
      detail: `resolves_at (${round.resolvesAt}) is not after anchor_price_at (${round.anchorPriceAt})`,
    }
  }
  return null
}

/**
 * The last session that closed inside (anchorPriceAt, resolvesAt]. Null when
 * the window contains no session at all (weekend / holiday / too-short window).
 */
export function selectResolutionSession(bars: DailyBar[], anchorPriceAtMs: number, resolvesAtMs: number): DailyBar | null {
  let selected: DailyBar | null = null
  let selectedMs = -Infinity

  for (const bar of bars) {
    const closeMs = sessionCloseMs(bar.sessionDate)
    if (!Number.isFinite(closeMs)) continue
    if (closeMs <= anchorPriceAtMs) continue
    if (closeMs > resolvesAtMs) continue
    if (closeMs > selectedMs) {
      selected = bar
      selectedMs = closeMs
    }
  }

  return selected
}

function formatPrice(value: number): string {
  return String(Number(value))
}

/** The audit string persisted on `actual_outcome` — direction first, then the two numbers it came from. */
export function formatRawOutcome(outcome: Omit<ResolvedOutcome, 'rawOutcome'>): string {
  return (
    `${outcome.actualDirection} (${outcome.resolutionSessionDate} close ${formatPrice(outcome.resolutionPrice)} ` +
    `vs anchor ${formatPrice(outcome.anchorPrice)} @ ${outcome.anchorPriceAt})`
  )
}

/**
 * The whole grading decision, as a pure function of the round's persisted
 * baseline plus a fetched series. Every non-gradeable case returns a reason
 * instead of a direction — there is no fallback path that guesses a baseline,
 * a session, or a direction.
 */
export function resolveRoundOutcome(input: RoundResolutionInput & { series: SeriesResult }): ResolutionResult {
  const precheck = precheckResolutionWindow(input)
  if (precheck) return precheck

  // precheckResolutionWindow guarantees both of these.
  const anchorPrice = input.anchorPrice as number
  const anchorPriceAt = input.anchorPriceAt as string
  const anchorMs = Date.parse(anchorPriceAt)
  const resolvesMs = Date.parse(input.resolvesAt)

  if (!input.series.ok) {
    return { ok: false, reason: 'series_unavailable', detail: input.series.error }
  }

  const bars = input.series.bars.filter((bar) => normalizeSessionDate(bar.sessionDate) !== null && isUsablePrice(bar.close))
  if (bars.length === 0) {
    return { ok: false, reason: 'no_series_data', detail: 'price series returned no usable daily closes' }
  }

  const session = selectResolutionSession(bars, anchorMs, resolvesMs)
  if (!session) {
    return {
      ok: false,
      reason: 'no_session_in_window',
      detail: `no session closed in (${anchorPriceAt}, ${input.resolvesAt}] — saw ${bars
        .map((b) => b.sessionDate)
        .join(', ')}`,
    }
  }

  if (session.close === anchorPrice) {
    return {
      ok: false,
      reason: 'equal_close',
      detail: `${session.sessionDate} close equals anchor (${formatPrice(anchorPrice)}) — no up/down winner exists`,
    }
  }

  const graded = {
    actualDirection: (session.close > anchorPrice ? 'up' : 'down') as ResolutionDirection,
    anchorPrice,
    anchorPriceAt,
    resolutionPrice: session.close,
    resolutionSessionDate: session.sessionDate,
  }

  return { ok: true, outcome: { ...graded, rawOutcome: formatRawOutcome(graded) } }
}
