import { isUiHorizon, sessionsForHorizon, usesTradingSessions, type UiHorizon } from './horizon'

/**
 * Closed-book packet assembly — PURE. No fetches, no AI calls.
 *
 * Numbers first, prose last. Every field carries a source + as-of; a failed
 * fetch is rendered as UNAVAILABLE, never omitted, never guessed.
 */

export const PRINTED_SESSION_COUNT = 20
/** Lookback pairs for the base rate (need lookback + horizon bars in the series). */
export const BASE_RATE_LOOKBACK = 1000
/** Lookback up-close frequency above this is a trend, not a coin-flip prior. */
export const BASE_RATE_TREND_NOTE_MIN_PCT = 60
/**
 * time_series outputsize: 1000 lookback + 63 (3m equity sessions) + 20 buffer.
 * One Twelve Data credit — same as the previous 10-bar series call.
 */
export const SERIES_OUTPUT_SIZE = 1083

export type SeriesBar = { date: string; close: number }

export type ConsensusSnapshot = {
  fetchedAt: string
  priceTarget:
    | { high: number; median: number; low: number; average: number; current: number | null; currency: string | null }
    | { unavailable: string }
  recommendations:
    | { strongBuy: number; buy: number; hold: number; sell: number; strongSell: number }
    | { unavailable: string }
  lastEarnings:
    | { date: string; actual: number; estimate: number | null; surprisePct: number | null }
    | { unavailable: string }
  latestRating: { date: string; firm: string; rating: string } | { unavailable: string }
  epsTrend: { period: string; currentEstimate: number } | { unavailable: string }
}

export type CryptoSnapshot = {
  fetchedAt: string
  funding: { rate: number; nextFundingTime: string | null } | { unavailable: string }
  openInterest: { contracts: number } | { unavailable: string }
  markIv: { ivPct: number; instrument: string } | { unavailable: string }
}

export type ResearchFinding = { query: string; summary: string }

/**
 * Packet v2 (A): locally computed stats for ONE related series (see
 * `related-stats.ts` for the math and `relations.ts` for the map).
 * The unavailable variant is printed as an UNAVAILABLE line, never dropped.
 */
export type RelatedInstrumentStat =
  | {
      symbol: string
      role: string
      note: string
      lastClose: number
      lastDate: string
      move1dPct: number | null
      corr: { r: number; n: number } | null
      beta: { beta: number; n: number } | null
      leadLag: readonly { lag: number; r: number; n: number }[]
    }
  | { symbol: string; role: string; note: string; unavailable: string }

/**
 * Packet v2 (C): slow-diffusing public datasets. Field semantics:
 *  - `null`            → not applicable to this category (line omitted)
 *  - `{ unavailable }` → applicable but the fetch failed (line printed)
 */
export type CotPositioning =
  | {
      contract: string
      date: string
      openInterest: number
      managedMoneyLong: number
      managedMoneyShort: number
      managedMoneyNet: number
      /** Override the default f_disagg.txt attribution (FX uses TFF/legacy). */
      source?: string
    }
  | { unavailable: string }

export type FredObs = { date: string; value: number } | { unavailable: string }

export type FxRateDiff = {
  leftLabel: string
  rightLabel: string
  leftValue: number
  rightValue: number
  leftDate: string
  rightDate: string
  diffPp: number
}

export type FxEtfShortVolume =
  | { symbol: string; date: string; shortShares: number; totalShares: number; shortPct: number }
  | { symbol: string; unavailable: string }

export type EtfHoldings =
  | { date: string; tonnes: number | null; ounces: number | null; source?: string }
  | { unavailable: string }

export type SlowDataSnapshot = {
  fetchedAt: string
  shortVolume:
    | { date: string; shortShares: number; totalShares: number; shortPct: number }
    | { unavailable: string }
    | null
  putCall:
    | { date: string; total: number; index: number | null; equity: number | null }
    | { unavailable: string }
    | null
  btcEtfFlow: { date: string; netFlowUsdM: number } | { unavailable: string } | null
  insider:
    | {
        windowDays: number
        buyTxns: number
        buyShares: number
        sellTxns: number
        sellShares: number
        netShares: number
        latestFilingDate: string | null
      }
    | { unavailable: string }
    | null
  /** US Treasury 10Y TIPS real yield. Gold/metals only; omitted elsewhere. */
  realYield10y?: { date: string; yieldPct: number } | { unavailable: string } | null
  /** CFTC disaggregated managed-money positioning. Gold/metals only. */
  cotGold?: CotPositioning | null
  cotSilver?: CotPositioning | null
  gldHoldings?: EtfHoldings | null
  slvHoldings?: EtfHoldings | null
  /**
   * GLD last / SLV last is NOT the gold/silver ratio (that is ounces of
   * silver per ounce of gold, historically ~65-90). Do not populate this
   * with an ETF share-price quotient. Omit the field unless the number is
   * ounces/ounces.
   */
  goldSilverRatio?:
    | { ratio: number; goldLast: number; silverLast: number; goldSymbol: string; silverSymbol: string; asOf: string }
    | { unavailable: string }
    | null
  /** CBOE Gold ETF Volatility Index (GVZ) via FRED GVZCLS. Gold/metals only. */
  gvz?: { date: string; value: number } | { unavailable: string } | null
  /** FRED INDPRO — US industrial production (silver industrial-demand proxy). */
  indpro?: { date: string; value: number } | { unavailable: string } | null
  /** FRED IPG3344S — US semiconductor production (silver electronics proxy). */
  semiProduction?: { date: string; value: number } | { unavailable: string } | null
  cotPlatinum?: CotPositioning | null
  cotPalladium?: CotPositioning | null
  /** EIA Weekly Petroleum Status Report — crude (WTI/Brent) only. */
  eiaCrude?:
    | {
        weekEnding: string
        commercialStocksMMbbl: number
        commercialWowChangeMMbbl: number
        sprMMbbl: number
        productionKbpd: number
        refineryRunsKbpd: number
        productSuppliedKbpd: number
      }
    | { unavailable: string }
    | null
  /** EIA Weekly Natural Gas Storage Report — UNG only. */
  eiaNatgas?:
    | {
        weekEnding: string
        storageBcf: number
        netChangeBcf: number
        vs5yrAvgPct: number
        vsYearAgoPct: number
        fiveYearAvgBcf: number
      }
    | { unavailable: string }
    | null
  cotWti?: CotPositioning | null
  cotBrent?: CotPositioning | null
  cotNatgas?: CotPositioning | null
  /** CBOE Crude Oil Volatility Index (OVX) via FRED OVXCLS. Crude only. */
  ovx?: { date: string; value: number } | { unavailable: string } | null
  wtiSpotFred?: { date: string; value: number } | { unavailable: string } | null
  brentSpotFred?: { date: string; value: number } | { unavailable: string } | null
  henryHubSpotFred?: { date: string; value: number } | { unavailable: string } | null
  gasolineRetail?: { date: string; value: number } | { unavailable: string } | null
  cotCopper?: CotPositioning | null
  cotCorn?: CotPositioning | null
  cotWheat?: CotPositioning | null
  cotSoybean?: CotPositioning | null
  cotCoffee?: CotPositioning | null
  /** IMF global copper price via FRED PCOPPUSDM. Copper only. */
  copperSpotFred?: { date: string; value: number } | { unavailable: string } | null
  cornSpotFred?: { date: string; value: number } | { unavailable: string } | null
  wheatSpotFred?: { date: string; value: number } | { unavailable: string } | null
  soybeanSpotFred?: { date: string; value: number } | { unavailable: string } | null
  coffeeSpotFred?: { date: string; value: number } | { unavailable: string } | null
  /**
   * FX (fx category). Per-pair isolation: USD pairs get US vs that country;
   * non-USD crosses get the two legs only (no US-centric DXY/Fed). Null/omitted
   * = not applicable to this pair.
   */
  fedFunds?: FredObs | null
  ust2y?: FredObs | null
  ust10y?: FredObs | null
  ust10y2y?: FredObs | null
  tips10yFred?: FredObs | null
  dxyBroad?: FredObs | null
  dxyAfe?: FredObs | null
  dxyEme?: FredObs | null
  ecbDeposit?: FredObs | null
  ecbRefi?: FredObs | null
  germanBund10y?: FredObs | null
  euroHicp?: FredObs | null
  bojPolicy?: FredObs | null
  jgb10y?: FredObs | null
  tibor3m?: FredObs | null
  bokRate?: FredObs | null
  ktb10y?: FredObs | null
  krwCd3m?: FredObs | null
  krwCpi?: FredObs | null
  sonia?: FredObs | null
  gilt10y?: FredObs | null
  policyRateDiff?: FxRateDiff | null
  yield10yDiff?: FxRateDiff | null
  cotEur?: CotPositioning | null
  cotJpy?: CotPositioning | null
  cotGbp?: CotPositioning | null
  cotAud?: CotPositioning | null
  cotDxy?: CotPositioning | null
  /** Honest "no COT" / "component legs only" label for KRW and crosses. */
  fxCotGap?: { note: string } | null
  fxEtfShortVolume?: FxEtfShortVolume[] | null
  /**
   * Index / ETF (etf_index). Per-chip isolation: VIX on every chip; ES COT
   * only on SPY/UPRO/SPXU; NQ only on QQQ/TQQQ/SQQQ; YM on DIA; Nikkei on
   * EWJ. EWY/EWT/FEZ/SOXL have no matching futures COT (labeled).
   */
  vixcls?: FredObs | null
  sp500Fred?: FredObs | null
  nasdaqComFred?: FredObs | null
  djiaFred?: FredObs | null
  nikkei225Fred?: FredObs | null
  cotEs?: CotPositioning | null
  cotNq?: CotPositioning | null
  cotYm?: CotPositioning | null
  cotNikkei?: CotPositioning | null
  cotVix?: CotPositioning | null
  indexEtfCotGap?: { note: string } | null
  indexEtfIdentityNote?: { note: string } | null
  /**
   * Memecoin extras (memecoin category only). Fear & Greed is market-wide;
   * L/S and taker are per Binance USDT-M contract (1000x map for SHIB/PEPE/BONK).
   * Funding / OI stay in CryptoSnapshot (CRYPTO POSITIONING).
   */
  fearGreed?:
    | {
        latest: { date: string; value: number; classification: string }
        week: readonly { date: string; value: number; classification: string }[]
      }
    | { unavailable: string }
    | null
  topTraderLs?:
    | {
        symbol: string
        timestamp: string
        period: string
        longAccountPct?: number
        shortAccountPct?: number
        longShortRatio?: number
      }
    | { unavailable: string }
    | null
  takerRatio?:
    | {
        symbol: string
        timestamp: string
        period: string
        buySellRatio?: number
        buyVol?: number
        sellVol?: number
      }
    | { unavailable: string }
    | null
}

