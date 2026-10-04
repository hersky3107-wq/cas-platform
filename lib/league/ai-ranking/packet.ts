/**
 * Closed-book AIRANK packet — shared by all official tiers.
 * Elo / raw scores stay in the AI injection only. Attribution is always present.
 */

import { LMARENA_ATTRIBUTION } from './meta'
import { airankAttributionLine, type AirankHorizon, type AirankParts, horizonDays } from './instrument'
import {
  addUtcDaysYmd,
  baseRateFromHistory,
  brandHeldQueriedPosition,
  nearestOnOrBefore,
  type SnapshotBrandRow,
} from './grade'
import type { LeagueLocale } from '@/lib/league/i18n/locales'

export type AirankNewsFinding = {
  query: string
  summary: string
}

export type AirankPacketIo = {
  listPublishDates(arena: string, category: string): Promise<string[]>
  loadBrandRanking(arena: string, category: string, date: string): Promise<SnapshotBrandRow[]>
  getNews?(args: { subject: string; param?: string }): Promise<AirankNewsFinding[]>
}

export type AirankPacketInput = {
  parts: AirankParts
  horizon: AirankHorizon
  asOfYmd: string
  locale?: LeagueLocale
  rankingsByDate: ReadonlyArray<{ date: string; brands: readonly SnapshotBrandRow[] }>
  news?: readonly AirankNewsFinding[]
}

function none(value: string | null | undefined): string {
  return value && value.trim() ? value : 'none measured'
}

function qualitativeGap(scoreGap: number | null): string {
  if (scoreGap == null || !Number.isFinite(scoreGap)) return 'none measured'
  const abs = Math.abs(scoreGap)
  if (abs < 20) return 'narrow'
  if (abs < 60) return 'moderate'
  return 'wide'
}

function rankOf(brands: readonly SnapshotBrandRow[], name: string): SnapshotBrandRow | null {
  const hits = brands.filter((r) => r.brand === name)
  if (!hits.length) return null
  return hits.reduce((a, b) => (b.rank < a.rank ? b : a))
}

function trendLine(
  label: string,
  rankings: ReadonlyArray<{ date: string; brands: readonly SnapshotBrandRow[] }>,
  asOf: string,
  weeks: number,
): string {
  const dates = rankings.map((r) => r.date)
  const target = addUtcDaysYmd(asOf, -weeks * 7)
  const thenDate = nearestOnOrBefore(dates, target)
  const now = rankings.find((r) => r.date === asOf) ?? rankings.at(-1)
  const then = thenDate ? rankings.find((r) => r.date === thenDate) : null
  const nowHit = now ? rankOf(now.brands, label) : null
  const thenHit = then ? rankOf(then.brands, label) : null
  if (!nowHit && !thenHit) return `${label} ${weeks}w: none measured`
  const thenBit = thenHit ? `rank ${thenHit.rank} on ${thenDate}` : 'none measured'
  const nowBit = nowHit ? `rank ${nowHit.rank} on ${now?.date ?? asOf}` : 'none measured'
  return `${label} ${weeks}w: ${thenBit} → ${nowBit}`
}

