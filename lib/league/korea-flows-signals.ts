/**
 * KRSTOCK investor-flow signals. Pure computation over rows already stored
 * in league_krx_flows / league_krx_short / league_krx_foreign_own /
 * league_krx_daily. No KRX fetch and no Supabase client.
 *
 * asOf is the round's anchor session. A block is stale when its own latest
 * date is before asOf. Short balance is dated on its publication session
 * (T+2), which is before asOf by design and is not itself staleness.
 */

import { BOTH_SIDES_HEADER } from './crowding'
import { lastNKrxSessionDates, previousKrxSessionDate } from './krx-calendar'

/** Same order as KRX_FLOW_INVESTORS in the store. Kept here so this file stays free of the server client. */
export const KR_FLOW_INVESTOR_NAMES = [
  'foreign',
  'institution',
  'individual',
  'pension',
  'financial_investment',
] as const

export type KrFlowInvestorName = (typeof KR_FLOW_INVESTOR_NAMES)[number]
export type KrFlowMarketName = 'KOSPI' | 'KOSDAQ'

export type KrFlowNetRow = {
  date: string
  market: string
  code: string
  investor: string
  netValue: number | null
}

export type KrFlowShortPoint = {
  date: string
  market: string
  code: string
  shortRatio: number | null
  balanceRatio: number | null
}

export type KrFlowForeignPoint = {
  date: string
  market: string
  code: string
  foreignHoldingRatio: number | null
}

/**
 * Crowding level — the only thresholds. Missing inputs do not raise the level.
 *
 * high when any of these is true:
 *   a same-market percentile >= highPercentile
 *   foreign or institution streak sessions >= highStreakSessions
 *   abs(5-session price change %) >= highAbs5dPricePct
 * else medium when any medium threshold is met the same way
 * else low.
 *
 * Percentiles are |foreign 5d bp|, |institution 5d bp|, and short-ratio z.
 * A percentile is null when fewer than minPeers names have that metric.
 * shortZBothSides is the |z| that becomes a measured BOTH SIDES line.
 */
export const KR_FLOW_CROWDING_RULE = {
  minPeers: 5,
  highPercentile: 90,
  mediumPercentile: 70,
  highStreakSessions: 5,
  mediumStreakSessions: 3,
  highAbs5dPricePct: 8,
  mediumAbs5dPricePct: 4,
  shortZBothSides: 1,
} as const

/** 1 basis point = net value / market cap × 10,000. Both legs are KRW. */
const BASIS_POINTS_PER_UNIT = 10_000

/** Safety bound for the streak walk. Not a crowding threshold. */
const STREAK_WALK_CAP = 60

export const KR_FLOWS_NO_INTENT =
  'Flows describe who traded, not why. Do not infer intent, manipulation, or coordinated activity.'

export const KR_FLOWS_PACKET_HEADER_PREFIX = 'Investor flows & positioning (KRX, as of '

export const KR_FLOWS_NEWS_FALLBACK_LABEL = 'news-based, unverified, may be incomplete'

export function krFlowsPacketHeader(asOf: string): string {
  return `${KR_FLOWS_PACKET_HEADER_PREFIX}${asOf})`
}

export type KrFlowStreakSide = 'net-buy' | 'net-sell'

export type KrInvestorFlow = {
  investor: KrFlowInvestorName
  net1d: number | null
  net5d: number | null
  net20d: number | null
  bp5d: number | null
  bp20d: number | null
  dataAsOf: string | null
}

export type KrFlowStreak = {
  side: KrFlowStreakSide | null
  sessions: number
  dataAsOf: string | null
}