/** Packet v2 (B): a native-language research finding (original + English gloss). */
export type NonEnglishFinding = { lang: string; query: string; summary: string }

export type ClosedBookPacketInput = {
  instrument: string
  category: string
  horizon: string
  series: SeriesBar[]
  seriesSource: string
  seriesAsOf: string | null
  /** Latest close used as the grading baseline (same number persisted as anchor_price). */
  anchorClose: number | null
  anchorSessionDate: string | null
  quoteAsOf: string | null
  consensus: ConsensusSnapshot | null
  crypto: CryptoSnapshot | null
  findings: ResearchFinding[]
  researchCacheKey: string
  assembledAt: string
  /** v2 (A) — cross-asset chain stats; omitted section when null/undefined. */
  related?: readonly RelatedInstrumentStat[] | null
  /** v2 (C) — slow public data; omitted section when null/undefined. */
  slow?: SlowDataSnapshot | null
  /** v2 (B) — shared native-language findings; omitted section when empty. */
  nonEnglishFindings?: readonly NonEnglishFinding[]
  /** v2 (D) — high-tier synthesis; when present it REPLACES prose findings. */
  synthesis?: string | null
}

export type BaseRate = {
  horizon: UiHorizon
  sessionsAhead: number
  lookbackSessions: number
  n: number
  upCount: number
  upPct: number
}

export function computeRealizedVol(closes: number[], window: number): number | null {
  if (closes.length < window + 1) return null
  const slice = closes.slice(-window - 1)
  const rets: number[] = []
  for (let i = 1; i < slice.length; i++) {
    if (slice[i - 1] <= 0 || slice[i] <= 0) continue
    rets.push(Math.log(slice[i] / slice[i - 1]))
  }
  if (rets.length < 5) return null
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length
  const varSum = rets.reduce((a, r) => a + (r - mean) ** 2, 0) / (rets.length - 1)
  return Math.sqrt(varSum) * Math.sqrt(252)
}

export function computeSma(closes: number[], n: number): number | null {
  if (closes.length < n) return null
  const slice = closes.slice(-n)
  return slice.reduce((a, b) => a + b, 0) / n
}

export function range52w(bars: SeriesBar[]): { high: number; low: number; highDate: string; lowDate: string } | null {
  const window = bars.slice(-252)
  if (window.length < 20) return null
  let high = window[0].close
  let low = window[0].close
  let highDate = window[0].date
  let lowDate = window[0].date
  for (const b of window) {
    if (b.close > high) {
      high = b.close
      highDate = b.date
    }
    if (b.close < low) {
      low = b.close
      lowDate = b.date
    }
  }
  return { high, low, highDate, lowDate }
}

/**
 * Historical frequency that the close `sessionsAhead` bars later was HIGHER.
 * Uses the last `lookback` pairs from `bars` (oldest→newest). Per-horizon:
 * callers MUST pass this round's session count — never reuse a 1d rate for 3m.
 */
export function computeBaseRate(
  bars: SeriesBar[],
  sessionsAhead: number,
  lookback = BASE_RATE_LOOKBACK,
  horizon: UiHorizon = '1d',
): BaseRate | null {
  if (sessionsAhead < 1 || bars.length < sessionsAhead + 2) return null
  const maxPairs = bars.length - sessionsAhead
  const n = Math.min(lookback, maxPairs)
  const start = maxPairs - n
  let upCount = 0
  for (let i = start; i < start + n; i++) {
    if (bars[i + sessionsAhead].close > bars[i].close) upCount += 1
  }
  return {
    horizon,
    sessionsAhead,
    lookbackSessions: n,
    n,
    upCount,
    upPct: (upCount / n) * 100,
  }
}

export function resolveHorizonForRate(horizon: string): UiHorizon {
  return isUiHorizon(horizon) ? horizon : '1d'
}

