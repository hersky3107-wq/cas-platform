import { isDisplayableWinRate, winRatePctForDisplay } from './win-rate'

/** The only fields Always up needs — already-graded direction + verdict. */
export type GradedDirectionRow = {
  model_id: string
  round_id: string
  is_correct: boolean
  predicted_direction: 'up' | 'down' | 'flat' | null
}

/**
 * AI Prediction League — REFERENCE BASELINES (pure).
 *
 * A model win rate is unreadable without a comparison that requires no skill.
 * These two are that comparison. They are NOT league participants, they are
 * never ranked, and they reuse the SAME graded rounds the models already have
 * — no second scoring path, no invented outcomes. Creation mode (ranked vs
 * on_demand) is provenance only; any round graded under the standard contract
 * enters this baseline.
 *
 *   always_up  Predicts "up" on every round. Graded by inverting the model's
 *              already-persisted (direction, is_correct) pair back to the
 *              actual outcome, then asking "was that up?". One number per
 *              round, never hardcoded.
 *
 *   coin_flip  The expected 50% line. A MARKER, not a simulated participant:
 *              no random seed, no coin toss per page load. A random baseline
 *              that moved between views would not be a baseline.
 *
 * Both obey the minimum-sample gate: below the threshold there is no
 * percentage in this payload.
 */

export const COIN_FLIP_EXPECTED_PCT = 50

export type BaselineKey = 'always_up' | 'coin_flip'

export type BaselineRole = 'scored' | 'marker'

export type BaselineRow = {
  key: BaselineKey
  role: BaselineRole
  correct: number
  resolved: number
  n: number
  winRatePct: number | null
  provisional: boolean
  /** Always null — baselines are not ranked as league participants. */
  rank: null
}

export type BaselineSummary = {
  alwaysUp: BaselineRow
  coinFlip: BaselineRow
  /**
   * How many MODEL rows (not baselines) have a strictly higher hit ratio than
   * Always up, compared as integers (`correct * other.n`) so truncation cannot
   * hide or invent a beat. This count is the product's honest headline.
   */
  modelsBeatingAlwaysUp: number
  /** Models with at least one graded round — the denominator of that headline. */
  modelsCompared: number
}

/**
 * Recover the round's actual up/down from a row that was already graded.
 * `is_correct` was written by the shared grading path; this does not re-judge.
 */
export function actualDirectionFromGraded(row: GradedDirectionRow): 'up' | 'down' | null {
  if (row.predicted_direction !== 'up' && row.predicted_direction !== 'down') return null
  if (row.predicted_direction === 'up') return row.is_correct ? 'up' : 'down'
  return row.is_correct ? 'down' : 'up'
}

/**
 * One actual direction per graded round. A round whose graded rows disagree
 * about the actual (should be impossible) is dropped rather than guessed —
 * an uncounted round is better than a wrong baseline.
 */
export function actualDirectionsByRound(rows: readonly GradedDirectionRow[]): Map<string, 'up' | 'down'> {
  const seen = new Map<string, 'up' | 'down' | 'conflict'>()
  for (const row of rows) {
    const actual = actualDirectionFromGraded(row)
    if (!actual) continue
    const existing = seen.get(row.round_id)
    if (existing === undefined) {
      seen.set(row.round_id, actual)
      continue
    }
    if (existing !== actual) seen.set(row.round_id, 'conflict')
  }

  const out = new Map<string, 'up' | 'down'>()
  for (const [roundId, actual] of seen) {
    if (actual !== 'conflict') out.set(roundId, actual)
  }
  return out
}

export function alwaysUpRecordOf(rows: readonly GradedDirectionRow[]): { correct: number; resolved: number } {
  const byRound = actualDirectionsByRound(rows)
  let correct = 0
  for (const actual of byRound.values()) {
    if (actual === 'up') correct += 1
  }
  return { correct, resolved: byRound.size }
}

function toScoredBaseline(key: BaselineKey, record: { correct: number; resolved: number }): BaselineRow {
  return {
    key,
    role: 'scored',
    correct: record.correct,
    resolved: record.resolved,
    n: record.resolved,
    winRatePct: winRatePctForDisplay(record.correct, record.resolved),
    provisional: !isDisplayableWinRate(record.resolved),
    rank: null,
  }
}

function coinFlipMarker(resolved: number): BaselineRow {
  return {
    key: 'coin_flip',
    role: 'marker',
    // No simulated wins — a marker has a line, not a record.
    correct: 0,
    resolved,
    n: resolved,
    winRatePct: isDisplayableWinRate(resolved) ? COIN_FLIP_EXPECTED_PCT : null,
    provisional: !isDisplayableWinRate(resolved),
    rank: null,
  }
}

/** Strict ratio compare without floats: a/b > c/d iff a*d > c*b (non-negative). */
export function beatsRecord(
  a: { correct: number; resolved: number },
  b: { correct: number; resolved: number }
): boolean {
  if (a.resolved <= 0 || b.resolved <= 0) return false
  return a.correct * b.resolved > b.correct * a.resolved
}

export function emptyBaselineSummary(): BaselineSummary {
  return {
    alwaysUp: toScoredBaseline('always_up', { correct: 0, resolved: 0 }),
    coinFlip: coinFlipMarker(0),
    modelsBeatingAlwaysUp: 0,
    modelsCompared: 0,
  }
}

/**
 * Baselines + the beating headline, from the same graded rows the model
 * leaderboard already consumed. No second scoring path.
 */
/**
 * Per-model Always-up comparison on the rounds THAT model was graded on.
 * Sitting out a round does not invent a beat: Always up is scored on the same
 * subset, not on a different denominator.
 */
function modelRecordsAgainstAlwaysUp(
  rows: readonly GradedDirectionRow[],
  actualByRound: Map<string, 'up' | 'down'>
): { correct: number; alwaysUpCorrect: number; resolved: number }[] {
  const byModel = new Map<string, { correct: number; alwaysUpCorrect: number; resolved: number }>()
  for (const row of rows) {
    const actual = actualByRound.get(row.round_id)
    if (!actual) continue
    const bucket = byModel.get(row.model_id) ?? { correct: 0, alwaysUpCorrect: 0, resolved: 0 }
    bucket.resolved += 1
    if (row.is_correct) bucket.correct += 1
    if (actual === 'up') bucket.alwaysUpCorrect += 1
    byModel.set(row.model_id, bucket)
  }
  return [...byModel.values()]
}

export function buildBaselineSummary(rows: readonly GradedDirectionRow[]): BaselineSummary {
  const actualByRound = actualDirectionsByRound(rows)
  let alwaysUpCorrect = 0
  for (const actual of actualByRound.values()) {
    if (actual === 'up') alwaysUpCorrect += 1
  }
  const alwaysUp = toScoredBaseline('always_up', { correct: alwaysUpCorrect, resolved: actualByRound.size })
  const comparable = modelRecordsAgainstAlwaysUp(rows, actualByRound).filter((row) => row.resolved > 0)
  return {
    alwaysUp,
    coinFlip: coinFlipMarker(alwaysUp.resolved),
    modelsBeatingAlwaysUp: comparable.filter((row) => row.correct > row.alwaysUpCorrect).length,
    modelsCompared: comparable.length,
  }
}
