import type { SeriesBar } from './closed-book-packet'

/**
 * RELATED-INSTRUMENT statistics — PURE. No fetches, no AI calls.
 *
 * Packet v2 (A): the packet prints locally computed NUMBERS about each
 * related series (correlation, beta, lead-lag), never the raw series —
 * same numbers-first discipline as `computeBaseRate`.
 *
 * ALIGNMENT: an equity trades ~5 bars/week while crypto/FX print 7; all
 * pairwise stats are computed over DATE-ALIGNED closes (intersection of the
 * two series' session dates), and returns are taken between consecutive
 * aligned closes. `n` is always reported so a thin overlap is visible.
 */

/** Aligned return pairs used for the 20-session correlation/beta. */
export const RELATED_CORR_WINDOW = 20
/** Aligned return pairs used for lead-lag scans (more n for a noisier stat). */
export const LEAD_LAG_WINDOW = 60
/** Scan related returns at t-1..t-LEAD_LAG_MAX_LAG vs anchor return at t. */
export const LEAD_LAG_MAX_LAG = 5
/** A lead-lag line is printed ONLY when |r| clears this threshold. */
export const LEAD_LAG_MIN_ABS_R = 0.25
/** Minimum aligned return pairs before any stat is reported. */
export const RELATED_MIN_PAIRS = 10

export type LeadLagStat = { lag: number; r: number; n: number }

export type RelatedComputed = {
  lastClose: number
  lastDate: string
  /** Related series' own last 1-bar move, % — null when <2 bars. */
  move1dPct: number | null
  corr: { r: number; n: number } | null
  beta: { beta: number; n: number } | null
  /** Only lags whose |r| >= LEAD_LAG_MIN_ABS_R, ascending lag. */
  leadLag: LeadLagStat[]
}

export function pearson(x: readonly number[], y: readonly number[]): number | null {
  const n = Math.min(x.length, y.length)
  if (n < RELATED_MIN_PAIRS) return null
  let sx = 0
  let sy = 0
  for (let i = 0; i < n; i++) {
    sx += x[i]
    sy += y[i]
  }
  const mx = sx / n
  const my = sy / n
  let cov = 0
  let vx = 0
  let vy = 0
  for (let i = 0; i < n; i++) {
    const dx = x[i] - mx
    const dy = y[i] - my
    cov += dx * dy
    vx += dx * dx
    vy += dy * dy
  }
  if (vx <= 0 || vy <= 0) return null
  return cov / Math.sqrt(vx * vy)
}

/** Log returns between consecutive closes; skips non-positive prices. */
export function logReturns(closes: readonly number[]): number[] {
  const out: number[] = []
  for (let i = 1; i < closes.length; i++) {
    if (closes[i - 1] <= 0 || closes[i] <= 0) continue
    out.push(Math.log(closes[i] / closes[i - 1]))
  }
  return out
}

/**
 * Date-aligned closes for two series (intersection of session dates,
 * ascending). Returns parallel close arrays.
 */
export function alignByDate(
  anchor: readonly SeriesBar[],
  related: readonly SeriesBar[],
): { a: number[]; b: number[] } {
  const relByDate = new Map(related.map((bar) => [bar.date, bar.close]))
  const a: number[] = []
  const b: number[] = []
  for (const bar of anchor) {
    const rel = relByDate.get(bar.date)
    if (typeof rel === 'number') {
      a.push(bar.close)
      b.push(rel)
    }
  }
  return { a, b }
}

function tail(xs: readonly number[], n: number): number[] {
  return xs.slice(Math.max(0, xs.length - n))
}

/**
 * corr(b[t-lag], a[t]) — does the RELATED series' move `lag` aligned
 * sessions ago correlate with the ANCHOR's move today?
 */
function laggedCorrelation(aRets: readonly number[], bRets: readonly number[], lag: number, window: number): { r: number; n: number } | null {
  const usable = Math.min(aRets.length, bRets.length) - lag
  if (usable < RELATED_MIN_PAIRS) return null
  const n = Math.min(window, usable)
  const start = usable - n
  const aTail: number[] = []
  const bLagged: number[] = []
  for (let i = start; i < start + n; i++) {
    aTail.push(aRets[i + lag])
    bLagged.push(bRets[i])
  }
  const r = pearson(aTail, bLagged)
  return r == null ? null : { r, n }
}

export function computeRelatedStats(
  anchor: readonly SeriesBar[],
  related: readonly SeriesBar[],
): RelatedComputed | null {
  if (!related.length) return null
  const last = related[related.length - 1]
  const prev = related.length >= 2 ? related[related.length - 2] : null
  const move1dPct = prev && prev.close > 0 ? ((last.close - prev.close) / prev.close) * 100 : null

  const { a, b } = alignByDate(anchor, related)
  const aRets = logReturns(a)
  const bRets = logReturns(b)

  const aCorr = tail(aRets, RELATED_CORR_WINDOW)
  const bCorr = tail(bRets, RELATED_CORR_WINDOW)
  const r = pearson(aCorr, bCorr)
  const corr = r == null ? null : { r, n: Math.min(aCorr.length, bCorr.length) }

  let beta: { beta: number; n: number } | null = null
  if (corr) {
    const n = corr.n
    const aT = tail(aRets, n)
    const bT = tail(bRets, n)
    const mb = bT.reduce((s, v) => s + v, 0) / n
    const ma = aT.reduce((s, v) => s + v, 0) / n
    let cov = 0
    let varB = 0
    for (let i = 0; i < n; i++) {
      cov += (aT[i] - ma) * (bT[i] - mb)
      varB += (bT[i] - mb) ** 2
    }
    if (varB > 0) beta = { beta: cov / varB, n }
  }

  const leadLag: LeadLagStat[] = []
  for (let lag = 1; lag <= LEAD_LAG_MAX_LAG; lag++) {
    const stat = laggedCorrelation(aRets, bRets, lag, LEAD_LAG_WINDOW)
    if (stat && Math.abs(stat.r) >= LEAD_LAG_MIN_ABS_R) {
      leadLag.push({ lag, r: stat.r, n: stat.n })
    }
  }

  return { lastClose: last.close, lastDate: last.date, move1dPct, corr, beta, leadLag }
}