export type KrFlowSignals = {
  market: KrFlowMarketName
  code: string
  asOf: string
  flowsDataAsOf: string | null
  flowsStale: boolean
  flowsMissing: boolean
  mktcap: number | null
  investors: KrInvestorFlow[]
  foreignStreak: KrFlowStreak
  institutionStreak: KrFlowStreak
  short: {
    ratioToday: number | null
    avg20d: number | null
    z20d: number | null
    dataAsOf: string | null
    stale: boolean
  }
  shortBalance: {
    ratio: number | null
    /** Expected publication session (T+2). Always carried, even when the ratio is missing. */
    date: string
    change20dPp: number | null
    dataAsOf: string | null
  }
  foreignHolding: {
    ratio: number | null
    change20dPp: number | null
    dataAsOf: string | null
    stale: boolean
  }
  priceChange5dPct: number | null
  ranks: {
    foreign5dBpPercentile: number | null
    institution5dBpPercentile: number | null
    shortZPercentile: number | null
    dataAsOf: string
  }
  crowdingLevel: 'low' | 'medium' | 'high'
}

export type KrFlowDailyPoint = {
  date: string
  close: number | null
  mktcap: number | null
}

export type KrFlowSignalRows = {
  market: KrFlowMarketName
  code: string
  asOf: string
  flows: readonly KrFlowNetRow[]
  shorts: readonly KrFlowShortPoint[]
  foreign: readonly KrFlowForeignPoint[]
  daily: readonly KrFlowDailyPoint[]
  peers: {
    foreign5dAbsBp: readonly number[]
    institution5dAbsBp: readonly number[]
    shortZ: readonly number[]
  }
}

export function krFlowBasisPoints(net: number, mktcap: number): number | null {
  if (!Number.isFinite(net) || !Number.isFinite(mktcap) || mktcap === 0) return null
  return (net / mktcap) * BASIS_POINTS_PER_UNIT
}

/** Sample z-score of the last value versus the whole window (n − 1). Null when n < 2 or sd = 0. */
export function krFlowSampleZ(valuesOldestToNewest: readonly number[]): number | null {
  if (valuesOldestToNewest.length < 2) return null
  const n = valuesOldestToNewest.length
  const mean = valuesOldestToNewest.reduce((sum, value) => sum + value, 0) / n
  const ss = valuesOldestToNewest.reduce((sum, value) => sum + (value - mean) ** 2, 0)
  const sd = Math.sqrt(ss / (n - 1))
  if (sd === 0) return null
  return (valuesOldestToNewest[n - 1]! - mean) / sd
}

/** Share of the sample (percent) that is <= value. Null below minPeers. */
export function krFlowPercentile(value: number | null, sample: readonly number[]): number | null {
  if (value == null || !Number.isFinite(value)) return null
  const xs = sample.filter((n) => Number.isFinite(n))
  const withSelf = xs.some((n) => n === value) ? xs : [...xs, value]
  if (withSelf.length < KR_FLOW_CROWDING_RULE.minPeers) return null
  const le = withSelf.filter((n) => n <= value).length
  return (le / withSelf.length) * 100
}

export function krFlowCrowdingLevel(input: {
  foreign5dBpPercentile: number | null
  institution5dBpPercentile: number | null
  shortZPercentile: number | null
  foreignStreakSessions: number
  institutionStreakSessions: number
  abs5dPricePct: number | null
}): 'low' | 'medium' | 'high' {
  const rule = KR_FLOW_CROWDING_RULE
  const percentiles = [
    input.foreign5dBpPercentile,
    input.institution5dBpPercentile,
    input.shortZPercentile,
  ]
  const streak = Math.max(input.foreignStreakSessions, input.institutionStreakSessions)
  const price = input.abs5dPricePct
  const hit = (percentile: number, streakMin: number, priceMin: number) =>
    percentiles.some((p) => p != null && p >= percentile) ||
    streak >= streakMin ||
    (price != null && price >= priceMin)
  if (hit(rule.highPercentile, rule.highStreakSessions, rule.highAbs5dPricePct)) return 'high'
  if (hit(rule.mediumPercentile, rule.mediumStreakSessions, rule.mediumAbs5dPricePct)) return 'medium'
  return 'low'
}

