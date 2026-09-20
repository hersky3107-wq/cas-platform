/**
 * Extra sentiment seat — 📰 심리·내러티브.
 *
 * Reads ONLY web-visible news / rumor / blog / forum / social opinion via
 * Perplexity search. NOT charts, NOT the price series, NOT packet-macro
 * (TIPS / CPI / yields). Accepted limit: search engines do not index live
 * X/Twitter comments or unindexed threads — this is "web-visible crowd
 * sentiment", not exhaustive comment scraping.
 *
 * Engine: scout Perplexity `sonar-reasoning-pro` (1 search call / round).
 * Not Grok — avoid the 60k-token X-crawl. Ledger model_id stays `sentiment`.
 * Isolated from the official 40-AI consensus. Abstain if no signal — never invent.
 */
import type { AnswerSide } from '../answer-contract'
import { parsePrediction, sanitizeRationale } from '../prediction-parse'
import { leagueSideFromDivination } from './divination'

/** Scout roster id — powers the seat; the ledger row is still `sentiment`. */
export const SENTIMENT_ENGINE_MODEL_ID = 'sonar-reasoning-pro'

/** Confirmed: this seat must never call Grok live-search / X-crawl. */
export const SENTIMENT_FORBIDDEN_ENGINES = ['grok-4.6-livesearch', 'grok-4.3', 'grok-4.5'] as const

export const SENTIMENT_INPUT_KEYS = [
  'proposition',
  'instrument',
  'horizon',
  'category',
  'subjectName',
  'propositionKind',
] as const

export const SENTIMENT_PACKET_BAN = [
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
  'consensus',
] as const

export const SENTIMENT_PERSONA =
  '심리·내러티브 분석가 — 시세·차트·재무제표를 보지 않는다. 지금 도는 뉴스, 그리고 검색으로 드러나는 블로그·포럼·소셜 여론과 루머·화제를 훑어, 대중 심리가 어느 쪽으로 쏠렸는지로 방향을 판단한다. \'분위기는 ~\', \'여론이 ~로 기운다\', \'화제/루머가 ~\' 같은 심리·서사 언어로만 말한다.'

/** Mood / narrative words the rationale should use. */
export const SENTIMENT_LANGUAGE_ALIASES = [
  '분위기',
  '여론',
  '루머',
  '화제',
  '심리',
  '서사',
  '낙관',
  '비관',
  '공포',
  '탐욕',
  '기대',
  '회의',
  'sentiment',
  'rumor',
  'narrative',
  'mood',
  'crowd',
] as const

/** History-seat chart language — not this seat's job. */
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

/** Packet-macro / price-tape language — other seats' job. */
const PRICE_FUNDAMENTAL_LEAKS = [
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
  '가이던스',
  'guidance',
  '국채',
  'treasury yield',
  'yield curve',
  'latest close',
  '종가가',
  'closed-book',
  'closed_book',
  '데이터 패킷',
  'research packet',
] as const

const NO_SIGNAL_RES: readonly RegExp[] = [
  /여론을 찾지/,
  /검색으로 드러난 여론이 없/,
  /웹에 보이는 여론이 없/,
  /meaningful (?:sentiment|opinion) (?:not |un)available/i,
  /no meaningful (?:news|sentiment|opinion)/i,
  /not enough (?:news|sentiment|web[- ]visible)/i,
]

export type SentimentLeagueInput = {
  proposition: string
  instrument: string
  horizon: string
  category: string
  subjectName: string
  propositionKind: string | null
}

export type SentimentEngineOutput =
  | { kind: 'verdict'; verdict: 'up' | 'down'; rationale: string; confidence: number | null }
  | { kind: 'abstain'; rationale: string }

export type SentimentCallResult = {
  text: string | null
  promptTokens: number | null
  completionTokens: number | null
  costUsd: number | null
  costIsEstimated: boolean
  error?: string
}

export type SentimentCaller = (args: {
  systemPrompt: string
  userPrompt: string
}) => Promise<SentimentCallResult>

export function buildSentimentInput(round: {
  proposition_text: string
  category: string
  instrument: string
  horizon?: string | null
  subject_label?: string | null
  proposition_kind?: string | null
}): SentimentLeagueInput {
  return {
    proposition: round.proposition_text,
    instrument: round.instrument,
    horizon: round.horizon?.trim() || '1d',
    category: round.category,
    subjectName: round.subject_label?.trim() || round.instrument,
    propositionKind: round.proposition_kind ?? null,
  }
}

export function assertSentimentInputShape(input: object): asserts input is SentimentLeagueInput {
  const record = input as Record<string, unknown>
  for (const banned of SENTIMENT_PACKET_BAN) {
    if (Object.prototype.hasOwnProperty.call(record, banned) && record[banned] != null) {
      throw new Error(`sentiment seat must not receive ${banned}`)
    }
  }
  for (const key of Object.keys(record)) {
    if (!(SENTIMENT_INPUT_KEYS as readonly string[]).includes(key)) {
      throw new Error(`sentiment input forbids extra key "${key}"`)
    }
  }
}

