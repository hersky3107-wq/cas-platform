/**
 * PROPERTY:{country}:{regionCode}:{metric}:{refMonth}
 * refMonth is the statistical reference period (YYYY-MM), not "today".
 * resolves_at is that period's publication datetime.
 */

import {
  PROPERTY_REGIONS,
  chipPropertyRegions,
  propertyRegion,
  type PropertyRegion,
} from './real-estate-regions'

export type PropertyParts = {
  country: string
  regionCode: string
  metric: string
  refMonth: string
  thresholdBp: number | null
  region: PropertyRegion
  resolvesAtMs: number
}

const METRIC_RE = /^(apt_sale_mom|apt_jeonse_mom|hpi_mom|hpi_qoq)(?:_gt(\d+))?$/
const REF_RE = /^(\d{4})-(0[1-9]|1[0-2])$/

export function encodePropertyInstrument(args: {
  country: string
  regionCode: string
  metric: string
  refMonth: string
}): string {
  return ['PROPERTY', args.country, args.regionCode, args.metric, args.refMonth].join(':')
}

export function decodePropertyInstrument(instrument: string | null | undefined): PropertyParts | null {
  if (!instrument) return null
  const parts = instrument.split(':')
  if (parts.length !== 5 || parts[0] !== 'PROPERTY') return null
  const country = parts[1] ?? ''
  const regionCode = parts[2] ?? ''
  const metric = parts[3] ?? ''
  const refMonth = parts[4] ?? ''
  const metricMatch = METRIC_RE.exec(metric)
  if (!metricMatch || !REF_RE.test(refMonth)) return null
  const region = propertyRegion(country, regionCode)
  if (!region) return null
  const thresholdBp = metricMatch[2] ? Number(metricMatch[2]) : null
  const resolvesAtMs = publicationMs(region, refMonth)
  if (!Number.isFinite(resolvesAtMs)) return null
  return { country, regionCode, metric, refMonth, thresholdBp, region, resolvesAtMs }
}

export function propositionKindForProperty(parts: PropertyParts): 'binary_subject_outcome' | 'binary_threshold' {
  return parts.thresholdBp != null ? 'binary_threshold' : 'binary_subject_outcome'
}

/** 0.10%–10.00%, stored as basis points of one percent (1% = 100). */
export function parseMomThresholdBp(text: string): number | null {
  const match = /(\d+(?:\.\d+)?)\s*%/.exec(text)
  if (!match) return null
  const bp = Math.round(Number(match[1]) * 100)
  if (!Number.isFinite(bp) || bp < 10 || bp > 1000) return null
  return bp
}

export function metricFor(region: PropertyRegion, text: string, thresholdBp: number | null): string | null {
  let base: string = region.metric
  if (region.country === 'KR' && /전세/.test(text)) base = 'apt_jeonse_mom'
  if (thresholdBp == null) return base
  if (region.cadence === 'quarter' && base.endsWith('_mom')) return null
  return `${base}_gt${thresholdBp}`
}

export function formatPropertyProposition(parts: PropertyParts): string {
  const pub = publicationYmd(parts.region, parts.refMonth)
  const change = parts.region.cadence === 'quarter' ? '전분기대비' : '전월대비'
  const bar = parts.thresholdBp != null ? `${(parts.thresholdBp / 100).toFixed(2).replace(/\.?0+$/, '')}% 초과` : '상승'
  const series = parts.metric.startsWith('apt_jeonse') ? '아파트 전세가격지수' : parts.region.seriesKo
  return `[${parts.region.publisherKo} ${pub} 공표분, 기준월 ${parts.refMonth}] ${parts.region.nameKo} ${series} ${change} ${bar}?`
}

export function propertyResolutionRule(parts: PropertyParts): string {
  const tier =
    parts.region.tier === 'zillow'
      ? 'Zillow ZHVI is an unofficial modeled index; grade the published vintage and label it unofficial.'
      : parts.region.tier === 'fhfa'
        ? 'FHFA quarterly HPI.'
        : 'Official published index.'
  return [
    `Grade the first official publication of reference period ${parts.refMonth}.`,
    'If the publisher issues a correction notice (통계정정), use the corrected value.',
    tier,
    'Not a complex price, not an appraisal, not brokerage advice.',
  ].join(' ')
}

export function propertyHeadlineLabel(instrument: string, locale: 'ko' | 'en' = 'ko'): string | null {
  const parts = decodePropertyInstrument(instrument)
  if (!parts) return null
  const name = locale === 'ko' ? parts.region.nameKo : parts.region.nameEn
  const change = parts.region.cadence === 'quarter' ? (locale === 'ko' ? '전분기' : 'QoQ') : locale === 'ko' ? '전월' : 'MoM'
  return `${name} · ${change} ${parts.refMonth}`
}

/** Clarify-pick ids only — not the hub chip rail (real_estate is freeform search). */
export function headlinePropertyInstruments(now: Date = new Date()): string[] {
  return chipPropertyRegions().map((row) => instrumentForRegion(row, '', null, now))
}

export function instrumentForRegion(
  region: PropertyRegion,
  text: string,
  thresholdBp: number | null,
  now: Date,
): string {
  const metric = metricFor(region, text, thresholdBp) ?? region.metric
  const refMonth = nextRefMonth(region, now)
  return encodePropertyInstrument({
    country: region.country,
    regionCode: region.code,
    metric,
    refMonth,
  })
}

export function propertyClarifyOptions(now: Date = new Date()): Array<{ id: string; label: string }> {
  return chipPropertyRegions().map((row) => {
    const id = instrumentForRegion(row, '', null, now)
    return { id, label: `${row.nameKo} ${row.seriesKo}` }
  })
}