export function assembleAirankInjection(input: AirankPacketInput): string {
  const { parts, horizon, asOfYmd, rankingsByDate } = input
  const current = rankingsByDate.find((r) => r.date === asOfYmd) ?? rankingsByDate.at(-1)
  const top = (current?.brands ?? []).slice().sort((a, b) => a.rank - b.rank || a.brand.localeCompare(b.brand)).slice(0, 15)

  const rank1 = top.find((r) => r.rank === 1) ?? null
  const rank2 = top.find((r) => r.rank === 2) ?? top.filter((r) => r.brand !== rank1?.brand)[1] ?? null
  const scoreGap =
    rank1?.score != null && rank2?.score != null ? Number((rank1.score - rank2.score).toFixed(2)) : null

  const rates = baseRateFromHistory({ parts, horizon, datedBrandRanks: rankingsByDate })
  const changePct = rates.nPairs ? Math.round((100 * rates.rank1Changes) / rates.nPairs) : null
  const heldPct = rates.subjectObserved ? Math.round((100 * rates.subjectHeld) / rates.subjectObserved) : null

  const yesBits: string[] = []
  const noBits: string[] = []
  if (current) {
    const held = brandHeldQueriedPosition(parts, current.brands)
    if (parts.kind !== 'model_rank1') {
      if (held) yesBits.push(`${parts.subject} currently holds the queried position`)
      else noBits.push(`${parts.subject} does not currently hold the queried position`)
    }
  }
  if (rates.nPairs && changePct != null) {
    if (changePct >= 40) yesBits.push(`#1 brand changed in ${changePct}% of ${horizon} windows`)
    else noBits.push(`#1 brand held in ${100 - changePct}% of ${horizon} windows`)
  }

  const newsLines =
    input.news?.length
      ? input.news.map((n) => `NEWS (${n.query}): ${none(n.summary)}`)
      : ['NEWS: none measured']

  const lines = [
    `ATTRIBUTION: ${airankAttributionLine(input.locale ?? 'ko')} / ${LMARENA_ATTRIBUTION}`,
    `FIELD: ${parts.arena} / ${parts.category} as of ${current?.date ?? asOfYmd}`,
    `KIND: ${parts.kind} subject=${parts.subject}${parts.param ? ` param=${parts.param}` : ''} horizon=${horizon} (${horizonDays(horizon)}d)`,
    '',
    'BRAND RANKING (top 15 — best model per brand):',
    top.length
      ? top.map((r) => `  ${r.rank}. ${r.brand} — ${r.model}`).join('\n')
      : '  none measured',
    '',
    'RANK TREND:',
    `  ${trendLine(parts.subject, rankingsByDate, current?.date ?? asOfYmd, 4)}`,
    `  ${trendLine(parts.subject, rankingsByDate, current?.date ?? asOfYmd, 12)}`,
    parts.kind === 'brand_above' && parts.param
      ? `  ${trendLine(parts.param, rankingsByDate, current?.date ?? asOfYmd, 4)}`
      : null,
    parts.kind === 'brand_above' && parts.param
      ? `  ${trendLine(parts.param, rankingsByDate, current?.date ?? asOfYmd, 12)}`
      : null,
    '',
    'GAP rank1 vs rank2 (AI input only — do not quote Elo/score to the user):',
    `  qualitative: ${qualitativeGap(scoreGap)}; raw score gap: ${scoreGap == null ? 'none measured' : String(scoreGap)}`,
    '',
    `BASE RATE (6-month history, horizon ${horizon}):`,
    `  #1 brand changed within horizon: ${rates.nPairs ? `${rates.rank1Changes}/${rates.nPairs}` : 'none measured'}${changePct == null ? '' : ` (${changePct}%)`}`,
    parts.kind === 'model_rank1'
      ? '  subject held queried position: none measured'
      : `  subject held queried position: ${rates.subjectObserved ? `${rates.subjectHeld}/${rates.subjectObserved}` : 'none measured'}${heldPct == null ? '' : ` (${heldPct}%)`}`,
    '',
    ...newsLines,
    '',
    'BOTH SIDES — real factors only. Do not invent balance.',
    `  argues YES: ${yesBits.length ? yesBits.join('; ') : 'none measured'}`,
    `  argues NO: ${noBits.length ? noBits.join('; ') : 'none measured'}`,
  ].filter((line): line is string => line != null)

  return lines.join('\n')
}

export function airankNewsQueries(parts: AirankParts): { q: string; lang: string }[] {
  const subject = parts.subject
  if (parts.kind === 'brand_above' && parts.param) {
    return [
      { q: `${subject} AI model release announcement`, lang: 'en' },
      { q: `${parts.param} AI model release announcement`, lang: 'en' },
    ]
  }
  return [
    { q: `${subject} AI model release announcement`, lang: 'en' },
    { q: `${subject} LMArena ranking news`, lang: 'en' },
  ]
}

export async function loadAirankPacketData(
  io: AirankPacketIo,
  parts: AirankParts,
  horizon: AirankHorizon,
  asOfYmd: string,
): Promise<AirankPacketInput> {
  const dates = (await io.listPublishDates(parts.arena, parts.category)).sort()
  const windowStart = addUtcDaysYmd(asOfYmd, -200)
  const inWindow = dates.filter((d) => d >= windowStart && d <= asOfYmd)
  const rankingsByDate: AirankPacketInput['rankingsByDate'] = []
  for (const date of inWindow) {
    rankingsByDate.push({ date, brands: await io.loadBrandRanking(parts.arena, parts.category, date) })
  }
  const news = io.getNews
    ? await io.getNews({ subject: parts.subject, param: parts.param })
    : []
  return { parts, horizon, asOfYmd, rankingsByDate, news }
}