/** A "numeric fact" is a price, percent, or count — not just a calendar date. */
export function hasNumericFact(text: string): boolean {
  if (/\$[\d]/.test(text)) return true
  if (/\d+\.\d+\s*%/.test(text) || /\d+\s*%/.test(text)) return true
  // Bare numbers that are not years / ISO dates / citation indices.
  const stripped = text
    .replace(/\b20\d{2}(-\d{2}-\d{2})?\b/g, ' ')
    .replace(/\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\b/gi, ' ')
    .replace(/\[\d+\]/g, ' ')
  return /\b\d+\.\d+\b/.test(stripped) || /\b\d{2,}\b/.test(stripped)
}

/** Absence-of-news findings (the Aug-24 macro block) cost tokens and add no number. */
export function isAbsenceFinding(text: string): boolean {
  return /no major (?:releases?|announcements?|data|news)/i.test(text)
}

export const MAX_PROSE_FINDINGS = 2
export const MAX_PROSE_CHARS_EACH = 400

/** Cut at the last sentence end within maxChars; else last whitespace; else hard cut. */
export function trimAtSentenceBoundary(text: string, maxChars = MAX_PROSE_CHARS_EACH): string {
  const trimmed = text.trim()
  if (trimmed.length <= maxChars) return trimmed
  const slice = trimmed.slice(0, maxChars)
  const sentenceEnd = Math.max(slice.lastIndexOf('. '), slice.lastIndexOf('! '), slice.lastIndexOf('? '))
  if (sentenceEnd >= Math.floor(maxChars * 0.4)) {
    return slice.slice(0, sentenceEnd + 1).trim()
  }
  const space = slice.lastIndexOf(' ')
  if (space >= Math.floor(maxChars * 0.4)) return slice.slice(0, space).trim()
  return slice.trim()
}

/** Significant numbers for restatement detection (skip lone years / tiny ints). */
export function extractSignificantNumbers(text: string): Set<string> {
  const out = new Set<string>()
  for (const m of text.matchAll(/\d+\.\d+|\d{2,}/g)) {
    const raw = m[0]
    // Skip 4-digit years that dominate date noise.
    if (/^20\d{2}$/.test(raw) || /^19\d{2}$/.test(raw)) continue
    out.add(raw)
  }
  return out
}

/** True when every significant number in the finding already appears in the numeric blocks. */
export function isRestatingNumericBlocks(summary: string, numericNumbers: Set<string>): boolean {
  const found = extractSignificantNumbers(summary)
  if (found.size === 0) return false
  for (const n of found) {
    if (!numericNumbers.has(n)) return false
  }
  return true
}

export function selectProseFindings(
  findings: ResearchFinding[],
  numericBlockText = '',
): ResearchFinding[] {
  const numericNumbers = extractSignificantNumbers(numericBlockText)
  return findings
    .filter((f) => hasNumericFact(f.summary) && !isAbsenceFinding(f.summary))
    .filter((f) => !isRestatingNumericBlocks(f.summary, numericNumbers))
    .slice(0, MAX_PROSE_FINDINGS)
    .map((f) => ({ query: f.query, summary: trimAtSentenceBoundary(f.summary, MAX_PROSE_CHARS_EACH) }))
}

function fmt(n: number, digits = 2): string {
  return Number.isFinite(n) ? n.toFixed(digits) : 'n/a'
}

/** Ounces of silver per ounce of gold. Share-price GLD/SLV (~6–8) is not this. */
export function isOzOzGoldSilverRatio(ratio: number): boolean {
  return Number.isFinite(ratio) && ratio >= 20 && ratio <= 200
}

function pct(n: number): string {
  return `${n >= 0 ? '+' : ''}${fmt(n, 1)}%`
}

function unavailable(label: string, reason: string): string {
  return `${label}: UNAVAILABLE (${reason})`
}

function formatNumericMarket(input: ClosedBookPacketInput): string {
  const bars = input.series
  const closes = bars.map((b) => b.close)
  const last = input.anchorClose
  const asOf = input.seriesAsOf ?? input.quoteAsOf ?? 'unknown'
  const src = input.seriesSource
  const lines: string[] = [
    `NUMERIC MARKET (source: ${src}; as-of ${asOf})`,
  ]

  if (typeof last === 'number') {
    const session = input.anchorSessionDate ?? 'unknown session'
    lines.push(
      `ANCHOR CLOSE (grading baseline — the round is scored against this number): ${fmt(last)} on ${session}`,
    )
  } else {
    lines.push(unavailable('ANCHOR CLOSE (grading baseline)', `${src} returned no last close; as-of ${asOf}`))
  }

  const printed = bars.slice(-PRINTED_SESSION_COUNT)
  if (printed.length) {
    lines.push(`Last ${printed.length} session closes (oldest→newest):`)
    for (const b of printed) lines.push(`  ${b.date}: ${fmt(b.close)}`)
  } else {
    lines.push(unavailable('session closes', `${src} series empty; as-of ${asOf}`))
  }

  const vol = computeRealizedVol(closes, 20)
  lines.push(
    vol == null
      ? unavailable('realized vol (20-session, ann.)', `need ≥21 closes; had ${closes.length}; source ${src}; as-of ${asOf}`)
      : `realized vol (20-session, ann.): ${fmt(vol * 100, 1)}% (source: ${src}; as-of ${asOf})`,
  )

  const r52 = range52w(bars)
  if (r52 && typeof last === 'number') {
    const fromHigh = ((last - r52.high) / r52.high) * 100
    const fromLow = ((last - r52.low) / r52.low) * 100
    lines.push(
      `52w range: ${fmt(r52.low)} (${r52.lowDate}) – ${fmt(r52.high)} (${r52.highDate}); last is ${pct(fromHigh)} from high, ${pct(fromLow)} from low (source: ${src}; as-of ${asOf})`,
    )
  } else {
    lines.push(unavailable('52w high/low', `need ~252 session closes; had ${closes.length}; source ${src}; as-of ${asOf}`))
  }

  const sma20 = computeSma(closes, 20)
  const sma50 = computeSma(closes, 50)
  lines.push(
    sma20 == null
      ? unavailable('SMA20', `need 20 closes; had ${closes.length}; source ${src}; as-of ${asOf}`)
      : `SMA20: ${fmt(sma20)} (source: ${src}; as-of ${asOf})`,
  )
  lines.push(
    sma50 == null
      ? unavailable('SMA50', `need 50 closes; had ${closes.length}; source ${src}; as-of ${asOf}`)
      : `SMA50: ${fmt(sma50)} (source: ${src}; as-of ${asOf})`,
  )

  return lines.join('\n')
}

