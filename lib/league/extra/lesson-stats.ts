/**
 * Program-computed lesson stats. The LLM only phrases these numbers.
 * Voided rounds and legacy same-day windows never enter the sample.
 */

import { firstOutcomeToken } from '../consensus-snapshot'
import { isExtraSeatId, type ExtraSeatId } from './seats'

export const LESSON_EXTRA_IDS = ['crow', 'consensus', 'history', 'sentiment', 'divination', 'replay'] as const

export const LEGACY_SAME_DAY_REASON = 'legacy_same_day_window'

export type LessonHit = { hits: number; n: number }

export type LessonWrongRound = {
  instrument: string
  date: string
  majoritySide: string | null
  actual: string | null
}

export type LessonStats = {
  n: number
  outcomeFrequencies: Record<string, number>
  aiOverall: LessonHit
  byConfidenceBand: { '50-59': LessonHit; '60-69': LessonHit; '70+': LessonHit }
  byMajorityShare: { gte85: LessonHit; band70: LessonHit; lt70: LessonHit }
  disagreement: { n: number; majorityRight: number; aggregateRight: number }
  extras: Record<(typeof LESSON_EXTRA_IDS)[number], LessonHit>
  replay: LessonHit
  last5Wrong: LessonWrongRound[]
}

export type LessonSourceRound = {
  category: string
  horizon: string
  instrument: string
  openedAt: string
  gradingStatus: string
  unresolvableReason: string | null
  actualOutcome: string | null
  consensusIsCorrect: boolean | null
  majorityDirection: string | null
  aggregateDirection: string | null
  aggregateProbability: number | null
  /** Official seats on the majority side / official seats with a side, 0–100. */
  majoritySharePct: number | null
  extras: Partial<Record<ExtraSeatId, boolean | null>>
}

export function isExcludedLessonRound(round: Pick<LessonSourceRound, 'gradingStatus' | 'unresolvableReason'>): boolean {
  if (round.gradingStatus === 'voided') return true
  if (round.unresolvableReason === LEGACY_SAME_DAY_REASON) return true
  return false
}

function emptyHit(): LessonHit {
  return { hits: 0, n: 0 }
}

function bump(hit: LessonHit, correct: boolean) {
  hit.n += 1
  if (correct) hit.hits += 1
}

function confidenceBand(p: number | null): '50-59' | '60-69' | '70+' | null {
  if (p == null || !Number.isFinite(p)) return null
  if (p >= 70) return '70+'
  if (p >= 60) return '60-69'
  if (p >= 50) return '50-59'
  return null
}

function shareBand(pct: number | null): 'gte85' | 'band70' | 'lt70' | null {
  if (pct == null || !Number.isFinite(pct)) return null
  if (pct >= 85) return 'gte85'
  if (pct >= 70) return 'band70'
  return 'lt70'
}

function actualToken(raw: string | null): string | null {
  return firstOutcomeToken(raw) ?? (raw?.trim() ? raw.trim() : null)
}

export function emptyLessonStats(): LessonStats {
  return {
    n: 0,
    outcomeFrequencies: {},
    aiOverall: emptyHit(),
    byConfidenceBand: { '50-59': emptyHit(), '60-69': emptyHit(), '70+': emptyHit() },
    byMajorityShare: { gte85: emptyHit(), band70: emptyHit(), lt70: emptyHit() },
    disagreement: { n: 0, majorityRight: 0, aggregateRight: 0 },
    extras: {
      crow: emptyHit(),
      consensus: emptyHit(),
      history: emptyHit(),
      sentiment: emptyHit(),
      divination: emptyHit(),
      replay: emptyHit(),
    },
    replay: emptyHit(),
    last5Wrong: [],
  }
}