const FILLER =
  /아파트|집값|부동산|주택|매매|가격지수|가격|지수|오를까|오르까|오를지|상승|하락|할까|넘길까|전월비|전월대비|전분기대비|\d+(?:\.\d+)?\s*%/g

export function compactPropertyQuery(raw: string): string {
  return raw.toLowerCase().replace(/\s+/g, '').replace(FILLER, '')
}

/** User already named the aggregate print (전국/전체), not just the country. */
export function isExplicitBroadAsk(compact: string): boolean {
  if (/전체|nationwide/.test(compact)) return true
  if (compact.includes('전국')) return true
  if (compact.includes('national') && compact !== 'national') return true
  return false
}

export function matchPropertyRegion(raw: string): PropertyRegion | PropertyRegion[] | null {
  const compact = compactPropertyQuery(raw)
  if (!compact) return null
  let bestLen = 0
  const hits: PropertyRegion[] = []
  for (const row of PROPERTY_REGIONS) {
    for (const alias of row.aliases) {
      const key = alias.toLowerCase().replace(/\s+/g, '')
      if (key.length <= 3 && /^[a-z]+$/.test(key)) {
        if (compact !== key) continue
      } else if (!compact.includes(key)) {
        continue
      }
      if (key.length > bestLen) {
        bestLen = key.length
        hits.length = 0
        hits.push(row)
      } else if (key.length === bestLen && !hits.includes(row)) {
        hits.push(row)
      }
    }
  }
  if (hits.length === 0) return null
  if (hits.length === 1) return hits[0]!
  return hits
}

export function nextRefMonth(region: PropertyRegion, now: Date): string {
  const start = region.cadence === 'quarter' ? previousQuarterEnd(now, 2) : addMonths(utcYear(now), utcMonth(now), -region.lagMonths - 1)
  for (let i = 0; i < 8; i++) {
    const cursor = region.cadence === 'quarter' ? addMonths(start.year, start.month, i * 3) : addMonths(start.year, start.month, i)
    const ref = yyyymm(cursor.year, cursor.month)
    if (region.cadence === 'quarter' && ![3, 6, 9, 12].includes(cursor.month)) continue
    if (publicationMs(region, ref) > now.getTime()) return ref
  }
  const fallback = addMonths(utcYear(now), utcMonth(now), 1)
  return yyyymm(fallback.year, fallback.month)
}

export function publicationYmd(region: PropertyRegion, refMonth: string): string {
  return new Date(publicationMs(region, refMonth)).toISOString().slice(0, 10)
}

export function publicationMs(region: PropertyRegion, refMonth: string): number {
  const match = REF_RE.exec(refMonth)
  if (!match) return NaN
  const year = Number(match[1])
  const month = Number(match[2])
  const shifted = addMonths(year, month, region.lagMonths)
  if (region.pubRule === 'kr15' || region.pubRule === 'day15') {
    return rollWeekend(Date.UTC(shifted.year, shifted.month - 1, 15))
  }
  if (region.pubRule === 'zillow16') {
    return Date.UTC(shifted.year, shifted.month - 1, 16)
  }
  if (region.pubRule === 'lastTue') return lastTuesdayUtc(shifted.year, shifted.month)
  return secondWednesdayUtc(shifted.year, shifted.month)
}

function rollWeekend(ms: number): number {
  const day = new Date(ms).getUTCDay()
  if (day === 6) return ms + 2 * 86_400_000
  if (day === 0) return ms + 86_400_000
  return ms
}

function lastTuesdayUtc(year: number, month: number): number {
  const last = new Date(Date.UTC(year, month, 0))
  const back = (last.getUTCDay() - 2 + 7) % 7
  return Date.UTC(year, month - 1, last.getUTCDate() - back)
}

function secondWednesdayUtc(year: number, month: number): number {
  const first = new Date(Date.UTC(year, month - 1, 1))
  const toWed = (3 - first.getUTCDay() + 7) % 7
  return Date.UTC(year, month - 1, 1 + toWed + 7)
}

function previousQuarterEnd(now: Date, quartersBack: number): { year: number; month: number } {
  const month = utcMonth(now)
  const endMonth = [3, 6, 9, 12].find((m) => m >= month) ?? 12
  return addMonths(utcYear(now), endMonth, -3 * quartersBack)
}

function addMonths(year: number, month: number, delta: number): { year: number; month: number } {
  const index = year * 12 + (month - 1) + delta
  return { year: Math.floor(index / 12), month: (index % 12) + 1 }
}

function yyyymm(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`
}

function utcYear(now: Date): number {
  return now.getUTCFullYear()
}

function utcMonth(now: Date): number {
  return now.getUTCMonth() + 1
}

export function isDongOrComplex(raw: string): boolean {
  if (/래미안|은마|자이|힐스테이트|푸르지오|롯데캐슬|아이파크|이편한|e편한|더샵|호반|센트레빌|단지|호가|\d+\s*호\b/i.test(raw)) {
    return true
  }
  if (/상권|역세권|\d+\s*번지|[가-힣]+로\s*\d+|[가-힣]+길\s*\d+/.test(raw)) return true
  if (/kb\s*(시세|단지)|국민은행\s*시세/i.test(raw)) return true
  if (/(?<![가-힣])[가-힣]{2,6}동(?!구)|(?<![가-힣])[가-힣]{2,6}(읍|면)(?![가-힣])/.test(raw)) return true
  return false
}

export function isBrokerageAsk(raw: string): boolean {
  return /지금\s*살|지금\s*팔|매수\s*추천|매도\s*추천|사야\s*할|팔아야|집\s*살까|중개/.test(raw)
}