function formatBaseRate(input: ClosedBookPacketInput): string {
  const h = resolveHorizonForRate(input.horizon)
  const ahead = sessionsForHorizon(input.category, h, input.instrument)
  const rate = computeBaseRate(input.series, ahead, BASE_RATE_LOOKBACK, h)
  const asOf = input.seriesAsOf ?? 'unknown'
  const src = input.seriesSource
  const sessionClock = usesTradingSessions(input.category, input.instrument)
  const aheadLabel = sessionClock
    ? `${ahead} session${ahead === 1 ? '' : 's'}`
    : `${ahead} calendar day${ahead === 1 ? '' : 's'}`
  if (!rate) {
    return unavailable(
      `BASE RATE (${h}, ${aheadLabel} ahead)`,
      `need >${ahead} daily bars; had ${input.series.length}; source ${src}; as-of ${asOf}`,
    )
  }
  const unit = sessionClock
    ? ahead === 1
      ? '1 session later'
      : `${ahead} sessions later`
    : ahead === 1
      ? '1 calendar day later'
      : `${ahead} calendar days later`
  const windowNoun = sessionClock ? 'sessions' : 'calendar days'
  const pctStr = fmt(rate.upPct, 1)
  const lines = [
    sessionClock
      ? `BASE RATE (${h} — ${aheadLabel}, not calendar days)`
      : `BASE RATE (${h} — ${aheadLabel}, not trading sessions)`,
    `over the last ${rate.n} ${windowNoun}, ${input.instrument} closed higher ${unit} ${pctStr}% of the time (n=${rate.n}; lookback=${rate.lookbackSessions} pairs; source: ${src}; as-of ${asOf})`,
  ]
  if (rate.upPct > BASE_RATE_TREND_NOTE_MIN_PCT) {
    lines.push(
      `NOTE: ${pctStr}% exceeds 60% because this lookback window covers a sustained trend; the figure reflects that trend, not a coin-flip prior.`,
    )
  }
  return lines.join('\n')
}

function formatConsensus(c: ConsensusSnapshot | null, instrument: string, last: number | null): string {
  if (!c) {
    return unavailable('CONSENSUS', 'not fetched for this category')
  }
  const asOf = c.fetchedAt
  const lines: string[] = [`CONSENSUS (source: Twelve Data; as-of ${asOf})`]

  if ('unavailable' in c.priceTarget) {
    lines.push(unavailable('price target', `${c.priceTarget.unavailable}; as-of ${asOf}`))
  } else {
    const t = c.priceTarget
    const spread = t.high - t.low
    const vs = last ?? t.current
    const spreadPct = typeof vs === 'number' && vs > 0 ? (spread / vs) * 100 : null
    lines.push(
      `price target: hi ${fmt(t.high)} / median ${fmt(t.median)} / lo ${fmt(t.low)} / avg ${fmt(t.average)}${
        t.currency ? ` ${t.currency}` : ''
      }`,
    )
    lines.push(
      spreadPct == null
        ? `dispersion: range ${fmt(spread)} (median ${fmt(t.median)}; no last price to scale)`
        : `dispersion: range ${fmt(spread)} = ${fmt(spreadPct, 1)}% of last close — analysts disagree (median ${fmt(t.median)}; n=hi/lo/median from /price_target)`,
    )
  }

  if ('unavailable' in c.recommendations) {
    lines.push(unavailable('recommendations', `${c.recommendations.unavailable}; as-of ${asOf}`))
  } else {
    const r = c.recommendations
    lines.push(
      `recommendations (current month): ${r.strongBuy} strong_buy / ${r.buy} buy / ${r.hold} hold / ${r.sell} sell / ${r.strongSell} strong_sell (source: Twelve Data /recommendations; as-of ${asOf})`,
    )
  }

  if ('unavailable' in c.lastEarnings) {
    lines.push(unavailable('last earnings', `${c.lastEarnings.unavailable}; as-of ${asOf}`))
  } else {
    const e = c.lastEarnings
    const surprise = e.surprisePct == null ? 'n/a' : pct(e.surprisePct)
    lines.push(
      `last earnings (${e.date}): actual ${fmt(e.actual)} vs est ${e.estimate == null ? 'n/a' : fmt(e.estimate)} (surprise ${surprise}) (source: Twelve Data /earnings; as-of ${asOf})`,
    )
  }

  if ('unavailable' in c.epsTrend) {
    lines.push(unavailable('eps trend', `${c.epsTrend.unavailable}; as-of ${asOf}`))
  } else {
    lines.push(
      `eps trend ${c.epsTrend.period}: ${fmt(c.epsTrend.currentEstimate, 4)} (source: Twelve Data /eps_trend; as-of ${asOf})`,
    )
  }

  if ('unavailable' in c.latestRating) {
    lines.push(unavailable('latest rating', `${c.latestRating.unavailable}; as-of ${asOf}`))
  } else {
    const r = c.latestRating
    lines.push(`latest rating: ${r.firm} ${r.rating} on ${r.date} (source: Twelve Data /analyst_ratings/light; as-of ${asOf})`)
  }

  void instrument
  return lines.join('\n')
}

function formatCrypto(crypto: CryptoSnapshot | null, wanted: boolean): string {
  if (!wanted) return ''
  if (!crypto) {
    return [
      'CRYPTO POSITIONING',
      unavailable('funding', 'crypto snapshot not assembled'),
      unavailable('open interest', 'crypto snapshot not assembled'),
      unavailable('mark_iv', 'crypto snapshot not assembled'),
    ].join('\n')
  }
  const asOf = crypto.fetchedAt
  const lines: string[] = [`CRYPTO POSITIONING (as-of ${asOf})`]
  if ('unavailable' in crypto.funding) {
    lines.push(unavailable('funding', `${crypto.funding.unavailable}; as-of ${asOf}`))
  } else {
    const next = crypto.funding.nextFundingTime ? `; next ${crypto.funding.nextFundingTime}` : ''
    lines.push(
      `funding: ${fmt(crypto.funding.rate * 100, 4)}% (source: Binance /fapi/v1/premiumIndex; as-of ${asOf}${next})`,
    )
  }
  if ('unavailable' in crypto.openInterest) {
    lines.push(unavailable('open interest', `${crypto.openInterest.unavailable}; as-of ${asOf}`))
  } else {
    lines.push(
      `open interest: ${fmt(crypto.openInterest.contracts, 3)} contracts (source: Binance /fapi/v1/openInterest; as-of ${asOf})`,
    )
  }
  if ('unavailable' in crypto.markIv) {
    lines.push(unavailable('mark_iv', `${crypto.markIv.unavailable}; as-of ${asOf}`))
  } else {
    lines.push(
      `mark_iv: ${fmt(crypto.markIv.ivPct, 2)}% on ${crypto.markIv.instrument} (source: Deribit public/get_book_summary_by_currency; as-of ${asOf})`,
    )
  }
  return lines.join('\n')
}

/** Non-English findings kept in the shared packet (with English gloss). */
export const MAX_NON_ENGLISH_FINDINGS = 3
export const MAX_NON_ENGLISH_CHARS_EACH = 450
/** High-tier research synthesis is trimmed to this budget. */
export const SYNTHESIS_MAX_CHARS = 1400

function signed(n: number, digits = 2): string {
  return `${n >= 0 ? '+' : ''}${fmt(n, digits)}`
}

