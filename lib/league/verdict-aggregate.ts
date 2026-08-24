import type { Camp, Direction, LeagueTier } from './card-types'
import type { CountryCode } from './country'
import { roundHitRecord } from './round-hit'
import { winRatePctForDisplay } from './win-rate'

/**
 * AI Prediction League — VERDICT PANEL aggregation (pure, no I/O).
 *
 * `round + predictions + roster meta [+ cross-round grades] -> VerdictPayload`.
 * Computed once here so the panel never recomputes a ratio itself.
 *
 * HARD RULES (enforced by tests):
 *  - hitRecord comes ONLY from `roundHitRecord()` — raw counts, never a %.
 *  - Group rows (camp / country / tier / book) are RAW COUNTS ONLY.
 *    Denominator is always `is_correct !== null`. Ungraded models are counted
 *    in `ungraded`, never silently dropped.
 *  - Empty groups return `[]`, not a zero-filled placeholder row.
 *  - overconfident: wrong predictions, confidence desc, max 5. Raw confidence
 *    only — no Brier, no derived "허풍 지수".
 *  - streaks: omit the key entirely when graded rounds < 2 OR the current
 *    win streak is 0 or 1. Never emit 0 or 1.
 *  - crossRoundRates: ONLY via `winRatePctForDisplay` from `./win-rate.ts`.
 *    Below `MIN_GRADED_ROUNDS_FOR_WIN_RATE` the key is absent (data-level block).
 *  - This module is structurally incapable of emitting a percent string
 *    (`/%$/`) or a single-round ratio float in (0, 1).
 */

export type VerdictBook = 'closed' | 'scout'

export type VerdictRosterMeta = {
  model_id: string
  camp: Camp
  country: CountryCode
  tier: LeagueTier
  book: VerdictBook
}

/** One model_predictions row for THIS round (the panel's subject). */
export type VerdictPredictionRow = {
  model_id: string
  brand: string
  /** Prefer roster meta when present; these are fallbacks from the DB row. */
  camp?: Camp | string
  league_tier?: LeagueTier | string
  predicted_direction: Direction | string | null
  /** 0–100 model confidence, or null. */
  predicted_value: number | null
  is_correct: boolean | null
}

/**
 * Already-graded rows across rounds (including the subject round), used only
 * for streaks + crossRoundRates. Order does not matter — we sort by
 * `resolved_at` ascending inside.
 */
export type VerdictCrossRoundGrade = {
  model_id: string
  round_id: string
  is_correct: boolean
  resolved_at: string
}

export type VerdictRoundRow = {
  id: string
}

export type VerdictHitRecord = {
  hits: number
  graded: number
  total: number
  ungraded: number
}

export type VerdictConfidenceBucketKey = '0_49' | '50_59' | '60_69' | '70_79' | '80_100' | 'unknown'

export type VerdictDistribution = {
  up: number
  down: number
  noDirection: number
  confidenceBuckets: ReadonlyArray<{ key: VerdictConfidenceBucketKey; count: number }>
}

export type VerdictGroupCount = {
  key: string
  hits: number
  graded: number
  ungraded: number
}

export type VerdictOverconfident = {
  model_id: string
  brand: string
  /** Raw `predicted_value` — never a derived score. */
  confidence: number | null
  direction: Direction | null
}

export type VerdictCrossRoundRate = {
  correct: number
  graded: number
  /** Truncated percentage from `winRatePctForDisplay` — never a string with `%`. */
  pct: number
}

export type VerdictPayload = {
  hitRecord: VerdictHitRecord
  distribution: VerdictDistribution
  byCamp: VerdictGroupCount[]
  byCountry: VerdictGroupCount[]
  byTier: VerdictGroupCount[]
  byBook: VerdictGroupCount[]
  overconfident: VerdictOverconfident[]
  /**
   * model_id → current win streak. Key is OMITTED when graded rounds < 2 or
   * the streak is 0/1. Absent entirely (not `{}`) when no model qualifies.
   */
  streaks?: Record<string, number>
  /**
   * model_id → cross-round rate. Key is OMITTED below the win-rate minimum
   * sample. Absent entirely when no model qualifies.
   */
  crossRoundRates?: Record<string, VerdictCrossRoundRate>
}

