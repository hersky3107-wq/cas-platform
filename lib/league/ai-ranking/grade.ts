/**
 * AIRANK auto-grade — pure. YES maps to engine `up`, NO to `down`
 * (`binary_subject_outcome` via gradedSidesFor). VOID is both brands absent
 * on brand_above. Shared rank 1 counts as YES for rank1 / model_rank1.
 */

import type { AirankHorizon, AirankParts } from './instrument'
import { horizonDays } from './instrument'
import { campOfBrand, isAirankCamp, type MappedVendorBrand } from './brands'

export type AirankVerdict = 'YES' | 'NO' | 'VOID'

export type AirankGrade = {
  verdict: AirankVerdict
  /** Engine binary: YES = up, NO = down. Absent on VOID. */
  direction: 'up' | 'down' | null
  rawOutcome: string
}

export type SnapshotBrandRow = {
  brand: MappedVendorBrand
  model: string
  rank: number
  score: number | null
}

export type SnapshotModelRow = {
  model: string
  brand: MappedVendorBrand
  rank: number
  score: number | null
}

export function firstSnapshotOnOrAfter(
  publishDates: readonly string[],
  deadlineYmd: string,
  createdYmd?: string | null,
): string | null {
  const floor = [deadlineYmd, createdYmd].filter((d): d is string => Boolean(d)).sort().at(-1) ?? deadlineYmd
  return [...publishDates].filter((d) => d >= floor).sort()[0] ?? null
}

function bestOf(rows: readonly SnapshotBrandRow[], brand: string): SnapshotBrandRow | null {
  const hits = rows.filter((r) => r.brand === brand)
  if (!hits.length) return null
  return hits.reduce((a, b) => (b.rank < a.rank || (b.rank === a.rank && b.model.localeCompare(a.model) < 0) ? b : a))
}

export function gradeAirankSnapshot(parts: AirankParts, input: {
  brands: readonly SnapshotBrandRow[]
  models: readonly SnapshotModelRow[]
  publishDate: string
}): AirankGrade {
  const date = input.publishDate
  if (parts.kind === 'brand_rank1') {
    const hit = bestOf(input.brands, parts.subject)
    if (!hit) return no(`NO: ${parts.subject} absent from ${date} snapshot`, date)
    const yes = hit.rank === 1
    return yes
      ? yesGrade(`YES: ${parts.subject} holds rank 1 via ${hit.model} on ${date}`, date)
      : no(`NO: ${parts.subject} best rank ${hit.rank} (${hit.model}) on ${date}`, date)
  }

  if (parts.kind === 'brand_topn') {
    const n = Number(parts.param)
    const hit = bestOf(input.brands, parts.subject)
    if (!hit) return no(`NO: ${parts.subject} absent from ${date} snapshot`, date)
    const yes = hit.rank <= n
    return yes
      ? yesGrade(`YES: ${parts.subject} rank ${hit.rank} within top ${n} via ${hit.model} on ${date}`, date)
      : no(`NO: ${parts.subject} best rank ${hit.rank} outside top ${n} on ${date}`, date)
  }

  if (parts.kind === 'brand_above') {
    const subject = bestOf(input.brands, parts.subject)
    const other = bestOf(input.brands, parts.param ?? '')
    if (!subject && !other) {
      return {
        verdict: 'VOID',
        direction: null,
        rawOutcome: `VOID: ${parts.subject} and ${parts.param} both absent from ${date} snapshot`,
      }
    }
    if (!subject) return no(`NO: ${parts.subject} absent from ${date} snapshot`, date)
    if (!other) {
      return yesGrade(`YES: ${parts.subject} present (rank ${subject.rank}) and ${parts.param} absent on ${date}`, date)
    }
    if (subject.rank < other.rank) {
      return yesGrade(
        `YES: ${parts.subject} rank ${subject.rank} above ${parts.param} rank ${other.rank} on ${date}`,
        date,
      )
    }
    return no(
      `NO: ${parts.subject} rank ${subject.rank} not above ${parts.param} rank ${other.rank} on ${date}`,
      date,
    )
  }

  if (parts.kind === 'camp_rank1' || parts.kind === 'camp_topn') {
    const camp = isAirankCamp(parts.subject) ? parts.subject : null
    const n = parts.kind === 'camp_topn' ? Number(parts.param) : 1
    const hits = camp
      ? input.brands.filter((r) => campOfBrand(r.brand) === camp && r.rank <= n)
      : []
    if (!hits.length) {
      return no(`NO: no ${parts.subject} brand in top ${n} on ${date}`, date)
    }
    const best = hits.reduce((a, b) => (b.rank < a.rank ? b : a))
    return yesGrade(
      `YES: ${best.brand} (${best.model}) holds rank ${best.rank} for camp ${parts.subject} on ${date}`,
      date,
    )
  }

  const token = foldToken(parts.subject)
  const rank1 = input.models.filter((m) => m.rank === 1)
  const hit = rank1.find((m) => foldToken(m.model).includes(token))
  if (!hit) {
    return no(`NO: no rank-1 model contains "${parts.subject}" on ${date}`, date)
  }
  return yesGrade(`YES: ${hit.model} holds rank 1 on ${date}`, date)
}

