/**
 * Extra consensus seat — 💰 돈이 매긴 확률.
 *
 * Judges by where MONEY is positioned: options implied probability / put-call
 * skew, prediction-market odds (Polymarket / Kalshi), futures COT positioning,
 * institutional consensus targets. Found via Perplexity web search — no
 * prediction-market API, no new keys.
 *
 * NOT charts (history), NOT news-mood (sentiment), NOT the research packet.
 * Engine: scout Perplexity `sonar-reasoning-pro` (1 search call / round).
 * Ledger model_id stays `consensus`. Isolated from the official 40-AI verdict.
 * Abstain if no money-positioning signal — never invent.
 */
import type { AnswerSide } from '../answer-contract'
import { parsePrediction, sanitizeRationale } from '../prediction-parse'
import { leagueSideFromDivination } from './divination'

export const CONSENSUS_ENGINE_MODEL_ID = 'sonar-reasoning-pro'

export const CONSENSUS_FORBIDDEN_ENGINES = ['grok-4.6-livesearch', 'grok-4.3', 'grok-4.5'] as const

export const CONSENSUS_MONEY_SIGNALS = [
  'options implied probability / put-call skew',
  'prediction-market odds (Polymarket / Kalshi)',
  'futures COT positioning',
  'analyst / institutional consensus targets',
] as const

export const CONSENSUS_INPUT_KEYS = [
  'proposition',
  'instrument',
  'horizon',
  'category',
  'subjectName',
  'propositionKind',
] as const

export const CONSENSUS_PACKET_BAN = [
  'packet',
  'injection',
  'dataPacket',
  'data_packet',
  'research',
  'closedBook',
  'closed_book_packet_text',
  'priceSeries',
  'price_series',
  'series',
  'latestClose',
  'tips',
  'TIPS',
  'cot',
] as const

export const CONSENSUS_PERSONA =
  '돈이 매긴 확률 분석가 — 당신은 차트 모양이나 뉴스 분위기가 아니라, \'돈이 실제로 어디에 걸렸는가\'로 판단한다. 옵션 시장이 매긴 확률, 예측시장 배당, 선물 포지셔닝, 기관 컨센서스 목표가를 검색해, 시장이 돈으로 가리키는 방향을 읽는다. \'옵션 시장은 ~%를 반영\', \'선물 포지션은 ~로 기울어\', \'예측시장 배당은 ~\' 같은 언어로 말한다.'

/** Money / market-priced vocabulary the rationale should use. */
export const CONSENSUS_LANGUAGE_ALIASES = [
  '옵션',
  '내재',
  'implied',
  '풋콜',
  'put-call',
  'put/call',
  'skew',
  '예측시장',
  'polymarket',
  'kalshi',
  '배당',
  'odds',
  'cot',
  '포지션',
  '포지셔닝',
  'positioning',
  '기관',
  '컨센서스',
  '목표가',
  'price target',
  '미결제',
  'open interest',
] as const

const CHART_PATTERN_LEAKS = [
  '엘리어트',
  'elliott',
  '헤드앤숄더',
  'head-and-shoulders',
  'head and shoulders',
  '쌍바닥',
  '쌍봉',
  'double bottom',
  'double top',
  '컵앤핸들',
  'cup-and-handle',
  'cup and handle',
  '데드크로스',
  '골든크로스',
  'dead cross',
  'death cross',
  'golden cross',
  '추세선',
  'trendline',
  '넥라인',
  'neckline',
  'rsi',
  'macd',
  '이동평균',
] as const

/** Pure news-mood language — sentiment seat's job. */
const NEWS_MOOD_LEAKS = [
  '분위기',
  '여론',
  '루머',
  '화제',
  '서사',
  'rumor',
  'narrative',
  'mood',
  '블로그',
  '포럼',
] as const

const PACKET_MACRO_LEAKS = [
  'tips',
  'cpi',
  'pce',
  'fomc',
  'nfp',
  'nonfarm',
  'unemployment',
  '실업률',
  'eps',
  '실적발표',
  'closed-book',
  'closed_book',
  '데이터 패킷',
  'research packet',
] as const

const NO_SIGNAL_RES: readonly RegExp[] = [
  /돈으로 매긴 확률 신호를 찾지/,
  /시장이 매긴 확률을 찾지/,
  /포지셔닝 신호를 찾지/,
  /no (?:money[- ]positioning|priced|odds|implied) (?:data|signal)/i,
  /no prediction[- ]market/i,
]