export function krFlowCrowdingRuleText(): string {
  const rule = KR_FLOW_CROWDING_RULE
  return (
    `crowdingLevel rule: high if a percentile>=${rule.highPercentile} or a streak>=${rule.highStreakSessions}` +
    ` or |5d price change|>=${rule.highAbs5dPricePct}%; medium if a percentile>=${rule.mediumPercentile}` +
    ` or a streak>=${rule.mediumStreakSessions} or |5d price change|>=${rule.mediumAbs5dPricePct}%;` +
    ' else low. Missing inputs do not raise the level.'
  )
}

function latestOnOrBefore(dates: readonly string[], asOf: string): string | null {
  let best: string | null = null
  for (const date of dates) {
    if (date <= asOf && (best == null || date > best)) best = date
  }
  return best
}

function sumDates(nets: ReadonlyMap<string, number>, dates: readonly string[]): number | null {
  let any = false
  let sum = 0
  for (const date of dates) {
    const value = nets.get(date)
    if (value == null) continue
    any = true
    sum += value
  }
  return any ? sum : null
}

function streakEndingAt(nets: ReadonlyMap<string, number>, asOf: string): KrFlowStreak {
  const dataAsOf = latestOnOrBefore([...nets.keys()], asOf)
  const first = nets.get(asOf)
  if (first == null || first === 0) return { side: null, sessions: 0, dataAsOf }
  const side: KrFlowStreakSide = first > 0 ? 'net-buy' : 'net-sell'
  let sessions = 0
  let cursor = asOf
  for (let i = 0; i < STREAK_WALK_CAP; i++) {
    const value = nets.get(cursor)
    if (value == null || value === 0) break
    const next: KrFlowStreakSide = value > 0 ? 'net-buy' : 'net-sell'
    if (next !== side) break
    sessions += 1
    cursor = previousKrxSessionDate(cursor, 1)
  }
  return { side, sessions, dataAsOf }
}

function netsFor(rows: readonly KrFlowNetRow[], investor: KrFlowInvestorName): Map<string, number> {
  const nets = new Map<string, number>()
  for (const row of rows) {
    if (row.investor !== investor || row.netValue == null || !Number.isFinite(row.netValue)) continue
    nets.set(row.date, (nets.get(row.date) ?? 0) + row.netValue)
  }
  return nets
}

