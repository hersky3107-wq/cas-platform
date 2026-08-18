import {
  CAMP_LABEL,
  TIER_LABEL,
  emptyCombinedTrack,
  type Camp,
  type CombinedMethodTrack,
  type LeagueTier,
} from './card-types'

/**
 * AI Prediction League — LEADERBOARD aggregation (read-only).
 *
 * `graded rows -> LeaderboardData`, computed exactly ONCE here so the client
 * never recomputes a win rate itself (mirrors `card-aggregate.ts`: pure
 * data-in/data-out, no I/O).
 *
 * SCOUT IS INCLUDED. Scout now persists a directional call and is graded on
 * direction like every other tier. There is no excludeScout filter here and
 * the DB read path must not add one either.
 *
 * STATISTICAL HONESTY: every row carries `n` alongside `winRatePct`, and any
 * row with `n < LEADERBOARD_PROVISIONAL_THRESHOLD` is flagged `provisional`.
 * The UI must never render a win rate without also rendering `n`, and must
 * not show a bold percentage while provisional.
 *
 * SCOPE of a "graded" row (applied by the caller at query time):
 *   - `is_correct` is non-null
 *   - the round's `item_type === 'ranked'`
 */

export const LEADERBOARD_PROVISIONAL_THRESHOLD = 10

/** Korean national-pride slice — roster brand strings, not i18n keys. */
export const KOREA_BRANDS = ['Upstage', 'NAVER', 'LG'] as const

export type LeaderboardScope =
  | 'model'
  | 'campHeadline'
  | 'method'
  | 'camp'
  | 'tier'
  | 'brand'
  | 'category'
  | 'korea'

/** One graded, in-scope prediction — the minimal shape this module needs. */
export type GradedPredictionRow = {
  model_id: string
  brand: string
  camp: string
  league_tier: string
  category: string
  is_correct: boolean
  /** Required for the combined-method (majority-vote) track record. */
  round_id: string
  predicted_direction: 'up' | 'down' | 'flat' | null
}

export type LeaderboardRow = {
  key: string
  label: string
  correct: number
  resolved: number
  /** Same as `resolved` — kept as its own field because the UI must always show it next to `winRatePct`. */
  n: number
  /** null only when `resolved === 0` (should not occur — buckets are only created from rows that exist). */
  winRatePct: number | null
  /** true when `n < LEADERBOARD_PROVISIONAL_THRESHOLD`. */
  provisional: boolean
}

export type LeaderboardSlice = {
  scope: LeaderboardScope
  rows: LeaderboardRow[]
  /** Total graded rows that fed this slice (== sum of each row's `resolved`). */
  totalResolved: number
}

export type LeaderboardData = {
  /** PRIMARY: per-model ranking (all models that have at least one graded row). */
  model: LeaderboardSlice
  /** PRIMARY headline: US vs China only. */
  campHeadline: LeaderboardSlice
  /** PRIMARY: PURE-REASONING (tiers 1/2/3) vs RESEARCH (scout). */
  method: LeaderboardSlice
  /** SECONDARY: US vs China vs third-country. */
  camp: LeaderboardSlice
  /** SECONDARY: Premier / Challenger / World / Scout. */
  tier: LeaderboardSlice
  /** SECONDARY: company grouping (OpenAI vs Google vs …). */
  brand: LeaderboardSlice
  /** SECONDARY: stocks vs crypto vs fx, etc. */
  category: LeaderboardSlice
  /** SECONDARY: Upstage vs NAVER vs LG. */
  korea: LeaderboardSlice
  /**
   * Combined-method track record: treating the 40-model majority vote as a
   * single method, how often that consensus matched the actual outcome.
   */
  combined: CombinedMethodTrack
  /** Total in-scope graded rows considered. */
  totalConsidered: number
  generatedAt: string
}

function formatCategory(category: string): string {
  return category.replace(/_/g, ' ')
}

function bucketOf(row: GradedPredictionRow, scope: LeaderboardScope): { key: string; label: string } | null {
  switch (scope) {
    case 'model':
      return { key: row.model_id, label: row.brand }
    case 'campHeadline':
      if (row.camp !== 'us' && row.camp !== 'china') return null
      return { key: row.camp, label: CAMP_LABEL[row.camp as Camp] ?? row.camp }
    case 'method':
      return row.league_tier === 'scout'
        ? { key: 'research', label: 'Research' }
        : { key: 'pure_reasoning', label: 'Pure reasoning' }
    case 'camp':
      return { key: row.camp, label: CAMP_LABEL[row.camp as Camp] ?? row.camp }
    case 'tier':
      return { key: row.league_tier, label: TIER_LABEL[row.league_tier as LeagueTier] ?? row.league_tier }
    case 'brand':
      return { key: row.brand, label: row.brand }
    case 'category':
      return { key: row.category, label: formatCategory(row.category) }
    case 'korea':
      if (!(KOREA_BRANDS as readonly string[]).includes(row.brand)) return null
      return { key: row.brand, label: row.brand }
  }
}