export type ConsensusLeagueInput = {
  proposition: string
  instrument: string
  horizon: string
  category: string
  subjectName: string
  propositionKind: string | null
}

export type ConsensusEngineOutput =
  | { kind: 'verdict'; verdict: 'up' | 'down'; rationale: string; confidence: number | null }
  | { kind: 'abstain'; rationale: string }

export type ConsensusCallResult = {
  text: string | null
  promptTokens: number | null
  completionTokens: number | null
  costUsd: number | null
  costIsEstimated: boolean
  error?: string
}

export type ConsensusCaller = (args: {
  systemPrompt: string
  userPrompt: string
}) => Promise<ConsensusCallResult>

export function buildConsensusInput(round: {
  proposition_text: string
  category: string
  instrument: string
  horizon?: string | null
  subject_label?: string | null
  proposition_kind?: string | null
}): ConsensusLeagueInput {
  return {
    proposition: round.proposition_text,
    instrument: round.instrument,
    horizon: round.horizon?.trim() || '1d',
    category: round.category,
    subjectName: round.subject_label?.trim() || round.instrument,
    propositionKind: round.proposition_kind ?? null,
  }
}

export function assertConsensusInputShape(input: object): asserts input is ConsensusLeagueInput {
  const record = input as Record<string, unknown>
  for (const banned of CONSENSUS_PACKET_BAN) {
    if (Object.prototype.hasOwnProperty.call(record, banned) && record[banned] != null) {
      throw new Error(`consensus seat must not receive ${banned}`)
    }
  }
  for (const key of Object.keys(record)) {
    if (!(CONSENSUS_INPUT_KEYS as readonly string[]).includes(key)) {
      throw new Error(`consensus input forbids extra key "${key}"`)
    }
  }
}

export function buildConsensusSystemPrompt(): string {
  return [
    CONSENSUS_PERSONA,
    '',
    'You are the 💰 돈이 매긴 확률 extra seat in a prediction league. You answer ALONE.',
    'Use your built-in web search to FIND money-positioning signals for this subject. No prediction-market API is attached — search the public web.',
    'Search specifically for:',
    '- options implied probability / put-call skew / options-implied direction',
    '- prediction-market odds if any exist (Polymarket, Kalshi)',
    '- futures COT / speculative vs commercial positioning',
    '- analyst or institutional consensus price targets',
    'Read what the MARKET has priced with money. Not chart shapes. Not news mood.',
    '',
    'How to judge:',
    '- Name which money signal you found.',
    '- Write in market-priced language: "옵션 시장은 ~%를 반영", "선물 포지션은 ~로 기울어", "예측시장 배당은 ~".',
    '- Then pick a direction for THIS proposition and horizon.',
    '',
    'If search finds no money-positioning data (common for obscure assets), do NOT invent odds. Abstain.',
    'Abstain JSON (last line): {"direction":null,"found":false,"probability":null,"rationale":"시장이 돈으로 매긴 확률 신호를 찾지 못했습니다."}',
    '',
    'When you DO have a signal, last line MUST be:',
    '{"direction":"up"|"down","probability":0-100,"rationale":"..."}',
    'direction is up or down only. For yes/no or above/below propositions, up = the first/affirmative side, down = the other.',
    'probability: your confidence that the priced signal actually leans that way. Citing a market-implied percent you found is allowed; inventing one is not.',
    'rationale: 1–2 sentences, max 400 characters, money/positioning language only. No chart-pattern names, no 분위기/여론/루머 news-mood, no TIPS/CPI packet prints.',
  ].join('\n')
}

export function buildConsensusUserPrompt(input: ConsensusLeagueInput): string {
  assertConsensusInputShape(input)
  return [
    `PROPOSITION: ${input.proposition}`,
    `SUBJECT: ${input.subjectName}`,
    `INSTRUMENT: ${input.instrument}`,
    `HORIZON: ${input.horizon}`,
    `CATEGORY: ${input.category}`,
    '',
    'Search the live web for money-positioning: options implied probability, put-call skew, Polymarket/Kalshi odds, futures COT, institutional consensus targets.',
    'Judge what money has priced. No charts, no news-mood, no packet macro.',
    'If nothing is priced for this asset, abstain — do not invent odds.',
  ].join('\n')
}