function formatRelated(related: readonly RelatedInstrumentStat[] | null | undefined): string {
  if (!related || !related.length) return ''
  const lines: string[] = [
    'RELATED INSTRUMENTS (cross-asset chain; corr/beta/lead-lag computed locally from date-aligned daily closes; lead-lag printed only when |r| >= 0.25; source: Twelve Data /time_series)',
  ]
  for (const s of related) {
    const head = `${s.symbol} [${s.role} — ${s.note}]`
    if ('unavailable' in s) {
      lines.push(`  ${unavailable(head, s.unavailable)}`)
      continue
    }
    const move = s.move1dPct == null ? '1d n/a' : `1d ${pct(s.move1dPct)}`
    const corr = s.corr == null ? 'corr20 n/a' : `corr20 ${signed(s.corr.r)} (n=${s.corr.n})`
    const beta = s.beta == null ? 'beta20 n/a' : `beta20 ${signed(s.beta.beta)} (n=${s.beta.n})`
    const lead =
      s.leadLag.length === 0
        ? 'lead-lag: none >= |0.25|'
        : `lead-lag: ${s.leadLag.map((l) => `t-${l.lag} r=${signed(l.r)} (n=${l.n})`).join(', ')}`
    lines.push(`  ${head}: last ${fmt(s.lastClose)} on ${s.lastDate} (${move}); ${corr}; ${beta}; ${lead}`)
  }
  return lines.join('\n')
}

function fmtShares(n: number): string {
  return Math.round(n).toLocaleString('en-US')
}

function formatHoldings(label: string, h: EtfHoldings): string {
  if ('unavailable' in h) return `  ${unavailable(label, h.unavailable)}`
  const tonnes = h.tonnes == null ? 'n/a t' : `${fmt(h.tonnes, 2)} t`
  const ounces = h.ounces == null ? '' : ` / ${fmt(h.ounces, 0)} oz`
  const source = h.source ?? 'issuer holdings file'
  return `  ${label} (${h.date}): ${tonnes}${ounces} (source: ${source}; informative horizon: weeks)`
}

function formatCot(label: string, cot: CotPositioning): string {
  if ('unavailable' in cot) return `  ${unavailable(label, cot.unavailable)}`
  const source = cot.source ?? 'CFTC disaggregated COT f_disagg.txt'
  return `  ${label} (${cot.date}): managed-money net ${fmtShares(cot.managedMoneyNet)} contracts (long ${fmtShares(cot.managedMoneyLong)} / short ${fmtShares(cot.managedMoneyShort)}; OI ${fmtShares(cot.openInterest)}; ${cot.contract}) (source: ${source}; informative horizon: weeks)`
}

function formatFredObs(label: string, seriesId: string, point: FredObs, unit: string, horizon: string): string {
  if ('unavailable' in point) return `  ${unavailable(label, point.unavailable)}`
  return `  ${label} (${point.date}): ${fmt(point.value, 2)}${unit} (source: FRED ${seriesId}; informative horizon: ${horizon})`
}

function formatRateDiff(label: string, d: FxRateDiff): string {
  return `  ${label}: ${d.leftLabel} ${fmt(d.leftValue, 2)}% (${d.leftDate}) − ${d.rightLabel} ${fmt(d.rightValue, 2)}% (${d.rightDate}) = ${signed(d.diffPp, 2)} pp (source: FRED; informative horizon: days-months — mixed print frequencies)`
}