function sortRows(rows: LeaderboardRow[]): LeaderboardRow[] {
  return [...rows].sort((a, b) => {
    const wa = a.winRatePct ?? -1
    const wb = b.winRatePct ?? -1
    if (wb !== wa) return wb - wa
    if (b.resolved !== a.resolved) return b.resolved - a.resolved
    return a.key.localeCompare(b.key)
  })
}

function toRow(key: string, b: { label: string; correct: number; resolved: number }): LeaderboardRow {
  return {
    key,
    label: b.label,
    correct: b.correct,
    resolved: b.resolved,
    n: b.resolved,
    winRatePct: b.resolved > 0 ? Math.round((b.correct / b.resolved) * 1000) / 10 : null,
    provisional: b.resolved < LEADERBOARD_PROVISIONAL_THRESHOLD,
  }
}

/** Builds one slice from the full graded-row set. Keys that never appear are omitted. */
export function buildLeaderboardSlice(rows: readonly GradedPredictionRow[], scope: LeaderboardScope): LeaderboardSlice {
  const buckets = new Map<string, { label: string; correct: number; resolved: number }>()
  let considered = 0
  for (const row of rows) {
    const bucketKey = bucketOf(row, scope)
    if (!bucketKey) continue
    considered += 1
    const bucket = buckets.get(bucketKey.key) ?? { label: bucketKey.label, correct: 0, resolved: 0 }
    bucket.resolved += 1
    if (row.is_correct) bucket.correct += 1
    buckets.set(bucketKey.key, bucket)
  }

  return {
    scope,
    rows: sortRows(Array.from(buckets.entries()).map(([key, b]) => toRow(key, b))),
    totalResolved: considered,
  }
}

/**
 * Combined method = the 40-model majority vote treated as one predictor.
 * For each resolved round: take the majority direction among graded models;
 * that vote is correct iff a model that called the majority direction was
 * graded correct (they all share the same actual outcome). Ties / no
 * majority do not increment `n`.
 */
export function buildCombinedMethodTrack(rows: readonly GradedPredictionRow[]): CombinedMethodTrack {
  const byRound = new Map<string, GradedPredictionRow[]>()
  for (const row of rows) {
    const list = byRound.get(row.round_id) ?? []
    list.push(row)
    byRound.set(row.round_id, list)
  }

  let correct = 0
  let resolved = 0
  for (const group of byRound.values()) {
    const tally = { up: 0, down: 0, flat: 0 }
    for (const row of group) {
      if (row.predicted_direction === 'up' || row.predicted_direction === 'down' || row.predicted_direction === 'flat') {
        tally[row.predicted_direction] += 1
      }
    }
    const entries = (['up', 'down', 'flat'] as const)
      .map((d) => [d, tally[d]] as const)
      .sort((a, b) => b[1] - a[1])
    const [topDir, topCount] = entries[0]!
    if (topCount === 0) continue
    const tied = entries.filter(([, c]) => c === topCount).length
    if (tied !== 1) continue

    const sample = group.find((r) => r.predicted_direction === topDir)
    if (!sample) continue
    resolved += 1
    if (sample.is_correct) correct += 1
  }

  if (resolved === 0) return emptyCombinedTrack()
  return {
    correct,
    resolved,
    n: resolved,
    winRatePct: Math.round((correct / resolved) * 1000) / 10,
    provisional: resolved < LEADERBOARD_PROVISIONAL_THRESHOLD,
  }
}

/** Single entry point: one pass over already-filtered graded rows, all slices. */
export function buildLeaderboardData(rows: readonly GradedPredictionRow[]): LeaderboardData {
  return {
    model: buildLeaderboardSlice(rows, 'model'),
    campHeadline: buildLeaderboardSlice(rows, 'campHeadline'),
    method: buildLeaderboardSlice(rows, 'method'),
    camp: buildLeaderboardSlice(rows, 'camp'),
    tier: buildLeaderboardSlice(rows, 'tier'),
    brand: buildLeaderboardSlice(rows, 'brand'),
    category: buildLeaderboardSlice(rows, 'category'),
    korea: buildLeaderboardSlice(rows, 'korea'),
    combined: buildCombinedMethodTrack(rows),
    totalConsidered: rows.length,
    generatedAt: new Date().toISOString(),
  }
}