export function consensusRetryInstruction(): string {
  return [
    'RETRY: Rewrite as the 돈이 매긴 확률 seat.',
    'Use only options / prediction-market odds / COT positioning / institutional target language.',
    'Do not name chart patterns. Do not write 분위기/여론/루머. Do not cite TIPS or CPI.',
    'If there is no money-positioning signal, output found:false and direction null.',
    'Otherwise last line: {"direction":"up"|"down","probability":0-100,"rationale":"..."}.',
  ].join(' ')
}

export function findConsensusMoneyLanguage(text: string | null | undefined): string | null {
  if (!text) return null
  const lower = text.toLowerCase()
  for (const alias of CONSENSUS_LANGUAGE_ALIASES) {
    if (lower.includes(alias.toLowerCase())) return alias
  }
  return null
}

export function findConsensusChartLeak(text: string | null | undefined): string | null {
  if (!text) return null
  const lower = text.toLowerCase()
  for (const token of CHART_PATTERN_LEAKS) {
    if (lower.includes(token.toLowerCase())) return token
  }
  return null
}

export function findConsensusNewsMoodLeak(text: string | null | undefined): string | null {
  if (!text) return null
  const lower = text.toLowerCase()
  for (const token of NEWS_MOOD_LEAKS) {
    if (lower.includes(token.toLowerCase())) return token
  }
  return null
}

export function findConsensusPacketLeak(text: string | null | undefined): string | null {
  if (!text) return null
  const lower = text.toLowerCase()
  for (const token of PACKET_MACRO_LEAKS) {
    if (lower.includes(token.toLowerCase())) return token
  }
  return null
}

export function isConsensusNoSignalText(text: string | null | undefined): boolean {
  if (!text) return false
  for (const re of NO_SIGNAL_RES) {
    if (re.test(text)) return true
  }
  return false
}

function parseFoundFlag(text: string): boolean | null {
  const match = text.match(/"found"\s*:\s*(false|true)/i)
  if (!match) return null
  return match[1]!.toLowerCase() === 'true'
}

export function consensusRationaleNeedsRetry(rationale: string | null): boolean {
  if (!rationale) return true
  if (findConsensusChartLeak(rationale)) return true
  if (findConsensusNewsMoodLeak(rationale)) return true
  if (findConsensusPacketLeak(rationale)) return true
  if (!findConsensusMoneyLanguage(rationale)) return true
  return false
}

export function parseConsensusOutput(text: string | null): ConsensusEngineOutput | null {
  if (!text) return null
  const found = parseFoundFlag(text)
  const parsed = parsePrediction(text)
  const rationale =
    parsed?.rationale ??
    sanitizeRationale(text.match(/"rationale"\s*:\s*"([^"]+)"/i)?.[1] ?? null)

  if (found === false || isConsensusNoSignalText(rationale) || isConsensusNoSignalText(text)) {
    return {
      kind: 'abstain',
      rationale: rationale || CONSENSUS_NO_SIGNAL_REASON,
    }
  }

  if (!parsed?.direction) return null
  if (!rationale) return null
  return {
    kind: 'verdict',
    verdict: parsed.direction,
    rationale: rationale.slice(0, 500),
    confidence: parsed.probability,
  }
}

export function leagueSideFromConsensus(
  verdict: 'up' | 'down',
  propositionKind: string | null | undefined,
): AnswerSide {
  return leagueSideFromDivination(verdict, null, propositionKind)
}

export const CONSENSUS_NO_SIGNAL_REASON = '시장이 돈으로 매긴 확률 신호를 찾지 못했습니다'

export const CONSENSUS_LIST_PRICE = { inputPerMTokens: 2, outputPerMTokens: 8 } as const
export const CONSENSUS_CALLS_PER_ROUND = 1

export function expectedConsensusCostUsdPerRound(): {
  typicalLow: number
  typicalHigh: number
  calls: number
  engine: typeof CONSENSUS_ENGINE_MODEL_ID
  searchSource: 'perplexity-web-index'
  moneySignals: typeof CONSENSUS_MONEY_SIGNALS
  notGrok: true
} {
  return {
    typicalLow: 0.01,
    typicalHigh: 0.03,
    calls: CONSENSUS_CALLS_PER_ROUND,
    engine: CONSENSUS_ENGINE_MODEL_ID,
    searchSource: 'perplexity-web-index',
    moneySignals: CONSENSUS_MONEY_SIGNALS,
    notGrok: true,
  }
}
