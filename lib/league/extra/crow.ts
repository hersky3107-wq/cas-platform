/**
 * Extra crow seat — 🐦‍⬛ 까마귀.
 *
 * Knows the measured baseline (sports book, or the price path on finance)
 * and weighs the risk the crowd skips: underdog residual and single-game
 * variance, or a steep run's mean-reversion. Not contrarian for its own sake.
 * Often wrong. Sometimes right. That lower hit rate is the seat's identity.
 *
 * Engine: first-party Mistral Medium 3.5 (no hidden reasoning, fast).
 * Ledger model_id stays `crow`. All ledger categories.
 */
import type { AnswerSide } from '../answer-contract'
import { parsePrediction, sanitizeRationale } from '../prediction-parse'
import type { HistorySeriesBar } from './history'
import { leagueSideFromDivination } from './divination'
import { isSportsLedgerCategory } from './sports-category'

/** Challenger roster id — powers the seat; the ledger row is still `crow`. */
export const CROW_ENGINE_MODEL_ID = 'mistral-medium-3.5'

export const CROW_MAX_COMPLETION_TOKENS = 1200
export const CROW_TIMEOUT_MS = 45_000

export const CROW_PERSONA =
  'You are 까마귀, the crow. You see what the crowd overlooks. You know the data and the market baseline, but you weigh the ignored risks, overheating, and the underdog\'s real chance. You are NOT contrarian for its own sake — only call the reversal when there\'s a genuine reason. Often you\'re wrong (you side with the overlooked), but sometimes you\'re chillingly right.'

export const CROW_INPUT_KEYS = [
  'proposition',
  'instrument',
  'horizon',
  'category',
  'subjectName',
  'propositionKind',
  'factBrief',
] as const

export type CrowLeagueInput = {
  proposition: string
  instrument: string
  horizon: string
  category: string
  subjectName: string
  propositionKind: string | null
  factBrief: string
}

export type CrowEngineOutput = {
  verdict: 'up' | 'down'
  rationale: string
  confidence: number | null
}

export type CrowCallResult = {
  text: string | null
  promptTokens: number | null
  completionTokens: number | null
  costUsd: number | null
  costIsEstimated: boolean
  error?: string
}

export type CrowCaller = (args: { systemPrompt: string; userPrompt: string }) => Promise<CrowCallResult>

export function buildCrowInput(
  round: {
    proposition_text: string
    category: string
    instrument: string
    horizon?: string | null
    subject_label?: string | null
    proposition_kind?: string | null
  },
  factBrief: string,
): CrowLeagueInput {
  return {
    proposition: round.proposition_text,
    instrument: round.instrument,
    horizon: round.horizon?.trim() || '1d',
    category: round.category,
    subjectName: round.subject_label?.trim() || round.instrument,
    propositionKind: round.proposition_kind ?? null,
    factBrief,
  }
}

export function buildCrowSystemPrompt(category: string): string {
  const sports = isSportsLedgerCategory(category)
  const lens = sports
    ? 'Sports lens: the underdog\'s uprising and single-game chaos. Home advantage, the book\'s residual on the dog, and one-night variance are real. Rest, bullpen, and rotation count only when the brief states them.'
    : 'Finance lens: the crowd\'s euphoria, overheating, and mean-reversion risk. A steep measured run is a real downside. A flat path is not a reversal. Do not invent yields, funding, or macro prints.'
  return [
    CROW_PERSONA,
    '',
    'You are the 🐦‍⬛ 까마귀 extra seat in a prediction league. You answer ALONE, on every category.',
    lens,
    'If the overlooked side has no genuine factor in the brief, agree with the measured edge. A strong favorite or a strong trend can still be your call.',
    'Never invent odds, injuries, prices, or a win rate for yourself.',
    '',
    'Last line MUST be JSON:',
    '{"direction":"up"|"down","probability":0-100,"rationale":"..."}',
    'direction up = the proposition\'s affirmative side (subject wins, or the price finishes higher). direction down = the other side.',
    'probability is your confidence in that side, not a copied market percent.',
    'rationale: 1–2 sentences, max 400 characters. Name the overlooked factor or say the measured edge still holds.',
  ].join('\n')
}

export function buildCrowUserPrompt(input: CrowLeagueInput): string {
  return [
    `PROPOSITION: ${input.proposition}`,
    `SUBJECT: ${input.subjectName}`,
    `INSTRUMENT: ${input.instrument}`,
    `HORIZON: ${input.horizon}`,
    `CATEGORY: ${input.category}`,
    '',
    'FACTS YOU KNOW (do not add numbers that are not here):',
    input.factBrief.trim() || 'FACTS: UNAVAILABLE. Do not invent a baseline.',
  ].join('\n')
}

export function crowRetryInstruction(): string {
  return [
    'RETRY: You are 까마귀. Last line must be {"direction":"up"|"down","probability":0-100,"rationale":"..."}.',
    'Do not be contrarian for its own sake. Do not invent numbers. Do not return an empty answer.',
  ].join(' ')
}

/** Dates and closes only. No invented macro. */
export function formatFinanceCrowBrief(
  series: { bars: HistorySeriesBar[]; latestClose?: number | null } | null | undefined,
): string {
  const bars = (series?.bars ?? []).filter((bar) => Number.isFinite(bar.close) && bar.close !== 0)
  if (bars.length < 2) {
    return [
      'PRICE PATH: UNAVAILABLE.',
      'Do not invent prices, yields, funding, or odds.',
      'Without a measured run there is no overheating signal. Say so. Agree with "no measured reversal" rather than inventing a fade.',
    ].join('\n')
  }
  const first = bars[0]!
  const last = bars[bars.length - 1]!
  const change = ((last.close - first.close) / first.close) * 100
  const tail = bars.slice(-5)
  const tailChange =
    tail.length >= 2 ? ((tail[tail.length - 1]!.close - tail[0]!.close) / tail[0]!.close) * 100 : null
  const lines = [
    'PRICE PATH (dates and closes only — the baseline you can see):',
    `${first.date} ${first.close} → ${last.date} ${last.close} (${change.toFixed(2)}% over ${bars.length} closes).`,
  ]
  if (tailChange != null) lines.push(`Last ${tail.length} closes: ${tailChange.toFixed(2)}%.`)
  lines.push(
    'Crowd euphoria is real only when this path is a steep run. Mean-reversion is the ignored downside of that run, not a required fade. A flat path is not a reversal.',
  )
  return lines.join('\n')
}

export function parseCrowOutput(text: string | null): CrowEngineOutput | null {
  if (!text?.trim()) return null
  const parsed = parsePrediction(text)
  if (!parsed?.direction) return null
  const rationale = (parsed.rationale ?? sanitizeRationale(text) ?? '').slice(0, 500).trim()
  if (!rationale) return null
  return {
    verdict: parsed.direction,
    rationale,
    confidence: parsed.probability,
  }
}

export function leagueSideFromCrow(
  verdict: 'up' | 'down',
  propositionKind: string | null | undefined,
): AnswerSide {
  return leagueSideFromDivination(verdict, null, propositionKind)
}