function formatSlowData(slow: SlowDataSnapshot | null | undefined): string {
  if (!slow) return ''
  const lines: string[] = [
    `SLOW PUBLIC DATA (slow-diffusing public datasets; each line names the horizon it informs; as-of ${slow.fetchedAt})`,
  ]
  if (slow.shortVolume) {
    lines.push(
      'unavailable' in slow.shortVolume
        ? `  ${unavailable('short-sale volume', slow.shortVolume.unavailable)}`
        : `  short-sale volume (${slow.shortVolume.date}): short ${fmtShares(slow.shortVolume.shortShares)} / total ${fmtShares(slow.shortVolume.totalShares)} = ${fmt(slow.shortVolume.shortPct, 1)}% short-volume ratio (source: FINRA CNMS daily file; informative horizon: days-weeks)`,
    )
  }
  if (slow.putCall) {
    lines.push(
      'unavailable' in slow.putCall
        ? `  ${unavailable('put/call ratios', slow.putCall.unavailable)}`
        : `  put/call ratios (${slow.putCall.date}): total ${fmt(slow.putCall.total)}${
            slow.putCall.index == null ? '' : ` / index ${fmt(slow.putCall.index)}`
          }${slow.putCall.equity == null ? '' : ` / equity ${fmt(slow.putCall.equity)}`} (source: CBOE daily market statistics; informative horizon: days-weeks)`,
    )
  }
  if (slow.btcEtfFlow) {
    lines.push(
      'unavailable' in slow.btcEtfFlow
        ? `  ${unavailable('BTC spot ETF flows', slow.btcEtfFlow.unavailable)}`
        : `  BTC spot ETF net flow (${slow.btcEtfFlow.date}): ${signed(slow.btcEtfFlow.netFlowUsdM, 1)} US$m (source: Farside Investors; informative horizon: days-weeks)`,
    )
  }
  if (slow.insider) {
    lines.push(
      'unavailable' in slow.insider
        ? `  ${unavailable('insider Form 4', slow.insider.unavailable)}`
        : `  insider Form 4 (SEC EDGAR, trailing ${slow.insider.windowDays}d, open-market P/S only): buys ${slow.insider.buyTxns} txns / ${fmtShares(slow.insider.buyShares)} sh; sells ${slow.insider.sellTxns} txns / ${fmtShares(slow.insider.sellShares)} sh; net ${fmtShares(slow.insider.netShares)} sh${
            slow.insider.latestFilingDate ? `; latest filing ${slow.insider.latestFilingDate}` : ''
          } (source: SEC EDGAR data.sec.gov; informative horizon: weeks-months — weak for 1d)`,
    )
  }
  if (slow.realYield10y) {
    lines.push(
      'unavailable' in slow.realYield10y
        ? `  ${unavailable('10Y TIPS real yield', slow.realYield10y.unavailable)}`
        : `  10Y TIPS real yield (${slow.realYield10y.date}): ${fmt(slow.realYield10y.yieldPct, 2)}% (source: US Treasury daily real yield curve; informative horizon: days-weeks)`,
    )
  }
  if (slow.cotGold) lines.push(formatCot('CFTC gold managed-money', slow.cotGold))
  if (slow.cotSilver) lines.push(formatCot('CFTC silver managed-money', slow.cotSilver))
  if (slow.cotPlatinum) lines.push(formatCot('CFTC platinum managed-money', slow.cotPlatinum))
  if (slow.cotPalladium) lines.push(formatCot('CFTC palladium managed-money', slow.cotPalladium))
  if (slow.gldHoldings) lines.push(formatHoldings('GLD holdings', slow.gldHoldings))
  if (slow.slvHoldings) lines.push(formatHoldings('SLV holdings', slow.slvHoldings))
  if (slow.gvz) {
    lines.push(
      'unavailable' in slow.gvz
        ? `  ${unavailable('CBOE gold ETF volatility GVZ', slow.gvz.unavailable)}`
        : `  CBOE gold ETF volatility GVZ (${slow.gvz.date}): ${fmt(slow.gvz.value, 2)} (source: FRED GVZCLS; informative horizon: days — options-IV proxy)`,
    )
  }
  if (slow.indpro) {
    lines.push(
      'unavailable' in slow.indpro
        ? `  ${unavailable('US industrial production', slow.indpro.unavailable)}`
        : `  US industrial production (${slow.indpro.date}): ${fmt(slow.indpro.value, 2)} (source: FRED INDPRO; informative horizon: months — silver industrial demand proxy)`,
    )
  }
  if (slow.semiProduction) {
    lines.push(
      'unavailable' in slow.semiProduction
        ? `  ${unavailable('US semiconductor production', slow.semiProduction.unavailable)}`
        : `  US semiconductor production (${slow.semiProduction.date}): ${fmt(slow.semiProduction.value, 2)} (source: FRED IPG3344S; informative horizon: months — silver electronics demand proxy)`,
    )
  }
  if (slow.goldSilverRatio) {
    lines.push(
      'unavailable' in slow.goldSilverRatio
        ? `  ${unavailable('gold/silver ratio', slow.goldSilverRatio.unavailable)}`
        : isOzOzGoldSilverRatio(slow.goldSilverRatio.ratio)
          ? `  gold/silver ratio (${slow.goldSilverRatio.asOf}): ${fmt(slow.goldSilverRatio.ratio, 1)} oz silver per oz gold (source: ${slow.goldSilverRatio.goldSymbol}/${slow.goldSilverRatio.silverSymbol} implied spot; informative horizon: days)`
          : `  ${unavailable('gold/silver ratio', 'value is not ounces of silver per ounce of gold (historical ~65-90); an ETF share-price quotient is not this number')}`,
    )
  }
  if (slow.eiaCrude) {
    if ('unavailable' in slow.eiaCrude) {
      lines.push(`  ${unavailable('EIA US crude stocks/supply', slow.eiaCrude.unavailable)}`)
    } else {
      const c = slow.eiaCrude
      lines.push(
        `  EIA US commercial crude stocks ex-SPR (${c.weekEnding}): ${fmt(c.commercialStocksMMbbl, 2)} million bbl (wow ${signed(c.commercialWowChangeMMbbl, 2)}; SPR ${fmt(c.sprMMbbl, 2)} million bbl) (source: EIA WPSR table1.csv; informative horizon: weeks)`,
      )
      lines.push(
        `  EIA US crude production (${c.weekEnding}): ${fmtShares(c.productionKbpd)} thousand b/d; refinery runs ${fmtShares(c.refineryRunsKbpd)} thousand b/d; products supplied ${fmtShares(c.productSuppliedKbpd)} thousand b/d (source: EIA WPSR table1.csv; informative horizon: weeks — demand proxy)`,
      )
    }
  }
  if (slow.eiaNatgas) {
    lines.push(
      'unavailable' in slow.eiaNatgas
        ? `  ${unavailable('EIA US working gas storage', slow.eiaNatgas.unavailable)}`
        : `  EIA US working gas storage (${slow.eiaNatgas.weekEnding}): ${fmtShares(slow.eiaNatgas.storageBcf)} Bcf (net ${signed(slow.eiaNatgas.netChangeBcf, 0)} Bcf; vs 5yr avg ${pct(slow.eiaNatgas.vs5yrAvgPct)}; vs year-ago ${pct(slow.eiaNatgas.vsYearAgoPct)}; 5yr avg ${fmtShares(slow.eiaNatgas.fiveYearAvgBcf)} Bcf) (source: EIA WNGSR wngsr.json; informative horizon: weeks)`,
    )
  }
  if (slow.cotWti) lines.push(formatCot('CFTC WTI managed-money', slow.cotWti))
  if (slow.cotBrent) lines.push(formatCot('CFTC Brent managed-money', slow.cotBrent))
  if (slow.cotNatgas) lines.push(formatCot('CFTC natural-gas managed-money', slow.cotNatgas))
  if (slow.ovx) {
    lines.push(
      'unavailable' in slow.ovx
        ? `  ${unavailable('CBOE crude oil volatility OVX', slow.ovx.unavailable)}`
        : `  CBOE crude oil volatility OVX (${slow.ovx.date}): ${fmt(slow.ovx.value, 2)} (source: FRED OVXCLS; informative horizon: days — options-IV proxy)`,
    )
  }
  if (slow.wtiSpotFred) {
    lines.push(
      'unavailable' in slow.wtiSpotFred
        ? `  ${unavailable('FRED WTI Cushing spot', slow.wtiSpotFred.unavailable)}`
        : `  FRED WTI Cushing spot (${slow.wtiSpotFred.date}): ${fmt(slow.wtiSpotFred.value, 2)} USD/bbl (source: FRED DCOILWTICO; official EIA benchmark — may lag the Twelve Data series above; informative horizon: days)`,
    )
  }
  if (slow.brentSpotFred) {
    lines.push(
      'unavailable' in slow.brentSpotFred
        ? `  ${unavailable('FRED Brent spot', slow.brentSpotFred.unavailable)}`
        : `  FRED Brent spot (${slow.brentSpotFred.date}): ${fmt(slow.brentSpotFred.value, 2)} USD/bbl (source: FRED DCOILBRENTEU; official EIA benchmark — may lag the Twelve Data series above; informative horizon: days)`,
    )
  }
  if (slow.henryHubSpotFred) {
    lines.push(
      'unavailable' in slow.henryHubSpotFred
        ? `  ${unavailable('FRED Henry Hub spot', slow.henryHubSpotFred.unavailable)}`
        : `  FRED Henry Hub spot (${slow.henryHubSpotFred.date}): ${fmt(slow.henryHubSpotFred.value, 2)} USD/MMBtu (source: FRED DHHNGSP; informative horizon: days)`,
    )
  }
  if (slow.gasolineRetail) {
    lines.push(
      'unavailable' in slow.gasolineRetail
        ? `  ${unavailable('US retail gasoline', slow.gasolineRetail.unavailable)}`
        : `  US retail gasoline (${slow.gasolineRetail.date}): ${fmt(slow.gasolineRetail.value, 3)} USD/gal (source: FRED GASREGW; informative horizon: weeks — crude product demand proxy)`,
    )
  }
  if (slow.cotCopper) lines.push(formatCot('CFTC copper managed-money', slow.cotCopper))
  if (slow.cotCorn) lines.push(formatCot('CFTC corn managed-money', slow.cotCorn))
  if (slow.cotWheat) lines.push(formatCot('CFTC SRW wheat managed-money', slow.cotWheat))
  if (slow.cotSoybean) lines.push(formatCot('CFTC soybean managed-money', slow.cotSoybean))
  if (slow.cotCoffee) lines.push(formatCot('CFTC coffee C managed-money', slow.cotCoffee))
  if (slow.copperSpotFred) {
    lines.push(
      'unavailable' in slow.copperSpotFred
        ? `  ${unavailable('IMF copper price', slow.copperSpotFred.unavailable)}`
        : `  IMF copper price (${slow.copperSpotFred.date}): ${fmt(slow.copperSpotFred.value, 2)} USD/metric ton (source: FRED PCOPPUSDM; informative horizon: months — lags the ETF)`,
    )
  }
  if (slow.cornSpotFred) {
    lines.push(
      'unavailable' in slow.cornSpotFred
        ? `  ${unavailable('IMF corn price', slow.cornSpotFred.unavailable)}`
        : `  IMF corn price (${slow.cornSpotFred.date}): ${fmt(slow.cornSpotFred.value, 2)} USD/metric ton (source: FRED PMAIZMTUSDM; informative horizon: months — lags the ETF)`,
    )
  }
  if (slow.wheatSpotFred) {
    lines.push(
      'unavailable' in slow.wheatSpotFred
        ? `  ${unavailable('IMF wheat price', slow.wheatSpotFred.unavailable)}`
        : `  IMF wheat price (${slow.wheatSpotFred.date}): ${fmt(slow.wheatSpotFred.value, 2)} USD/metric ton (source: FRED PWHEAMTUSDM; informative horizon: months — lags the ETF)`,
    )
  }
  if (slow.soybeanSpotFred) {
    lines.push(
      'unavailable' in slow.soybeanSpotFred
        ? `  ${unavailable('IMF soybean price', slow.soybeanSpotFred.unavailable)}`
        : `  IMF soybean price (${slow.soybeanSpotFred.date}): ${fmt(slow.soybeanSpotFred.value, 2)} USD/metric ton (source: FRED PSOYBUSDM; informative horizon: months — lags the ETF)`,
    )
  }
  if (slow.coffeeSpotFred) {
    lines.push(
      'unavailable' in slow.coffeeSpotFred
        ? `  ${unavailable('IMF other-mild arabica coffee', slow.coffeeSpotFred.unavailable)}`
        : `  IMF other-mild arabica coffee (${slow.coffeeSpotFred.date}): ${fmt(slow.coffeeSpotFred.value, 2)} US cents/lb (source: FRED PCOFFOTMUSDM; informative horizon: months — lags the ETF)`,
    )
  }
  if (slow.fxCotGap) {
    lines.push(`  CFTC FX positioning note: ${slow.fxCotGap.note}`)
  }
  if (slow.fedFunds) lines.push(formatFredObs('Fed funds effective', 'DFF', slow.fedFunds, '%', 'days'))
  if (slow.ust2y) lines.push(formatFredObs('US 2Y Treasury', 'DGS2', slow.ust2y, '%', 'days'))
  if (slow.ust10y) lines.push(formatFredObs('US 10Y Treasury', 'DGS10', slow.ust10y, '%', 'days'))
  if (slow.ust10y2y) lines.push(formatFredObs('US 10Y−2Y spread', 'T10Y2Y', slow.ust10y2y, ' pp', 'days'))
  if (slow.tips10yFred) lines.push(formatFredObs('US 10Y TIPS real yield', 'DFII10', slow.tips10yFred, '%', 'days'))
  if (slow.dxyBroad) lines.push(formatFredObs('Trade-weighted USD broad', 'DTWEXBGS', slow.dxyBroad, '', 'days'))
  if (slow.dxyAfe) {
    lines.push(formatFredObs('Trade-weighted USD advanced-economies', 'DTWEXAFEGS', slow.dxyAfe, '', 'days'))
  }
  if (slow.dxyEme) {
    lines.push(formatFredObs('Trade-weighted USD emerging-markets', 'DTWEXEMEGS', slow.dxyEme, '', 'days'))
  }
  if (slow.ecbDeposit) lines.push(formatFredObs('ECB deposit facility rate', 'ECBDFR', slow.ecbDeposit, '%', 'days'))
  if (slow.ecbRefi) lines.push(formatFredObs('ECB main refinancing rate', 'ECBMRRFR', slow.ecbRefi, '%', 'days'))
  if (slow.germanBund10y) {
    lines.push(formatFredObs('German 10Y bund yield', 'IRLTLT01DEM156N', slow.germanBund10y, '%', 'months'))
  }
  if (slow.euroHicp) {
    lines.push(
      formatFredObs('Euro-area HICP (index)', 'CP0000EZ19M086NEST', slow.euroHicp, '', 'months — not a YoY rate'),
    )
  }
  if (slow.bojPolicy) {
    lines.push(formatFredObs('BOJ policy rate', 'IRSTCB01JPM156N', slow.bojPolicy, '%', 'months — series may lag'))
  }
  if (slow.jgb10y) lines.push(formatFredObs('Japan 10Y JGB yield', 'IRLTLT01JPM156N', slow.jgb10y, '%', 'months'))
  if (slow.tibor3m) lines.push(formatFredObs('Japan 3M TIBOR', 'IR3TIB01JPM156N', slow.tibor3m, '%', 'months'))
  if (slow.bokRate) {
    lines.push(formatFredObs('Bank of Korea policy/discount rate', 'INTDSRKRM193N', slow.bokRate, '%', 'months'))
  }
  if (slow.ktb10y) lines.push(formatFredObs('Korea 10Y treasury yield', 'IRLTLT01KRM156N', slow.ktb10y, '%', 'months'))
  if (slow.krwCd3m) lines.push(formatFredObs('Korea 3M CD/interbank', 'IR3TIB01KRM156N', slow.krwCd3m, '%', 'months'))
  if (slow.krwCpi) {
    lines.push(
      formatFredObs('Korea CPI (monthly rate)', 'CPALTT01KRM657N', slow.krwCpi, '%', 'months — series may lag'),
    )
  }
  if (slow.sonia) lines.push(formatFredObs('UK SONIA overnight', 'IUDSOIA', slow.sonia, '%', 'days'))
  if (slow.gilt10y) lines.push(formatFredObs('UK 10Y gilt yield', 'IRLTLT01GBM156N', slow.gilt10y, '%', 'months'))
  if (slow.policyRateDiff) lines.push(formatRateDiff('Policy-rate differential', slow.policyRateDiff))
  if (slow.yield10yDiff) lines.push(formatRateDiff('10Y yield differential', slow.yield10yDiff))
  const fxComponentLegs = !!slow.fxCotGap
  if (slow.cotEur) {
    lines.push(
      formatCot(
        fxComponentLegs
          ? 'CFTC euro FX leveraged-funds (component leg, not a cross COT)'
          : 'CFTC euro FX leveraged-funds',
        slow.cotEur,
      ),
    )
  }
  if (slow.cotJpy) {
    lines.push(
      formatCot(
        fxComponentLegs
          ? 'CFTC yen leveraged-funds (component leg, not a cross COT)'
          : 'CFTC yen leveraged-funds',
        slow.cotJpy,
      ),
    )
  }
  if (slow.cotGbp) {
    lines.push(
      formatCot(
        fxComponentLegs
          ? 'CFTC sterling leveraged-funds (component leg, not a cross COT)'
          : 'CFTC sterling leveraged-funds',
        slow.cotGbp,
      ),
    )
  }
  if (slow.cotAud) lines.push(formatCot('CFTC Australian dollar leveraged-funds', slow.cotAud))
  if (slow.cotDxy) lines.push(formatCot('CFTC USD index (DXY) leveraged-funds', slow.cotDxy))
  if (slow.fxEtfShortVolume) {
    for (const row of slow.fxEtfShortVolume) {
      const label = `FINRA short-sale volume ${row.symbol}`
      if ('unavailable' in row) {
        lines.push(`  ${unavailable(label, row.unavailable)}`)
      } else {
        lines.push(
          `  ${label} (${row.date}): short ${fmtShares(row.shortShares)} / total ${fmtShares(row.totalShares)} = ${fmt(row.shortPct, 1)}% short-volume ratio (source: FINRA CNMS daily file; informative horizon: days-weeks)`,
        )
      }
    }
  }
  if (slow.indexEtfIdentityNote) {
    lines.push(`  Index/ETF identity note: ${slow.indexEtfIdentityNote.note}`)
  }
  if (slow.indexEtfCotGap) {
    lines.push(`  CFTC index positioning note: ${slow.indexEtfCotGap.note}`)
  }
  if (slow.vixcls) lines.push(formatFredObs('CBOE VIX', 'VIXCLS', slow.vixcls, '', 'days — cash VIX, not VIXY'))
  if (slow.sp500Fred) {
    lines.push(
      formatFredObs(
        'FRED S&P 500 cash index',
        'SP500',
        slow.sp500Fred,
        '',
        'days — official print, may lag the ETF',
      ),
    )
  }
  if (slow.nasdaqComFred) {
    lines.push(
      formatFredObs(
        'FRED Nasdaq Composite',
        'NASDAQCOM',
        slow.nasdaqComFred,
        '',
        'days — Composite, not Nasdaq-100; may lag the ETF',
      ),
    )
  }
  if (slow.djiaFred) {
    lines.push(formatFredObs('FRED Dow Jones Industrial Average', 'DJIA', slow.djiaFred, '', 'days — may lag DIA'))
  }
  if (slow.nikkei225Fred) {
    lines.push(
      formatFredObs(
        'FRED Nikkei 225 cash index',
        'NIKKEI225',
        slow.nikkei225Fred,
        '',
        'days — lagged cash print; EWJ is MSCI Japan, not Nikkei',
      ),
    )
  }
  if (slow.fearGreed) {
    if ('unavailable' in slow.fearGreed) {
      lines.push(`  ${unavailable('Crypto Fear & Greed', slow.fearGreed.unavailable)}`)
    } else {
      const week = slow.fearGreed.week.map((p) => `${fmt(p.value, 0)}`).join(', ')
      lines.push(
        `  Crypto Fear & Greed (${slow.fearGreed.latest.date}): ${fmt(slow.fearGreed.latest.value, 0)} ${slow.fearGreed.latest.classification}; 7d: ${week} (source: Alternative.me /fng; informative horizon: days — market-wide, not coin-specific)`,
      )
    }
  }
  if (slow.topTraderLs) {
    if ('unavailable' in slow.topTraderLs) {
      lines.push(`  ${unavailable('Binance top-trader long/short', slow.topTraderLs.unavailable)}`)
    } else {
      const t = slow.topTraderLs
      const long = t.longAccountPct == null ? 'n/a' : `${fmt(t.longAccountPct, 1)}%`
      const short = t.shortAccountPct == null ? 'n/a' : `${fmt(t.shortAccountPct, 1)}%`
      const ratio = t.longShortRatio == null ? 'n/a' : fmt(t.longShortRatio, 3)
      lines.push(
        `  Binance top-trader long/short (${t.symbol}, ${t.period}): long ${long} / short ${short} (ratio ${ratio}; as-of ${t.timestamp}) (source: Binance /futures/data/topLongShortPositionRatio; informative horizon: hours)`,
      )
    }
  }
  if (slow.takerRatio) {
    if ('unavailable' in slow.takerRatio) {
      lines.push(`  ${unavailable('Binance taker buy/sell', slow.takerRatio.unavailable)}`)
    } else {
      const t = slow.takerRatio
      const ratio = t.buySellRatio == null ? 'n/a' : fmt(t.buySellRatio, 3)
      const buy = t.buyVol == null ? 'n/a' : fmt(t.buyVol, 0)
      const sell = t.sellVol == null ? 'n/a' : fmt(t.sellVol, 0)
      lines.push(
        `  Binance taker buy/sell (${t.symbol}, ${t.period}): ratio ${ratio} (buyVol ${buy} / sellVol ${sell}; as-of ${t.timestamp}) (source: Binance /futures/data/takerlongshortRatio; informative horizon: hours)`,
      )
    }
  }
  if (slow.cotEs) lines.push(formatCot('CFTC E-mini S&P 500 leveraged-funds', slow.cotEs))
  if (slow.cotNq) lines.push(formatCot('CFTC Nasdaq mini leveraged-funds', slow.cotNq))
  if (slow.cotYm) lines.push(formatCot('CFTC Dow Jones ($5) leveraged-funds', slow.cotYm))
  if (slow.cotNikkei) lines.push(formatCot('CFTC Nikkei 225 yen-denominated leveraged-funds', slow.cotNikkei))
  if (slow.cotVix) lines.push(formatCot('CFTC VIX futures leveraged-funds', slow.cotVix))
  // Only the header would remain → treat as no section.
  return lines.length > 1 ? lines.join('\n') : ''
}