export function buildSentimentSystemPrompt(): string {
  return [
    SENTIMENT_PERSONA,
    '',
    'You are the 📰 심리·내러티브 extra seat in a prediction league. You answer ALONE.',
    'Use your built-in web search to read CURRENT news headlines and web-visible blog / forum / Reddit-style / social opinion about the subject.',
    'Accepted limit: you cannot deeply scrape live comments or real-time X/Twitter. Judge only what search engines index — web-visible crowd sentiment, not an exhaustive comment crawl.',
    'Do NOT look at charts, price series, technical patterns, or packet-macro prints (no TIPS, CPI, FOMC, yields, EPS). Those belong to other seats.',
    '',
    'How to judge:',
    '- Say which way the mood / 여론 / 루머 / 화제 is leaning.',
    '- Write in sentiment-narrative language only: "분위기는 ~", "여론이 ~로 기운다", "화제/루머가 ~".',
    '- Then pick a direction for THIS proposition and horizon.',
    '',
    'If search finds no meaningful news or web-visible opinion, do NOT invent a crowd. Abstain.',
    'Abstain JSON (last line): {"direction":null,"found":false,"probability":null,"rationale":"검색으로 드러난 여론이 없어 판단하지 않습니다."}',
    '',
    'When you DO have a signal, last line MUST be:',
    '{"direction":"up"|"down","probability":0-100,"rationale":"..."}',
    'direction is up or down only. For yes/no or above/below propositions, up = the first/affirmative side, down = the other.',
    'probability: your confidence that the web-visible mood actually leans that way — not a fake poll percentage.',
    'rationale: 1–2 sentences, max 400 characters, sentiment/narrative language. Name the mood. No chart-pattern names, no TIPS/CPI/close prices.',
  ].join('\n')
}

export function buildSentimentUserPrompt(input: SentimentLeagueInput): string {
  assertSentimentInputShape(input)
  return [
    `PROPOSITION: ${input.proposition}`,
    `SUBJECT: ${input.subjectName}`,
    `INSTRUMENT: ${input.instrument}`,
    `HORIZON: ${input.horizon}`,
    `CATEGORY: ${input.category}`,
    '',
    'Search the live web for news + indexed blog/forum/social opinion about this subject.',
    'Judge web-visible crowd sentiment only. No charts, no price tape, no packet macro.',
    'If nothing meaningful is indexed, abstain — do not invent a mood.',
  ].join('\n')
}

export function sentimentRetryInstruction(): string {
  return [
    'RETRY: Rewrite as the 심리·내러티브 seat.',
    'Use only mood / 여론 / 루머 / 화제 language from web-visible sources.',
    'Do not name chart patterns. Do not cite TIPS, CPI, yields, closes, or EPS.',
    'If there is no indexed sentiment, output found:false and direction null.',
    'Otherwise last line: {"direction":"up"|"down","probability":0-100,"rationale":"..."}.',
  ].join(' ')
}

export function findSentimentLanguage(text: string | null | undefined): string | null {
  if (!text) return null
  const lower = text.toLowerCase()
  for (const alias of SENTIMENT_LANGUAGE_ALIASES) {
    if (lower.includes(alias.toLowerCase())) return alias
  }
  return null
}

export function findSentimentChartLeak(text: string | null | undefined): string | null {
  if (!text) return null
  const lower = text.toLowerCase()
  for (const token of CHART_PATTERN_LEAKS) {
    if (lower.includes(token.toLowerCase())) return token
  }
  return null
}

export function findSentimentPriceFundamentalLeak(text: string | null | undefined): string | null {
  if (!text) return null
  const lower = text.toLowerCase()
  for (const token of PRICE_FUNDAMENTAL_LEAKS) {
    if (lower.includes(token.toLowerCase())) return token
  }
  return null
}

export function isSentimentNoSignalText(text: string | null | undefined): boolean {
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

export function sentimentRationaleNeedsRetry(rationale: string | null): boolean {
  if (!rationale) return true
  if (findSentimentChartLeak(rationale)) return true
  if (findSentimentPriceFundamentalLeak(rationale)) return true
  if (!findSentimentLanguage(rationale)) return true
  return false
}

export function parseSentimentOutput(text: string | null): SentimentEngineOutput | null {
  if (!text) return null
  const found = parseFoundFlag(text)
  const parsed = parsePrediction(text)
  const rationale =
    parsed?.rationale ??
    sanitizeRationale(text.match(/"rationale"\s*:\s*"([^"]+)"/i)?.[1] ?? null)

  if (found === false || isSentimentNoSignalText(rationale) || isSentimentNoSignalText(text)) {
    return {
      kind: 'abstain',
      rationale: rationale || SENTIMENT_NO_SIGNAL_REASON,
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

export function leagueSideFromSentiment(
  verdict: 'up' | 'down',
  propositionKind: string | null | undefined,
): AnswerSide {
  return leagueSideFromDivination(verdict, null, propositionKind)
}

export const SENTIMENT_NO_SIGNAL_REASON =
  '검색으로 드러난 뉴스·여론이 없어 심리 판단을 하지 않습니다. 심리·내러티브 좌석은 웹에 보이는 여론이 있을 때만 답합니다.'

/**
 * Roster list price for sonar-reasoning-pro. Perplexity folds the search
 * request fee into billed `usage.cost.total_cost` — prefer that on the ledger.
 * Typical 1-call extra round: ~$0.01–$0.03 (tokens + search request).
 * Not Grok live-search (that path burned tens of thousands of X-crawl tokens).
 */
export const SENTIMENT_LIST_PRICE = { inputPerMTokens: 2, outputPerMTokens: 8 } as const
export const SENTIMENT_SEARCH_REQUEST_USD = 0.006
export const SENTIMENT_CALLS_PER_ROUND = 1

export function expectedSentimentCostUsdPerRound(): {
  typicalLow: number
  typicalHigh: number
  calls: number
  engine: typeof SENTIMENT_ENGINE_MODEL_ID
  searchSource: 'perplexity-web-index'
  notGrok: true
} {
  return {
    typicalLow: 0.01,
    typicalHigh: 0.03,
    calls: SENTIMENT_CALLS_PER_ROUND,
    engine: SENTIMENT_ENGINE_MODEL_ID,
    searchSource: 'perplexity-web-index',
    notGrok: true,
  }
}
