import {
  CAMP_LABEL,
  CAMPS,
  LEAGUE_TIERS,
  TIER_LABEL,
  emptyCombinedTrack,
  type Camp,
  type CombinedMethodTrack,
  type LeagueTier,
} from './card-types'
import { LEAGUE_ROSTER } from './roster'
import { buildBaselineSummary, emptyBaselineSummary, type BaselineSummary } from './baselines'
import { toSideToken } from './side-labels'
import { isDisplayableWinRate, winRatePctForDisplay, WIN_RATE_MIN_SAMPLE } from './win-rate'

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
 * STATISTICAL HONESTY IS ENFORCED IN THE DATA, NOT IN THE UI. A row with fewer
 * than `LEADERBOARD_MIN_SAMPLE` graded rounds gets `winRatePct: null` AND
 * `rank: null` — the percentage does not exist in the payload, so no component,
 * embed or API consumer can render "100%" off one graded round, and no ordinal
 * position can be derived from it either. Rows that do carry a percentage carry
 * `n` next to it, and the percentage is TRUNCATED, never rounded up (see
 * `./win-rate.ts`).
 *
 * SORT ORDER: ranked rows first, by win rate; below-threshold rows after them in
 * a deliberately NON-PERFORMANCE order (roster order for models, tier order for
 * tiers, camp order for camps, else alphabetical) so their position says nothing
 * about who is winning.
 *
 * SCOPE of a "graded" row (applied by the caller at query time):
 *   - `is_correct` is non-null
 *
 * Creation mode (`item_type`) is provenance only — both `ranked` and
 * `on_demand` rounds that graded under the standard contract count.
 */

/** Minimum graded rounds before a percentage or a rank exists. One number, from `lib/league/credits.ts`. */
export const LEADERBOARD_MIN_SAMPLE = WIN_RATE_MIN_SAMPLE

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
  /**
   * The round's own side token (up/down/yes/no/above/below), legacy 'flat',
   * or null. Win rates read `is_correct` alone — this field only feeds the
   * combined-method majority vote (token-generic) and the baselines (which
   * deliberately recover outcomes from up/down rows only — price scope).
   */
  predicted_direction: string | null
}

export type LeaderboardRow = {
  key: string
  label: string
  correct: number
  resolved: number
  /** Same as `resolved` — kept as its own field because the UI must always show it next to `winRatePct`. */
  n: number
  /**
   * The displayable win rate, TRUNCATED to one decimal, or null when
   * `n < LEADERBOARD_MIN_SAMPLE`. Null is not "unknown": it means a percentage
   * must not be shown for this row, and there is no other field to compute one
   * from (`correct`/`resolved` are there for the raw record, which is what the
   * UI shows instead).
   */
  winRatePct: number | null
  /** Position among rows that qualify for a rate; null for below-threshold rows, which are unranked. */
  rank: number | null
  /** true when `n < LEADERBOARD_MIN_SAMPLE` (equivalently: `winRatePct === null`). */
  provisional: boolean
}

export type LeaderboardSlice = {
  scope: LeaderboardScope
  rows: LeaderboardRow[]
  /** Total graded rows that fed this slice (== sum of each row's `resolved`). */
  totalResolved: number
  /** How many rows have a rank. 0 means this whole slice is presented unranked. */
  rankedRows: number
}

/**
 * HOW MANY ROUNDS ARE BEHIND THESE WIN RATES — and how many are not. Only
 * `graded` rounds contribute to any denominator above; the other three counts
 * exist so an ungraded round is DISCLOSED rather than quietly dropped, which is
 * the difference between "we have graded 12 of 14 rounds" and a leaderboard that
 * silently omits the two it could not grade.
 *
 * See `lib/prediction/grading-state.ts` for the state definitions. Rounds being
 * graded right now count as `dueUngraded` (they are in flight, not a result).
 */
export type RoundCoverage = {
  graded: number
  /** Due, ungraded, and refused with a recorded reason (missing anchor, tie, no session…). */
  unresolvable: number
  /** Due and ungraded: grading has not run (or is running) for these yet. */
  dueUngraded: number
  notDue: number
}