function formatNonEnglish(findings: readonly NonEnglishFinding[] | undefined): string {
  if (!findings?.length) return ''
  const kept = findings
    .filter((f) => hasNumericFact(f.summary))
    .slice(0, MAX_NON_ENGLISH_FINDINGS)
    .map((f) => ({ ...f, summary: trimAtSentenceBoundary(f.summary, MAX_NON_ENGLISH_CHARS_EACH) }))
  if (!kept.length) return ''
  return [
    'NON-ENGLISH FINDINGS (native-language sources with English gloss; identical block for every closed-book model):',
    ...kept.map((f, i) => `${i + 1}) [${f.lang}] ${f.query}\n   ${f.summary}`),
  ].join('\n')
}

function formatSynthesis(synthesis: string | null | undefined): string {
  const trimmed = synthesis?.trim()
  if (!trimmed) return ''
  return [
    'RESEARCH SYNTHESIS (director decomposition, distilled numbers-first; numeric blocks above are authoritative if they disagree):',
    trimAtSentenceBoundary(trimmed, SYNTHESIS_MAX_CHARS),
  ].join('\n')
}

function formatProse(findings: ResearchFinding[], numericBlockText: string): string {
  const kept = selectProseFindings(findings, numericBlockText)
  // Absent section rather than an empty "none kept" stub — saves tokens and
  // avoids inviting models to invent prose over a blank heading.
  if (!kept.length) return ''
  return [
    'PROSE FINDINGS (demoted; numeric blocks above are authoritative if they disagree):',
    ...kept.map((f, i) => `${i + 1}) ${f.query}\n   ${f.summary}`),
  ].join('\n')
}