function foldToken(value: string): string {
  return value.toLowerCase().replace(/[\s._-]+/g, '')
}

function yesGrade(raw: string, _date: string): AirankGrade {
  return { verdict: 'YES', direction: 'up', rawOutcome: raw }
}

function no(raw: string, _date: string): AirankGrade {
  return { verdict: 'NO', direction: 'down', rawOutcome: raw }
}

export function addUtcDaysYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d + days))
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`
}

export function nearestOnOrBefore(dates: readonly string[], target: string): string | null {
  return [...dates].filter((d) => d <= target).sort().at(-1) ?? null
}

export function brandHeldQueriedPosition(
  parts: AirankParts,
  brands: readonly SnapshotBrandRow[],
): boolean {
  if (parts.kind === 'camp_rank1' || parts.kind === 'camp_topn') {
    const camp = isAirankCamp(parts.subject) ? parts.subject : null
    if (!camp) return false
    const n = parts.kind === 'camp_topn' ? Number(parts.param) : 1
    return brands.some((r) => campOfBrand(r.brand) === camp && r.rank <= n)
  }
  const hit = bestOf(brands, parts.subject)
  if (!hit) return false
  if (parts.kind === 'brand_rank1') return hit.rank === 1
  if (parts.kind === 'brand_topn') return hit.rank <= Number(parts.param)
  if (parts.kind === 'brand_above') {
    const other = bestOf(brands, parts.param ?? '')
    if (!other) return true
    return hit.rank < other.rank
  }
  return false
}

export function baseRateFromHistory(args: {
  parts: AirankParts
  horizon: AirankHorizon
  datedBrandRanks: ReadonlyArray<{ date: string; brands: readonly SnapshotBrandRow[] }>
}): { nPairs: number; rank1Changes: number; subjectHeld: number; subjectObserved: number } {
  const days = horizonDays(args.horizon)
  const sorted = [...args.datedBrandRanks].sort((a, b) => a.date.localeCompare(b.date))
  const dates = sorted.map((r) => r.date)
  let nPairs = 0
  let rank1Changes = 0
  let subjectHeld = 0
  let subjectObserved = 0
  for (const row of sorted) {
    const laterDate = addUtcDaysYmd(row.date, days)
    const laterKey = firstSnapshotOnOrAfter(dates, laterDate)
    const later = laterKey ? sorted.find((r) => r.date === laterKey) : null
    if (later && later.date > row.date) {
      nPairs += 1
      const a = bestOf(row.brands, bestRank1Brand(row.brands) ?? '')
      const b = bestOf(later.brands, bestRank1Brand(later.brands) ?? '')
      if ((a?.brand ?? '') !== (b?.brand ?? '')) rank1Changes += 1
    }
    if (args.parts.kind === 'model_rank1') continue
    if (args.parts.kind === 'camp_rank1' || args.parts.kind === 'camp_topn') {
      const camp = isAirankCamp(args.parts.subject) ? args.parts.subject : null
      if (camp && row.brands.some((r) => campOfBrand(r.brand) === camp)) {
        subjectObserved += 1
        if (brandHeldQueriedPosition(args.parts, row.brands)) subjectHeld += 1
      }
      continue
    }
    if (bestOf(row.brands, args.parts.subject)) {
      subjectObserved += 1
      if (brandHeldQueriedPosition(args.parts, row.brands)) subjectHeld += 1
    }
  }
  return { nPairs, rank1Changes, subjectHeld, subjectObserved }
}

function bestRank1Brand(rows: readonly SnapshotBrandRow[]): string | null {
  const first = rows.filter((r) => r.rank === 1).sort((a, b) => a.brand.localeCompare(b.brand))[0]
  return first?.brand ?? null
}