export function computeKrFlowSignals(input: KrFlowSignalRows): KrFlowSignals {
  const asOf = input.asOf
  const flows = input.flows.filter(
    (row) => row.market === input.market && row.code === input.code && row.date <= asOf,
  )
  const shorts = input.shorts.filter(
    (row) => row.market === input.market && row.code === input.code && row.date <= asOf,
  )
  const foreign = input.foreign.filter(
    (row) => row.market === input.market && row.code === input.code && row.date <= asOf,
  )
  const daily = input.daily.filter((row) => row.date <= asOf)
  const sessions20 = lastNKrxSessionDates(asOf, 20)
  const sessions5 = sessions20.slice(-5)
  const sessions6 = lastNKrxSessionDates(asOf, 6)
  const flowsDataAsOf = latestOnOrBefore(flows.map((row) => row.date), asOf)
  const mktcapRow = daily.find((row) => row.date === asOf)
  const mktcap = mktcapRow?.mktcap ?? null
  const investors: KrInvestorFlow[] = KR_FLOW_INVESTOR_NAMES.map((investor) => {
    const nets = netsFor(flows, investor)
    const net1d = sumDates(nets, [asOf])
    const net5d = sumDates(nets, sessions5)
    const net20d = sumDates(nets, sessions20)
    return {
      investor,
      net1d,
      net5d,
      net20d,
      bp5d: net5d == null || mktcap == null ? null : krFlowBasisPoints(net5d, mktcap),
      bp20d: net20d == null || mktcap == null ? null : krFlowBasisPoints(net20d, mktcap),
      dataAsOf: latestOnOrBefore([...nets.keys()], asOf),
    }
  })
  const byInvestor = new Map(investors.map((row) => [row.investor, row]))
  const foreignFlow = byInvestor.get('foreign')!
  const institutionFlow = byInvestor.get('institution')!

  const shortByDate = new Map<string, KrFlowShortPoint>()
  for (const row of shorts) shortByDate.set(row.date, row)
  const shortRatios: number[] = []
  for (const date of sessions20) {
    const ratio = shortByDate.get(date)?.shortRatio
    if (ratio != null && Number.isFinite(ratio)) shortRatios.push(ratio)
  }
  const shortToday = shortByDate.get(asOf)?.shortRatio
  const shortTodayOk = shortToday != null && Number.isFinite(shortToday)
  const shortDataAsOf = latestOnOrBefore(
    shorts.filter((row) => row.shortRatio != null).map((row) => row.date),
    asOf,
  )
  const shortMean =
    shortRatios.length > 0 ? shortRatios.reduce((sum, value) => sum + value, 0) / shortRatios.length : null

  const balanceDate = previousKrxSessionDate(asOf, 2)
  const balanceRow = shortByDate.get(balanceDate)
  const balanceBaseDate = previousKrxSessionDate(balanceDate, 20)
  const balanceBase = shortByDate.get(balanceBaseDate)?.balanceRatio
  const balanceRatio = balanceRow?.balanceRatio ?? null
  const balanceChange =
    balanceRatio != null && balanceBase != null && Number.isFinite(balanceRatio) && Number.isFinite(balanceBase)
      ? balanceRatio - balanceBase
      : null

  const foreignByDate = new Map<string, number>()
  for (const row of foreign) {
    if (row.foreignHoldingRatio != null && Number.isFinite(row.foreignHoldingRatio)) {
      foreignByDate.set(row.date, row.foreignHoldingRatio)
    }
  }
  const holding = foreignByDate.get(asOf) ?? null
  const holdingBaseDate = previousKrxSessionDate(asOf, 20)
  const holdingBase = foreignByDate.get(holdingBaseDate)
  const holdingChange =
    holding != null && holdingBase != null ? holding - holdingBase : null
  const holdingDataAsOf = latestOnOrBefore([...foreignByDate.keys()], asOf)

  const closeOf = (date: string) => {
    const close = daily.find((row) => row.date === date)?.close
    return close != null && Number.isFinite(close) && close > 0 ? close : null
  }
  const closeThen = closeOf(sessions6[0] ?? asOf)
  const closeNow = closeOf(asOf)
  const priceChange5dPct =
    closeThen != null && closeNow != null ? ((closeNow - closeThen) / closeThen) * 100 : null

  const foreign5dBpPercentile = krFlowPercentile(
    foreignFlow.bp5d == null ? null : Math.abs(foreignFlow.bp5d),
    input.peers.foreign5dAbsBp,
  )
  const institution5dBpPercentile = krFlowPercentile(
    institutionFlow.bp5d == null ? null : Math.abs(institutionFlow.bp5d),
    input.peers.institution5dAbsBp,
  )
  const shortZ = shortTodayOk ? krFlowSampleZ(shortRatios) : null
  const shortZPercentile = krFlowPercentile(shortZ, input.peers.shortZ)
  const foreignStreak = streakEndingAt(netsFor(flows, 'foreign'), asOf)
  const institutionStreak = streakEndingAt(netsFor(flows, 'institution'), asOf)

  return {
    market: input.market,
    code: input.code,
    asOf,
    flowsDataAsOf,
    flowsMissing: flows.length === 0,
    flowsStale: flowsDataAsOf == null || flowsDataAsOf < asOf,
    mktcap,
    investors,
    foreignStreak,
    institutionStreak,
    short: {
      ratioToday: shortTodayOk ? shortToday : null,
      avg20d: shortMean,
      z20d: shortZ,
      dataAsOf: shortDataAsOf,
      stale: shortDataAsOf == null || shortDataAsOf < asOf,
    },
    shortBalance: {
      ratio: balanceRatio != null && Number.isFinite(balanceRatio) ? balanceRatio : null,
      date: balanceDate,
      change20dPp: balanceChange,
      dataAsOf: balanceRatio != null && Number.isFinite(balanceRatio) ? balanceDate : null,
    },
    foreignHolding: {
      ratio: holding,
      change20dPp: holdingChange,
      dataAsOf: holdingDataAsOf,
      stale: holdingDataAsOf == null || holdingDataAsOf < asOf,
    },
    priceChange5dPct,
    ranks: {
      foreign5dBpPercentile,
      institution5dBpPercentile,
      shortZPercentile,
      dataAsOf: asOf,
    },
    crowdingLevel: krFlowCrowdingLevel({
      foreign5dBpPercentile,
      institution5dBpPercentile,
      shortZPercentile,
      foreignStreakSessions: foreignStreak.sessions,
      institutionStreakSessions: institutionStreak.sessions,
      abs5dPricePct: priceChange5dPct == null ? null : Math.abs(priceChange5dPct),
    }),
  }
}

