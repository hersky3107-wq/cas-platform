import { CAMP_LABEL, TIER_LABEL, type Camp, type LeagueTier } from './card-types'

/**
 * AI Prediction League — LEADERBOARD aggregation (read-only).
 *
 * `graded rows -> LeaderboardData`, computed exactly ONCE here so the client
 * never recomputes a win rate itself (mirrors the `card-aggregate.ts`
 * pattern: pure data-in/data-out, no I/O, unit-testable without Supabase —
 * see `lib/league/leaderboard.ts` for the DB read path that feeds this).
 *
 * STATISTICAL HONESTY (load-bearing, not a style choice): every row carries
 * its sample size `n` alongside `winRatePct`, and any row with
 * `n < LEADERBOARD_PROVISIONAL_THRESHOLD` is flagged `provisional`. The UI
 * must never render a win rate without also rendering `n` — a model that is
 * 1-for-1 is not "100%". See `components/league/Leaderboard.tsx`.
 *
 * SCOPE (what counts as a "graded" row here, structurally, not just by
 * convention):
 *   - `is_correct` must be non-null (unresolved/abstained rows carry no
 *     signal either way).
 *   - `league_tier !== 'scout'` — scout rows are scored on citation accuracy
 *     (a separate, deferred axis) and structurally never get a directional
 *     `is_correct` (see the prediction-ledger migration comment), so this is
 *     belt-and-suspenders on top of the `is_correct` filter, not a second
 *     independent rule.
 *   - the round's `item_type === 'ranked'` — `on_demand` rounds (one-off,
 *     user-triggered "generate live" runs) are explicitly excluded from
 *     league scoring by the schema's own `excluded_from_scoring` generated
 *     column; a leaderboard that let ad-hoc test rounds move a model's
 *     ranking would be exactly the kind of quiet integrity leak the schema
 *     comment warns about. Both filters are applied by the caller
 *     (`lib/league/leaderboard.ts`) at the query level — this module just
 *     assumes whatever rows it receives are already in-scope.
 */

export const LEADERBOARD_PROVISIONAL_THRESHOLD = 10

export type LeaderboardScope = 'model' | 'camp' | 'tier' | 'category'

/** One graded, in-scope prediction — the minimal shape this module needs. */
export type GradedPredictionRow = {
  model_id: string
  brand: string
  camp: string
  league_tier: string
  category: string
  is_correct: boolean
}

export type LeaderboardRow = {
  key: string
  label: string
  correct: number
  resolved: number
  /** Same as `resolved` — kept as its own field because the UI must always show it next to `winRatePct`, never derive it silently. */
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
  model: LeaderboardSlice
  camp: LeaderboardSlice
  tier: LeaderboardSlice
  category: LeaderboardSlice
  /** Total in-scope graded rows considered, before slicing — same across every slice's totalResolved. */
  totalConsidered: number
  generatedAt: string
}

/** Mirrors `CardHeader.tsx`'s `formatCategory` — category is a technical/data label, not translated chrome (see i18n dictionary.ts scoping note). Duplicated here (not imported) to keep this module dependency-free from the component tree. */
function formatCategory(category: string): string {
  return category.replace(/_/g, ' ')
}

function bucketOf(row: GradedPredictionRow, scope: LeaderboardScope): { key: string; label: string } {
  switch (scope) {
    case 'model':
      return { key: row.model_id, label: row.brand }
    case 'camp':
      return { key: row.camp, label: CAMP_LABEL[row.camp as Camp] ?? row.camp }
    case 'tier':
      return { key: row.league_tier, label: TIER_LABEL[row.league_tier as LeagueTier] ?? row.league_tier }
    case 'category':
      return { key: row.category, label: formatCategory(row.category) }
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

/** Defensive, structural exclusion of scout rows — see the module doc: scout is scored on citation accuracy, never has a real directional `is_correct`, so it must never enter ANY slice's win rate, not just the 'tier' one. The DB read path (`leaderboard.ts`) already filters this at the query level; this is the belt to that suspenders, applied once so every scope benefits. */
function excludeScout(rows: readonly GradedPredictionRow[]): GradedPredictionRow[] {
  return rows.filter((r) => r.league_tier !== 'scout')
}

/** Builds one slice (e.g. per-model) from the full graded-row set. Only keys that actually appear in `rows` are included — a tier/camp/category with zero graded rows simply does not appear (the UI's empty state handles the case where a whole slice is empty). */
export function buildLeaderboardSlice(rows: readonly GradedPredictionRow[], scope: LeaderboardScope): LeaderboardSlice {
  const inScope = excludeScout(rows)
  const buckets = new Map<string, { label: string; correct: number; resolved: number }>()
  for (const row of inScope) {
    const { key, label } = bucketOf(row, scope)
    const bucket = buckets.get(key) ?? { label, correct: 0, resolved: 0 }
    bucket.resolved += 1
    if (row.is_correct) bucket.correct += 1
    buckets.set(key, bucket)
  }

  const built: LeaderboardRow[] = Array.from(buckets.entries()).map(([key, b]) => ({
    key,
    label: b.label,
    correct: b.correct,
    resolved: b.resolved,
    n: b.resolved,
    winRatePct: b.resolved > 0 ? Math.round((b.correct / b.resolved) * 1000) / 10 : null,
    provisional: b.resolved < LEADERBOARD_PROVISIONAL_THRESHOLD,
  }))

  return { scope, rows: sortRows(built), totalResolved: inScope.length }
}

/** Single entry point: one pass over the already-filtered graded rows, four slices. Compute happens here (server-side) — the client only ever renders the result. */
export function buildLeaderboardData(rows: readonly GradedPredictionRow[]): LeaderboardData {
  return {
    model: buildLeaderboardSlice(rows, 'model'),
    camp: buildLeaderboardSlice(rows, 'camp'),
    tier: buildLeaderboardSlice(rows, 'tier'),
    category: buildLeaderboardSlice(rows, 'category'),
    totalConsidered: excludeScout(rows).length,
    generatedAt: new Date().toISOString(),
  }
}
