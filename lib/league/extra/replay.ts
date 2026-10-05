/**
 * Extra replay seat — 🧠 복기.
 *
 * Sees the shared closed-book packet, program-computed lesson notes, and its
 * own last graded calls. Never the current round's other seat outputs.
 * Ledger model_id stays `replay`. Engine is first-party Claude Opus 5.5.
 */

import { parsePrediction, sanitizeRationale } from '../prediction-parse'
import { normalizeChosenSideProbability } from '../probability-normalize'
import type { AnswerSide } from '../answer-contract'
import { leagueSideFromDivination } from './divination'

export const REPLAY_ENGINE_LABEL = 'Claude Opus 5.5'
export const REPLAY_MODEL_OVERRIDE = 'claude-opus-5-5'
export const REPLAY_TIMEOUT_MS = 150_000
export const REPLAY_MAX_COMPLETION_TOKENS = 1200
export const APPLIED_LESSON_MAX_WORDS = 25

export const REPLAY_INPUT_KEYS = [
  'proposition',
  'instrument',
  'horizon',
  'category',
  'subjectName',
  'propositionKind',
  'packet',
  'categoryNote',
  'globalNote',
  'ownHistory',
] as const

export const REPLAY_BANNED_KEYS = [
  'otherSeats',
  'seatOutputs',
  'models',
  'crow',
  'divination',
  'sentiment',
  'history',
  'consensus',
] as const

export type ReplayHistoryRow = {
  proposition: string
  side: string
  correct: boolean
  date: string
}

export type ReplayLeagueInput = {
  proposition: string
  instrument: string
  horizon: string
  category: string
  subjectName: string
  propositionKind: string | null
  packet: string | null
  categoryNote: string | null
  globalNote: string | null
  ownHistory: ReplayHistoryRow[]
}

export type ReplayEngineOutput = {
  verdict: 'up' | 'down'
  rationale: string
  confidence: number | null
  appliedLesson: string | null
  probabilityFlipped: boolean
}

export function clipAppliedLesson(raw: string | null | undefined): string | null {
  if (!raw) return null
  const trimmed = raw.trim()
  if (!trimmed) return null
  const words = trimmed.split(/\s+/).filter(Boolean).slice(0, APPLIED_LESSON_MAX_WORDS)
  const clipped = words.join(' ')
  return clipped.length > 0 ? clipped : null
}

export function assertReplayInputShape(input: object): asserts input is ReplayLeagueInput {
  const record = input as Record<string, unknown>
  for (const banned of REPLAY_BANNED_KEYS) {
    if (Object.prototype.hasOwnProperty.call(record, banned) && record[banned] != null) {
      throw new Error(`replay seat must not receive ${banned}`)
    }
  }
  for (const key of Object.keys(record)) {
    if (!(REPLAY_INPUT_KEYS as readonly string[]).includes(key)) {
      throw new Error(`replay input forbids extra key "${key}"`)
    }
  }
}

export function buildReplaySystemPrompt(brandTable: boolean): string {
  const answer = brandTable
    ? '{"pick":"<candidate>","probability":50-100,"rationale":"...","applied_lesson":"..."}'
    : '{"direction":"up"|"down","probability":50-100,"rationale":"...","applied_lesson":"..."}'
  return [
    'You are 복기, the review seat. You forecast from lessons the program computed on this league\'s own graded history.',
    'You answer ALONE. You do not see any other seat\'s answer on this round.',
    'Use a lesson only when its sample size supports it. Lines marked 참고(표본 n) are thin. Omit anything the note left out.',
    'Never be contrarian for its own sake. Never name another seat in this round.',
    'applied_lesson is required: the one lesson you applied, 25 words or fewer. If no lesson applies, write "적용한 교훈 없음".',
    '',
    'Last line MUST be JSON:',
    answer,
    'probability is confidence that YOUR chosen side happens (50–100), not P(the other side).',
    brandTable ? 'pick must be one of the listed candidates — your #1 brand.' : 'direction up = the affirmative side. direction down = the other.',
  ].join('\n')
}

export function buildReplayUserPrompt(input: ReplayLeagueInput): string {
  assertReplayInputShape(input)
  const history =
    input.ownHistory.length === 0
      ? '(no graded review-seat history yet)'
      : input.ownHistory
          .map((row) => `${row.date} ${row.correct ? 'hit' : 'miss'} ${row.side}: ${row.proposition}`)
          .join('\n')
  return [
    `PROPOSITION: ${input.proposition}`,
    `SUBJECT: ${input.subjectName}`,
    `INSTRUMENT: ${input.instrument}`,
    `HORIZON: ${input.horizon}`,
    `CATEGORY: ${input.category}`,
    '',
    'CLOSED-BOOK PACKET:',
    input.packet?.trim() || '(packet unavailable)',
    '',
    'CATEGORY × HORIZON LESSON:',
    input.categoryNote?.trim() || '(no lesson note yet)',
    '',
    'GLOBAL LESSON:',
    input.globalNote?.trim() || '(no global note yet)',
    '',
    'YOUR LAST GRADED CALLS (review seat only):',
    history,
  ].join('\n')
}

function appliedFromObject(obj: Record<string, unknown> | null): string | null {
  if (!obj) return null
  const raw = obj.applied_lesson ?? obj.appliedLesson
  return typeof raw === 'string' ? clipAppliedLesson(raw) : null
}

function lastJson(text: string): Record<string, unknown> | null {
  const opens: number[] = []
  for (let i = 0; i < text.length; i++) if (text[i] === '{') opens.push(i)
  for (let c = opens.length - 1; c >= 0; c--) {
    const start = opens[c]!
    let depth = 0
    let inString = false
    let escaped = false
    for (let i = start; i < text.length; i++) {
      const ch = text[i]
      if (inString) {
        if (escaped) escaped = false
        else if (ch === '\\') escaped = true
        else if (ch === '"') inString = false
        continue
      }
      if (ch === '"') inString = true
      else if (ch === '{') depth++
      else if (ch === '}') {
        depth--
        if (depth === 0) {
          try {
            return JSON.parse(text.slice(start, i + 1)) as Record<string, unknown>
          } catch {
            break
          }
        }
      }
    }
  }
  return null
}

export function appliedLessonFromText(text: string | null): string | null {
  return appliedFromObject(text ? lastJson(text) : null)
}

export function parseReplayOutput(text: string | null): ReplayEngineOutput | null {
  const parsed = parsePrediction(text)
  if (!parsed?.direction) return null
  const rationale = (parsed.rationale ?? sanitizeRationale(text) ?? '').slice(0, 500).trim()
  if (!rationale) return null
  return {
    verdict: parsed.direction,
    rationale,
    confidence: parsed.probability,
    appliedLesson: appliedFromObject(text ? lastJson(text) : null),
    probabilityFlipped: Boolean(parsed.probabilityFlipped),
  }
}

export function leagueSideFromReplay(verdict: 'up' | 'down', propositionKind: string | null | undefined): AnswerSide {
  return leagueSideFromDivination(verdict, null, propositionKind)
}

export function normalizePickProbability(raw: number): { probability: number; probabilityFlipped: boolean } {
  const normalized = normalizeChosenSideProbability(raw)
  return { probability: normalized.probability ?? 50, probabilityFlipped: normalized.probabilityFlipped }
}
