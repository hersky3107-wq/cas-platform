/**
 * Ballot-axis classification for a user question.
 *
 * Seer ballots stay on the wire enum advance/hold/release (compat already
 * proved the enum can be relabelled per scope). What changes is the MEANING
 * shown to the seer and on the result screen:
 *
 *   action     — 전진 / 유지 / 정리   ("어떻게 할까")
 *   prediction — 가깝다 / 조건부 / 멀다 ("될까", "언제")
 *   choice     — one bar per named option, not a 3-way axis
 *   none       — no question; keep the action axis
 *
 * Uncertain questions default to the action axis. That is an explicit
 * fallback, never a silent relabel onto 가깝다/조건부/멀다.
 */
import type { PhaseAxis } from './axes/types'

export const QUESTION_AXIS_KINDS = ['action', 'prediction', 'choice', 'none'] as const
export type QuestionAxisKind = (typeof QUESTION_AXIS_KINDS)[number]

export type QuestionClassification = {
  kind: QuestionAxisKind
  options: string[]
  confidence: 'certain' | 'defaulted'
  reason: string
}

export const ACTION_DIRECTION_LABELS: Record<PhaseAxis, string> = {
  advance: '전진',
  hold: '유지',
  release: '정리',
}

export const PREDICTION_DIRECTION_LABELS: Record<PhaseAxis, string> = {
  advance: '가깝다',
  hold: '조건부',
  release: '멀다',
}

export const PHASE_VOTE_VERBS: Record<PhaseAxis, string> = {
  advance: '나아가라고',
  hold: '유지하라고',
  release: '정리하라고',
}

const ACTION_RE =
  /어떻게|어떡|어찌|뭘 해야|무엇을 해야|어떻게 해야|방향을|should i|how (?:should|do|can|to)\b/i
const PREDICTION_RE =
  /언제|몇\s*년|몇\s*달|몇\s*개월|몇\s*주|몇\s*일|될까|될까요|될 수|올까|줄까|도와줄까|생길까|이룰까|이루어|will\b|when\b/i
const WILL_END_RE = /(?:을까|를까|일까|할까|나요|입니까)\s*[?？]?\s*$/
const CHOICE_SPLIT_RE = /을까|를까|일까|할까|이냐|냐|인가/

function cleanOption(value: string): string {
  return value.replace(/^[,\s·/]+|[,\s·/?？]+$/g, '').replace(/\s+/g, ' ').trim()
}

function uniqueOptions(values: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of values) {
    const value = cleanOption(raw)
    if (value.length < 1 || value.length > 24) continue
    const key = value.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(value)
  }
  return out
}

/**
 * Named options only when the question clearly lists two or more.
 * A single "할까" ("도와줄까", "어떻게 할까") is not a choice.
 */
export function extractChoiceOptions(question: string): string[] | null {
  const text = question.trim()
  if (!text) return null

  const nya = uniqueOptions([...text.matchAll(/([가-힣A-Za-z0-9]{1,20}?)(?:이|가)?냐/g)].map((m) => m[1]!))
  if (nya.length >= 2) return nya

  const vs = text.split(/\s+vs\.?\s+/i).map(cleanOption)
  if (vs.length >= 2 && vs.length <= 5 && vs.every((part) => part.length > 0 && part.length <= 20)) {
    return uniqueOptions(vs)
  }

  const slash = text.split(/\s*\/\s*/)
  if (
    slash.length >= 2 &&
    slash.length <= 5 &&
    slash.every((part) => /^[가-힣A-Za-z0-9]{1,16}$/.test(part.trim()))
  ) {
    return uniqueOptions(slash)
  }

  const orKo = text.split(/\s*아니면\s*/).map(cleanOption)
  if (orKo.length === 2 && orKo[0] && orKo[1] && orKo[0].length <= 20 && orKo[1].length <= 20) {
    return uniqueOptions(orKo)
  }

  const markers = text.match(new RegExp(CHOICE_SPLIT_RE.source, 'g')) ?? []
  if (markers.length >= 2) {
    const parts = uniqueOptions(text.split(CHOICE_SPLIT_RE))
    if (parts.length >= 2) return parts
  }

  return null
}