export function missingKrFlowSignals(args: {
  market: KrFlowMarketName
  code: string
  asOf: string
}): KrFlowSignals {
  return computeKrFlowSignals({
    market: args.market,
    code: args.code,
    asOf: args.asOf,
    flows: [],
    shorts: [],
    foreign: [],
    daily: [],
    peers: { foreign5dAbsBp: [], institution5dAbsBp: [], shortZ: [] },
  })
}

function fmt(value: number | null, digits: number): string {
  if (value == null || !Number.isFinite(value)) return 'none measured'
  const sign = value < 0 ? '-' : ''
  const [whole, frac] = Math.abs(value).toFixed(digits).split('.')
  const grouped = whole!.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return digits > 0 ? `${sign}${grouped}.${frac}` : `${sign}${grouped}`
}

function dated(value: string | null): string {
  return value ?? 'none measured'
}

function sideLines(signals: KrFlowSignals): { up: string[]; down: string[] } {
  const up: string[] = []
  const down: string[] = []
  const pushNet = (label: string, value: number | null) => {
    if (value == null || value === 0) return
    if (value > 0) up.push(`${label} positive`)
    else down.push(`${label} negative`)
  }
  for (const row of signals.investors) pushNet(`${row.investor} 5d net value`, row.net5d)
  pushNet('foreign holding ratio 20d change', signals.foreignHolding.change20dPp)
  const z = signals.short.z20d
  if (z != null && z > KR_FLOW_CROWDING_RULE.shortZBothSides) {
    down.push('short-volume ratio z above its 20d history')
  } else if (z != null && z < -KR_FLOW_CROWDING_RULE.shortZBothSides) {
    up.push('short-volume ratio z below its 20d history')
  }
  return { up, down }
}