const CONFIDENCE_BUCKET_ORDER: readonly VerdictConfidenceBucketKey[] = [
  '0_49',
  '50_59',
  '60_69',
  '70_79',
  '80_100',
  'unknown',
]

const CAMP_ORDER: readonly Camp[] = ['us', 'china', 'other']
const TIER_ORDER: readonly LeagueTier[] = ['premier', 'challenger', 'world', 'scout']
const BOOK_ORDER: readonly VerdictBook[] = ['closed', 'scout']
const COUNTRY_ORDER: readonly CountryCode[] = ['US', 'CN', 'KR', 'FR', 'CA', 'INT']

function confidenceBucket(value: number | null): VerdictConfidenceBucketKey {
  if (value === null || !Number.isFinite(value)) return 'unknown'
  if (value < 50) return '0_49'
  if (value < 60) return '50_59'
  if (value < 70) return '60_69'
  if (value < 80) return '70_79'
  return '80_100'
}

function toDirection(raw: string | null | undefined): Direction | null {
  return raw === 'up' || raw === 'down' || raw === 'flat' ? raw : null
}

function toCamp(raw: string | null | undefined): Camp | null {
  return raw === 'us' || raw === 'china' || raw === 'other' ? raw : null
}

function toTier(raw: string | null | undefined): LeagueTier | null {
  return raw === 'premier' || raw === 'challenger' || raw === 'world' || raw === 'scout' ? raw : null
}

type ResolvedMeta = {
  camp: Camp
  country: CountryCode
  tier: LeagueTier
  book: VerdictBook
}

function resolveMeta(
  row: VerdictPredictionRow,
  rosterById: Map<string, VerdictRosterMeta>
): ResolvedMeta | null {
  const fromRoster = rosterById.get(row.model_id)
  if (fromRoster) {
    return {
      camp: fromRoster.camp,
      country: fromRoster.country,
      tier: fromRoster.tier,
      book: fromRoster.book,
    }
  }
  const camp = toCamp(row.camp ?? null)
  const tier = toTier(row.league_tier ?? null)
  if (!camp || !tier) return null
  return {
    camp,
    country: camp === 'us' ? 'US' : camp === 'china' ? 'CN' : 'INT',
    tier,
    book: tier === 'scout' ? 'scout' : 'closed',
  }
}

function emptyCounter(): { hits: number; graded: number; ungraded: number } {
  return { hits: 0, graded: 0, ungraded: 0 }
}

function bump(
  map: Map<string, { hits: number; graded: number; ungraded: number }>,
  key: string,
  isCorrect: boolean | null
): void {
  const row = map.get(key) ?? emptyCounter()
  if (isCorrect === null) row.ungraded += 1
  else {
    row.graded += 1
    if (isCorrect === true) row.hits += 1
  }
  map.set(key, row)
}

function toGroupArray(
  map: Map<string, { hits: number; graded: number; ungraded: number }>,
  order: readonly string[]
): VerdictGroupCount[] {
  const out: VerdictGroupCount[] = []
  const seen = new Set<string>()
  for (const key of order) {
    const row = map.get(key)
    if (!row) continue
    seen.add(key)
    out.push({ key, hits: row.hits, graded: row.graded, ungraded: row.ungraded })
  }
  for (const [key, row] of map) {
    if (seen.has(key)) continue
    out.push({ key, hits: row.hits, graded: row.graded, ungraded: row.ungraded })
  }
  return out
}

/** Current trailing win streak ending at the most recent graded round. */
function currentWinStreak(grades: readonly VerdictCrossRoundGrade[]): number {
  const sorted = [...grades].sort((a, b) => a.resolved_at.localeCompare(b.resolved_at))
  let streak = 0
  for (let i = sorted.length - 1; i >= 0; i--) {
    if (sorted[i]!.is_correct === true) streak += 1
    else break
  }
  return streak
}

/**
 * Pure assembly. `crossRound` is optional — when omitted, `streaks` and
 * `crossRoundRates` are absent from the payload.
 */