export function computeLessonStats(rounds: readonly LessonSourceRound[]): LessonStats {
  const stats = emptyLessonStats()
  const wrong: { openedAt: string; row: LessonWrongRound }[] = []
  for (const round of rounds) {
    if (isExcludedLessonRound(round)) continue
    if (round.gradingStatus !== 'graded') continue
    stats.n += 1
    const actual = actualToken(round.actualOutcome)
    if (actual) stats.outcomeFrequencies[actual] = (stats.outcomeFrequencies[actual] ?? 0) + 1
    if (round.consensusIsCorrect != null) {
      bump(stats.aiOverall, round.consensusIsCorrect)
      const band = confidenceBand(round.aggregateProbability)
      if (band) bump(stats.byConfidenceBand[band], round.consensusIsCorrect)
      const share = shareBand(round.majoritySharePct)
      if (share) bump(stats.byMajorityShare[share], round.consensusIsCorrect)
      if (round.consensusIsCorrect === false) {
        wrong.push({
          openedAt: round.openedAt,
          row: {
            instrument: round.instrument,
            date: round.openedAt.slice(0, 10),
            majoritySide: round.majorityDirection,
            actual,
          },
        })
      }
    }
    const maj = round.majorityDirection?.trim().toLowerCase()
    const agg = round.aggregateDirection?.trim().toLowerCase()
    if (maj && agg && maj !== agg && actual) {
      stats.disagreement.n += 1
      if (maj === actual.toLowerCase()) stats.disagreement.majorityRight += 1
      if (agg === actual.toLowerCase()) stats.disagreement.aggregateRight += 1
    }
    for (const id of LESSON_EXTRA_IDS) {
      const correct = round.extras[id]
      if (correct == null) continue
      bump(stats.extras[id], correct)
      if (id === 'replay') bump(stats.replay, correct)
    }
  }
  wrong.sort((a, b) => b.openedAt.localeCompare(a.openedAt))
  stats.last5Wrong = wrong.slice(0, 5).map((row) => row.row)
  return stats
}

export function lessonNumbers(stats: LessonStats): Set<string> {
  const found = new Set<string>()
  const walk = (value: unknown) => {
    if (typeof value === 'number' && Number.isFinite(value)) {
      found.add(String(value))
      if (Number.isInteger(value)) found.add(String(value))
      else found.add(String(Math.round(value * 10) / 10))
    } else if (Array.isArray(value)) value.forEach(walk)
    else if (value && typeof value === 'object') Object.values(value).forEach(walk)
  }
  walk(stats)
  return found
}

/** Every numeric token in the note must be a number the program computed. */
export function noteNumbersAreGrounded(note: string, stats: LessonStats): boolean {
  const allowed = lessonNumbers(stats)
  const tokens = note.match(/\d+(?:\.\d+)?/g) ?? []
  return tokens.every((token) => allowed.has(token) || allowed.has(String(Number(token))))
}

/** First grounded draft wins. One retry, then the stats-only template. n < 3 never leaves the template. */
export function resolvePhrasedNote(
  stats: LessonStats,
  attempts: readonly ({ ko: string; en: string } | null)[],
): { ko: string; en: string } {
  const fallback = {
    ko: lessonNoteTemplate(stats, 'ko'),
    en: lessonNoteTemplate(stats, 'en'),
  }
  if (stats.n < 3) return fallback
  const grounded = attempts.slice(0, 2).find(
    (text) => text && noteNumbersAreGrounded(text.ko, stats) && noteNumbersAreGrounded(text.en, stats),
  )
  return grounded ?? fallback
}

function sampleLine(n: number, body: string): string | null {
  if (n < 3) return null
  if (n < 5) return `참고(표본 ${n}) ${body}`
  return body
}

export function lessonNoteTemplate(stats: LessonStats, locale: 'ko' | 'en'): string {
  const lines: string[] = []
  const nLine =
    locale === 'ko'
      ? sampleLine(stats.n, `채점 ${stats.n}라운드. AI 종합 적중 ${stats.aiOverall.hits}/${stats.aiOverall.n}.`)
      : sampleLine(stats.n, `Graded rounds ${stats.n}. AI ensemble hits ${stats.aiOverall.hits}/${stats.aiOverall.n}.`)
  if (nLine) lines.push(nLine)
  const replay =
    locale === 'ko'
      ? sampleLine(stats.replay.n, `복기 적중 ${stats.replay.hits}/${stats.replay.n}.`)
      : sampleLine(stats.replay.n, `Review hits ${stats.replay.hits}/${stats.replay.n}.`)
  if (replay) lines.push(replay)
  const disagree =
    locale === 'ko'
      ? sampleLine(
          stats.disagreement.n,
          `다수와 종합이 갈린 경우 ${stats.disagreement.n}. 다수 맞음 ${stats.disagreement.majorityRight}. 종합 맞음 ${stats.disagreement.aggregateRight}.`,
        )
      : sampleLine(
          stats.disagreement.n,
          `Majority and aggregate disagreed ${stats.disagreement.n}. Majority right ${stats.disagreement.majorityRight}. Aggregate right ${stats.disagreement.aggregateRight}.`,
        )
  if (disagree) lines.push(disagree)
  return lines.join(' ')
}

export function extrasFromPredictionRows(
  rows: readonly { model_id?: string | null; is_correct?: boolean | null }[],
): Partial<Record<ExtraSeatId, boolean | null>> {
  const out: Partial<Record<ExtraSeatId, boolean | null>> = {}
  for (const row of rows) {
    if (!row.model_id || !isExtraSeatId(row.model_id)) continue
    if (row.is_correct == null) continue
    out[row.model_id] = row.is_correct
  }
  return out
}
