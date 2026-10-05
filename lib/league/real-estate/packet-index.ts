/**
 * Official index block for a housing packet. Search findings stay secondary.
 * Missing numbers stay missing. Nothing here is invented.
 */

import { publicationYmd } from '../gateway/adapters/real-estate-catalog'
import type { PropertyParts } from '../gateway/adapters/real-estate-catalog'
import { priorPeriod } from './vintage'

export type IndexLevel = {
  refPeriod: string
  value: number
}

export type HousingPacketFacts = {
  source: string
  seriesId: string
  sourceUrl: string
  levels: readonly IndexLevel[]
  national?: { seriesId: string; levels: readonly IndexLevel[] } | null
  note?: string | null
}

export function formatHousingIndexBlock(parts: PropertyParts, facts: HousingPacketFacts | null): string {
  const release = publicationYmd(parts.region, parts.refMonth)
  const header = [
    'OFFICIAL INDEX',
    `Source: ${facts?.source ?? 'not loaded'}`,
    `Series: ${facts?.seriesId ?? parts.region.code}`,
    `Reference period: ${parts.refMonth}`,
    `Expected release: ${release} (${parts.region.pubRule}, lag ${parts.region.lagMonths})`,
    facts?.sourceUrl ? `URL: ${facts.sourceUrl}` : '',
  ].filter(Boolean)
  if (!facts || facts.levels.length === 0) {
    return [
      ...header,
      facts?.note ?? 'No stored index levels. Do not invent a level, a percent, or a release that is not printed above.',
    ].join('\n')
  }
  const levels = [...facts.levels].sort((a, b) => a.refPeriod.localeCompare(b.refPeriod)).slice(-24)
  const latest = levels[levels.length - 1]!
  const priorKey = priorPeriod(latest.refPeriod, parts.region.cadence)
  const prev = priorKey ? levels.find((row) => row.refPeriod === priorKey) ?? null : null
  const yoy = levels.find((row) => row.refPeriod === shiftYear(latest.refPeriod, -1)) ?? null
  const lines = [
    ...header,
    `Latest stored print: ${latest.refPeriod} ${formatLevel(latest.value)}`,
    prev ? `Previous print: ${prev.refPeriod} ${formatLevel(prev.value)}  MoM ${formatPct(latest.value, prev.value)}` : 'MoM: not enough history',
    yoy ? `YoY vs ${yoy.refPeriod}: ${formatPct(latest.value, yoy.value)}` : 'YoY: not enough history',
    nationalLine(facts.national ?? null),
    'Last stored months (oldest → newest, at most 24):',
    ...levels.map((row) => `${row.refPeriod} ${formatLevel(row.value)}`),
    '',
    'BOTH SIDES — real factors only. Do not invent balance.',
  ]
  return lines.filter((line) => line !== '').join('\n')
}

function nationalLine(national: HousingPacketFacts['national']): string {
  if (!national || national.levels.length < 2) return 'National comparison: not stored'
  const levels = [...national.levels].sort((a, b) => a.refPeriod.localeCompare(b.refPeriod))
  const latest = levels[levels.length - 1]!
  const prev = levels[levels.length - 2]!
  return `National ${national.seriesId} ${latest.refPeriod} MoM ${formatPct(latest.value, prev.value)}`
}

function formatLevel(value: number): string {
  return value.toFixed(2)
}

function formatPct(current: number, prior: number): string {
  if (prior === 0) return 'n/a'
  const pct = ((current - prior) / prior) * 100
  const sign = pct > 0 ? '+' : ''
  return `${sign}${pct.toFixed(2)}%`
}

function shiftYear(period: string, delta: number): string {
  const match = /^(\d{4})-(\d{2})$/.exec(period)
  if (!match) return ''
  return `${Number(match[1]) + delta}-${match[2]}`
}