/**
 * The exact text closed-book models receive (minus the proposition header /
 * closer, which `buildPrompts` wraps). Persist THIS string.
 */
export function assembleClosedBookInjection(input: ClosedBookPacketInput): string {
  const wantsCrypto = input.category === 'crypto_spot' || input.category === 'crypto_perps' || input.category === 'memecoin'
  const parts = [
    formatNumericMarket(input),
    '',
    formatBaseRate(input),
    '',
    formatConsensus(input.consensus, input.instrument, input.anchorClose),
  ]
  if (wantsCrypto) {
    parts.push('', formatCrypto(input.crypto, true))
  }
  const related = formatRelated(input.related)
  if (related) parts.push('', related)
  const slow = formatSlowData(input.slow)
  if (slow) parts.push('', slow)
  const numericBlockText = parts.join('\n')
  const nonEnglish = formatNonEnglish(input.nonEnglishFindings)
  if (nonEnglish) parts.push('', nonEnglish)
  // High-tier synthesis REPLACES raw prose findings (it already distilled them).
  const synthesis = formatSynthesis(input.synthesis)
  if (synthesis) {
    parts.push('', synthesis)
  } else {
    const prose = formatProse(input.findings, numericBlockText)
    if (prose) parts.push('', prose)
  }
  return parts.join('\n')
}

export function estimatePacketTokens(text: string): number {
  return Math.ceil(text.length / 4)
}