export function classifyOracleQuestion(question: string | null | undefined): QuestionClassification {
  const text = typeof question === 'string' ? question.trim() : ''
  if (!text) {
    return {
      kind: 'none',
      options: [],
      confidence: 'certain',
      reason: 'no question — keep the action axis',
    }
  }

  const options = extractChoiceOptions(text)
  if (options && options.length >= 2 && !ACTION_RE.test(text)) {
    return {
      kind: 'choice',
      options,
      confidence: 'certain',
      reason: `named options: ${options.join(' / ')}`,
    }
  }

  if (ACTION_RE.test(text)) {
    return {
      kind: 'action',
      options: [],
      confidence: 'certain',
      reason: 'action marker (어떻게 / should / 방향)',
    }
  }

  if (PREDICTION_RE.test(text) || WILL_END_RE.test(text)) {
    return {
      kind: 'prediction',
      options: [],
      confidence: 'certain',
      reason: 'prediction or timing marker (될까 / 언제 / 을까)',
    }
  }

  return {
    kind: 'action',
    options: [],
    confidence: 'defaulted',
    reason: 'uncertain — default to the action axis',
  }
}

/** Compat keeps relationship-motion labels regardless of the wording. */
export function classifyBallotAxis(
  kind: string | undefined,
  question: string | null | undefined,
): QuestionClassification {
  if (kind === 'compat') {
    return {
      kind: 'action',
      options: [],
      confidence: 'certain',
      reason: 'compat uses the relationship-motion axis',
    }
  }
  return classifyOracleQuestion(question)
}

export function questionFromPayload(payload: { context?: unknown }): string | null {
  const context = payload.context
  if (!context || typeof context !== 'object') return null
  const question = (context as { question?: unknown }).question
  return typeof question === 'string' && question.trim() ? question.trim() : null
}

export function classifyFromPayload(payload: { kind?: unknown; context?: unknown }): QuestionClassification {
  const kind = typeof payload.kind === 'string' ? payload.kind : undefined
  return classifyBallotAxis(kind, questionFromPayload(payload))
}

/** Labels for the seer ballot. `none` and defaulted questions use action words. */
export function ballotDirectionLabels(axis: QuestionClassification): Record<PhaseAxis, string> {
  return axis.kind === 'prediction' ? PREDICTION_DIRECTION_LABELS : ACTION_DIRECTION_LABELS
}

export function ballotDirectionLabel(axis: QuestionClassification, direction: PhaseAxis): string {
  return ballotDirectionLabels(axis)[direction]
}

/** Projector phase line — one format, never a quoted one_line. */
export function formatOppositionVoteLine(
  nameA: string,
  dirA: PhaseAxis,
  nameB: string,
  dirB: PhaseAxis,
): string {
  return `${nameA}는 ${PHASE_VOTE_VERBS[dirA]} 하고, ${nameB}는 ${PHASE_VOTE_VERBS[dirB]} 합니다.`
}

export function matchChoiceOption(raw: string, options: readonly string[]): string | null {
  const needle = raw.trim().toLowerCase()
  if (!needle) return null
  const exact = options.find((option) => option.toLowerCase() === needle)
  if (exact) return exact
  const contained = options.find(
    (option) => option.toLowerCase().includes(needle) || needle.includes(option.toLowerCase()),
  )
  return contained ?? null
}

export function classificationJson(axis: QuestionClassification): Record<string, unknown> {
  return {
    kind: axis.kind,
    options: axis.options,
    confidence: axis.confidence,
    reason: axis.reason,
  }
}

export function parseClassification(raw: unknown): QuestionClassification | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const record = raw as Record<string, unknown>
  if (typeof record.kind !== 'string' || !(QUESTION_AXIS_KINDS as readonly string[]).includes(record.kind)) {
    return null
  }
  const options = Array.isArray(record.options)
    ? record.options.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    : []
  return {
    kind: record.kind as QuestionAxisKind,
    options,
    confidence: record.confidence === 'defaulted' ? 'defaulted' : 'certain',
    reason: typeof record.reason === 'string' ? record.reason : '',
  }
}