export function emptyRoundCoverage(): RoundCoverage {
  return { graded: 0, unresolvable: 0, dueUngraded: 0, notDue: 0 }
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
  /**
   * Reference strategies (Always up, Coin flip). Not ranked. Computed from the
   * same graded rounds as `model` — see `./baselines.ts`.
   */
  baselines: BaselineSummary
  /** Total in-scope graded rows considered. */
  totalConsidered: number
  /**
   * Graded rounds required before a row shows a percentage or gets a rank.
   * Carried in the payload so a consumer (UI, blog embed, API client) states the
   * same number the gate used instead of hard-coding its own.
   */
  minSample: number
  /** Round-level accounting: what these win rates were computed from, and what they could not be. */
  roundCoverage: RoundCoverage
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

const ROSTER_ORDER = new Map(LEAGUE_ROSTER.map((entry, index) => [entry.model_id, index]))

/**
 * Position of an UNRANKED row. Deliberately unrelated to performance: roster
 * order for models, the league's own tier/camp order for those slices, and
 * alphabetical everywhere else. A reader must not be able to infer a ranking
 * from where a low-sample row sits.
 */
function unrankedOrderOf(row: LeaderboardRow, scope: LeaderboardScope): number {
  if (scope === 'model') return ROSTER_ORDER.get(row.key) ?? Number.MAX_SAFE_INTEGER
  if (scope === 'tier') {
    const index = LEAGUE_TIERS.indexOf(row.key as LeagueTier)
    return index === -1 ? Number.MAX_SAFE_INTEGER : index
  }
  if (scope === 'camp' || scope === 'campHeadline') {
    const index = CAMPS.indexOf(row.key as Camp)
    return index === -1 ? Number.MAX_SAFE_INTEGER : index
  }
  return Number.MAX_SAFE_INTEGER
}

/**
 * Ranked rows first (by rate, then sample size), then the unranked ones. Only
 * the ranked block gets rank numbers — that is what keeps a 1-round row from
 * appearing to be "in first place".
 */
function orderAndRank(rows: LeaderboardRow[], scope: LeaderboardScope): LeaderboardRow[] {
  const ranked = rows
    .filter((row) => row.winRatePct !== null)
    .sort((a, b) => {
      if (b.winRatePct !== a.winRatePct) return (b.winRatePct ?? 0) - (a.winRatePct ?? 0)
      if (b.resolved !== a.resolved) return b.resolved - a.resolved
      return a.key.localeCompare(b.key)
    })
    .map((row, index) => ({ ...row, rank: index + 1 }))

  const unranked = rows
    .filter((row) => row.winRatePct === null)
    .sort((a, b) => {
      const oa = unrankedOrderOf(a, scope)
      const ob = unrankedOrderOf(b, scope)
      if (oa !== ob) return oa - ob
      return a.label.localeCompare(b.label) || a.key.localeCompare(b.key)
    })

  return [...ranked, ...unranked]
}

function toRow(key: string, b: { label: string; correct: number; resolved: number }): LeaderboardRow {
  return {
    key,
    label: b.label,
    correct: b.correct,
    resolved: b.resolved,
    n: b.resolved,
    winRatePct: winRatePctForDisplay(b.correct, b.resolved),
    rank: null,
    provisional: !isDisplayableWinRate(b.resolved),
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

  const ordered = orderAndRank(
    Array.from(buckets.entries()).map(([key, b]) => toRow(key, b)),
    scope
  )

  return {
    scope,
    rows: ordered,
    totalResolved: considered,
    rankedRows: ordered.filter((row) => row.rank !== null).length,
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
    // Token-generic majority: a round's rows only ever carry its own side
    // pair (up/down, yes/no, above/below — plus the one legacy 'flat'), so
    // counting distinct stored tokens IS the majority vote under any
    // contract. Byte-identical outcome for price rounds.
    const tally = new Map<string, number>()
    for (const row of group) {
      const side = toSideToken(row.predicted_direction)
      if (side === null) continue
      tally.set(side, (tally.get(side) ?? 0) + 1)
    }
    let topDir: string | null = null
    let topCount = 0
    let tied = false
    for (const [side, count] of tally) {
      if (count > topCount) {
        topDir = side
        topCount = count
        tied = false
      } else if (count === topCount) {
        tied = true
      }
    }
    if (topCount === 0 || tied || topDir === null) continue

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
    // Same gate as every other surface: the combined method does not get to
    // advertise "100% accuracy" off its first resolved round either.
    winRatePct: winRatePctForDisplay(correct, resolved),
    provisional: !isDisplayableWinRate(resolved),
  }
}

/**
 * Single entry point: one pass over already-filtered graded rows, all slices.
 * `coverage` is round-level accounting from the caller (the DB read path);
 * omitting it yields zeros, never a guess derived from the graded rows.
 */
export function buildLeaderboardData(
  rows: readonly GradedPredictionRow[],
  coverage: RoundCoverage = emptyRoundCoverage()
): LeaderboardData {
  const model = buildLeaderboardSlice(rows, 'model')
  return {
    model,
    campHeadline: buildLeaderboardSlice(rows, 'campHeadline'),
    method: buildLeaderboardSlice(rows, 'method'),
    camp: buildLeaderboardSlice(rows, 'camp'),
    tier: buildLeaderboardSlice(rows, 'tier'),
    brand: buildLeaderboardSlice(rows, 'brand'),
    category: buildLeaderboardSlice(rows, 'category'),
    korea: buildLeaderboardSlice(rows, 'korea'),
    combined: buildCombinedMethodTrack(rows),
    baselines: rows.length === 0 ? emptyBaselineSummary() : buildBaselineSummary(rows),
    totalConsidered: rows.length,
    minSample: LEADERBOARD_MIN_SAMPLE,
    roundCoverage: coverage,
    generatedAt: new Date().toISOString(),
  }
}