export function formatKrFlowPacketSection(signals: KrFlowSignals, newsFallback: boolean): string {
  const lines = [
    krFlowsPacketHeader(signals.asOf),
    KR_FLOWS_NO_INTENT,
    `flows dataAsOf: ${dated(signals.flowsDataAsOf)}; stale: ${signals.flowsStale ? 'yes' : 'no'}`,
    `mktcap as of ${signals.asOf}: ${fmt(signals.mktcap, 0)} KRW`,
  ]
  for (const row of signals.investors) {
    lines.push(
      `${row.investor} net value 1d/5d/20d: ${fmt(row.net1d, 0)} / ${fmt(row.net5d, 0)} / ${fmt(row.net20d, 0)} KRW; 5d bp: ${fmt(row.bp5d, 2)}; 20d bp: ${fmt(row.bp20d, 2)}; dataAsOf: ${dated(row.dataAsOf)}`,
    )
  }
  const streakLine = (label: string, streak: KrFlowStreak) =>
    streak.side == null
      ? `${label} streak: none measured; dataAsOf: ${dated(streak.dataAsOf)}`
      : `${label} streak: ${streak.side} ${streak.sessions} sessions; dataAsOf: ${dated(streak.dataAsOf)}`
  lines.push(streakLine('foreign', signals.foreignStreak), streakLine('institution', signals.institutionStreak))
  lines.push(
    `short-volume ratio today: ${fmt(signals.short.ratioToday, 2)}; 20d average: ${fmt(signals.short.avg20d, 2)}; z-score vs 20d: ${fmt(signals.short.z20d, 2)}; dataAsOf: ${dated(signals.short.dataAsOf)}; stale: ${signals.short.stale ? 'yes' : 'no'}`,
    `short balance ratio: ${fmt(signals.shortBalance.ratio, 2)} as of ${signals.shortBalance.date} (T+2, its own date); 20d change: ${fmt(signals.shortBalance.change20dPp, 2)} pp; dataAsOf: ${dated(signals.shortBalance.dataAsOf)}`,
    `foreign holding ratio: ${fmt(signals.foreignHolding.ratio, 2)}; 20d change: ${fmt(signals.foreignHolding.change20dPp, 2)} pp; dataAsOf: ${dated(signals.foreignHolding.dataAsOf)}; stale: ${signals.foreignHolding.stale ? 'yes' : 'no'}`,
    `5d price change: ${fmt(signals.priceChange5dPct, 2)}%; dataAsOf: ${signals.asOf}`,
    `relative ranks (same market, as of ${signals.ranks.dataAsOf}): |foreign 5d bp| percentile ${fmt(signals.ranks.foreign5dBpPercentile, 1)}; |institution 5d bp| percentile ${fmt(signals.ranks.institution5dBpPercentile, 1)}; short-ratio z percentile ${fmt(signals.ranks.shortZPercentile, 1)}`,
    `crowdingLevel: ${signals.crowdingLevel}`,
    krFlowCrowdingRuleText(),
  )
  const sides = sideLines(signals)
  lines.push(
    BOTH_SIDES_HEADER,
    `  argues higher close: ${sides.up.length ? sides.up.join('; ') : 'none measured'}`,
    `  argues lower close: ${sides.down.length ? sides.down.join('; ') : 'none measured'}`,
  )
  if (newsFallback) lines.push(`fallback: ${KR_FLOWS_NEWS_FALLBACK_LABEL}`)
  return lines.join('\n')
}

export function extractKrFlowsBlock(packetText: string | null | undefined): string | null {
  if (!packetText) return null
  const start = packetText.indexOf(KR_FLOWS_PACKET_HEADER_PREFIX)
  if (start < 0) return null
  const end = packetText.indexOf('\n\n', start)
  return packetText.slice(start, end < 0 ? undefined : end).trim()
}

export function krStockFlowsFallbackQuery(name: string, code: string): { q: string; lang: string } {
  return {
    q: `${name}(${code}) 최근 외국인·기관 순매수 순매도 뉴스 (${KR_FLOWS_NEWS_FALLBACK_LABEL})`,
    lang: 'ko',
  }
}

export function planKrFlowsPacket(
  signals: KrFlowSignals,
  name: string,
  code: string,
): {
  section: string
  extraQuery: { q: string; lang: string } | null
  fallbackReason: 'missing' | 'stale' | null
} {
  const fallbackReason = signals.flowsMissing ? 'missing' : signals.flowsStale ? 'stale' : null
  return {
    section: formatKrFlowPacketSection(signals, fallbackReason != null),
    extraQuery: fallbackReason ? krStockFlowsFallbackQuery(name, code) : null,
    fallbackReason,
  }
}

const loggedKrFlowsFallbacks = new Set<string>()

export function resetKrFlowsFallbackLogForTests(): void {
  loggedKrFlowsFallbacks.clear()
}

/** Once per round. The line has no credentials. */
export function logKrFlowsFallbackOnce(args: {
  roundId: string
  instrument: string
  asOf: string
  reason: 'missing' | 'stale'
}): void {
  const key = args.roundId || `${args.instrument}|${args.asOf}`
  if (loggedKrFlowsFallbacks.has(key)) return
  loggedKrFlowsFallbacks.add(key)
  console.log(
    `[league-generate] kr-flows-fallback round=${args.roundId} instrument=${args.instrument} asOf=${args.asOf} reason=${args.reason}`,
  )
}