export function buildVerdictPayload(args: {
  round: VerdictRoundRow
  predictions: readonly VerdictPredictionRow[]
  roster: readonly VerdictRosterMeta[]
  crossRound?: readonly VerdictCrossRoundGrade[]
}): VerdictPayload {
  void args.round
  const rosterById = new Map(args.roster.map((r) => [r.model_id, r]))

  const hit = roundHitRecord(args.predictions)
  const total = args.predictions.length
  const ungraded = total - hit.graded
  const hitRecord: VerdictHitRecord = {
    hits: hit.correct,
    graded: hit.graded,
    total,
    ungraded,
  }

  let up = 0
  let down = 0
  let noDirection = 0
  const bucketCounts = new Map<VerdictConfidenceBucketKey, number>()
  for (const key of CONFIDENCE_BUCKET_ORDER) bucketCounts.set(key, 0)

  const byCamp = new Map<string, { hits: number; graded: number; ungraded: number }>()
  const byCountry = new Map<string, { hits: number; graded: number; ungraded: number }>()
  const byTier = new Map<string, { hits: number; graded: number; ungraded: number }>()
  const byBook = new Map<string, { hits: number; graded: number; ungraded: number }>()

  const wrong: VerdictOverconfident[] = []

  for (const row of args.predictions) {
    const dir = toDirection(row.predicted_direction)
    if (dir === 'up') up += 1
    else if (dir === 'down') down += 1
    else noDirection += 1

    const bucket = confidenceBucket(row.predicted_value)
    bucketCounts.set(bucket, (bucketCounts.get(bucket) ?? 0) + 1)

    const meta = resolveMeta(row, rosterById)
    if (meta) {
      bump(byCamp, meta.camp, row.is_correct)
      bump(byCountry, meta.country, row.is_correct)
      bump(byTier, meta.tier, row.is_correct)
      bump(byBook, meta.book, row.is_correct)
    }

    if (row.is_correct === false) {
      wrong.push({
        model_id: row.model_id,
        brand: row.brand,
        confidence: row.predicted_value,
        direction: dir,
      })
    }
  }

  wrong.sort((a, b) => {
    const ac = a.confidence
    const bc = b.confidence
    if (ac === null && bc === null) return a.model_id.localeCompare(b.model_id)
    if (ac === null) return 1
    if (bc === null) return -1
    if (bc !== ac) return bc - ac
    return a.model_id.localeCompare(b.model_id)
  })

  const distribution: VerdictDistribution = {
    up,
    down,
    noDirection,
    confidenceBuckets: CONFIDENCE_BUCKET_ORDER.map((key) => ({
      key,
      count: bucketCounts.get(key) ?? 0,
    })).filter((b) => b.count > 0),
  }

  const payload: VerdictPayload = {
    hitRecord,
    distribution,
    byCamp: toGroupArray(byCamp, CAMP_ORDER),
    byCountry: toGroupArray(byCountry, COUNTRY_ORDER),
    byTier: toGroupArray(byTier, TIER_ORDER),
    byBook: toGroupArray(byBook, BOOK_ORDER),
    overconfident: wrong.slice(0, 5),
  }

  if (args.crossRound && args.crossRound.length > 0) {
    const byModel = new Map<string, VerdictCrossRoundGrade[]>()
    for (const g of args.crossRound) {
      const list = byModel.get(g.model_id) ?? []
      list.push(g)
      byModel.set(g.model_id, list)
    }

    const streaks: Record<string, number> = {}
    const crossRoundRates: Record<string, VerdictCrossRoundRate> = {}

    for (const [modelId, grades] of byModel) {
      if (grades.length >= 2) {
        const streak = currentWinStreak(grades)
        if (streak >= 2) streaks[modelId] = streak
      }

      let correct = 0
      for (const g of grades) if (g.is_correct) correct += 1
      const pct = winRatePctForDisplay(correct, grades.length)
      if (pct !== null) {
        crossRoundRates[modelId] = { correct, graded: grades.length, pct }
      }
    }

    if (Object.keys(streaks).length > 0) payload.streaks = streaks
    if (Object.keys(crossRoundRates).length > 0) payload.crossRoundRates = crossRoundRates
  }

  return payload
}

/** Helper for callers that already have a league roster entry shape. */
export function bookFromTier(tier: LeagueTier): VerdictBook {
  return tier === 'scout' ? 'scout' : 'closed'
}
