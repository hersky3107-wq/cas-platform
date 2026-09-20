/**
 * Extra history seat — 📜 역사·패턴.
 *
 * NOT a price-statistics calculator and NOT a live-news / packet-macro seat.
 * The model reads the round's price path (dates + closes) and judges with
 * well-known chart patterns + financial-history precedents from its own
 * knowledge (Elliott, H&S, double bottom/top, cup-and-handle, crosses,
 * seasonality, analogs). Isolated from the official 40-AI consensus.
 *
 * Engine: challenger-class Claude Sonnet 5 (knowledge-rich, already wired).
 * Ledger model_id stays `history`. Never invent per-pattern win rates.
 */
import type { AnswerSide } from '../answer-contract'
import { parsePrediction, sanitizeRationale } from '../prediction-parse'
import { leagueSideFromDivination } from './divination'

/** Challenger roster id — powers the seat; the ledger row is still `history`. */
export const HISTORY_ENGINE_MODEL_ID = 'claude-sonnet-5'

/** Daily closes shown in the prompt — enough shape for classical patterns. */
export const HISTORY_SERIES_PRINT_BARS = 80

export const HISTORY_INPUT_KEYS = [
  'proposition',
  'instrument',
  'horizon',
  'category',
  'subjectName',
  'propositionKind',
  'series',
  'latestClose',
  'asOf',
] as const

export const HISTORY_RESEARCH_BAN = [
  'packet',
  'injection',
  'dataPacket',
  'data_packet',
  'research',
  'closedBook',
  'closed_book_packet_text',
  'consensus',
  'tips',
  'TIPS',
  'cot',
  'news',
] as const

/**
 * Vocabulary the seat must recognize and name. Aliases (KO + EN) count
 * as the same pattern for the language guard.
 */
export const HISTORY_PATTERN_VOCABULARY = [
  {
    id: 'elliott',
    label: '엘리어트 파동',
    aliases: ['엘리어트', 'elliott', 'impulse wave', 'corrective wave'],
  },
  {
    id: 'breakout',
    label: '신고가/신저가 돌파형',
    aliases: ['신고가', '신저가', '신고가 돌파', '신저가 돌파', 'breakout', 'new high', 'new low'],
  },
  {
    id: 'double-hs',
    label: '쌍바닥·쌍봉 / 헤드앤숄더',
    aliases: [
      '쌍바닥',
      '쌍봉',
      '헤드앤숄더',
      '넥라인',
      'head-and-shoulders',
      'head and shoulders',
      'double bottom',
      'double top',
    ],
  },
  {
    id: 'u-turn',
    label: 'U자형 턴어라운드',
    aliases: ['u자', '턴어라운드', 'rounding bottom', 'rounding top', 'u-shape', 'u shape'],
  },
  {
    id: 'cup-handle',
    label: '컵앤핸들',
    aliases: ['컵앤핸들', '컵 앤 핸들', 'cup-and-handle', 'cup and handle'],
  },
  {
    id: 'cross',
    label: '데드크로스·골든크로스',
    aliases: ['데드크로스', '골든크로스', 'dead cross', 'death cross', 'golden cross'],
  },
  {
    id: 'staged-run',
    label: '3단·5단 상승 후 급등',
    aliases: ['3단', '5단', '3단계', '5단계', '급등 후', 'blow-off', 'climax run'],
  },
  {
    id: 'trendline',
    label: '추세선 상승/하락형',
    aliases: ['추세선', 'trendline', 'trend line'],
  },
  {
    id: 'dead-decline',
    label: '데드(죽음) 하락 패턴',
    aliases: ['죽음 하락', '데드 하락', 'waterfall', 'cascade decline', 'dying market'],
  },
  {
    id: 'seasonality',
    label: '계절성',
    aliases: ['계절성', 'seasonality', 'sell in may', '9월'],
  },
] as const

export const HISTORY_PERSONA =
  '역사·패턴 분석가 — 당신은 세상에 알려진 차트 패턴(엘리어트 파동, 헤드앤숄더, 쌍바닥, 컵앤핸들, 데드크로스, 신고가 돌파, 추세선 등)과 금융 역사의 반복 법칙을 아는 전문가다. 현재 가격 흐름이 어떤 알려진 패턴에 해당하는지 식별하고, \'역사적으로 이런 패턴/국면에서는 이렇게 되었다\'는 근거로 방향을 판단한다. 실시간 뉴스·펀더멘털·거시지표는 보지 않는다 — 오직 차트 패턴과 역사적 선례만.'

const NEWS_FUNDAMENTAL_LEAKS = [
  'tips',
  'cpi',
  'pce',
  'fomc',
  'nfp',
  'nonfarm',
  'unemployment',
  '실업률',
  '연준',
  'fed hike',
  'fed cut',
  'earnings',
  'eps',
  '실적발표',
  '가이던스',
  'guidance',
  '국채',
  'treasury yield',
  'yield curve',
  '펀더멘털',
  'fundamental',
  '헤드라인',
  '속보',
  '뉴스에',
  'closed-book',
  'closed_book',
  '데이터 패킷',
  'research packet',
] as const

const FAKE_WINRATE_RES: readonly RegExp[] = [
  /(?:승률|적중률|win[-\s]?rate)\s*[:=]?\s*\d{1,3}\s*%?/i,
  /\d{1,3}\s*%\s*(?:승률|적중|확률로\s*(?:상승|하락)|of the time|of cases|win rate)/i,
  /(?:이 패턴은|this pattern)\s*(?:은\s*)?\d{1,3}\s*%/i,
  /historically\s+\d{1,3}\s*%/i,
  /\d{1,3}\s*%\s*(?:상승|하락)\s*(?:확률|승률)/i,
  /\d+\s*번\s*중\s*\d+\s*번/,
]

export type HistorySeriesBar = { date: string; close: number }

export type HistoryLeagueInput = {
  proposition: string
  instrument: string
  horizon: string
  category: string
  subjectName: string
  propositionKind: string | null
  series: HistorySeriesBar[]
  latestClose: number | null
  asOf: string | null
}

export type HistoryEngineOutput = {
  verdict: 'up' | 'down'
  rationale: string
  confidence: number | null
  namedPattern: string | null
}

export type HistoryCallResult = {
  text: string | null
  promptTokens: number | null
  completionTokens: number | null
  costUsd: number | null
  costIsEstimated: boolean
  error?: string
}

export type HistoryCaller = (args: {
  systemPrompt: string
  userPrompt: string
}) => Promise<HistoryCallResult>

export function buildHistoryInput(round: {
  proposition_text: string
  category: string
  instrument: string
  horizon?: string | null
  subject_label?: string | null
  proposition_kind?: string | null
  opened_at?: string | null
}, series: {
  bars: readonly HistorySeriesBar[]
  latestClose?: number | null
  asOf?: string | null
}): HistoryLeagueInput {
  return {
    proposition: round.proposition_text,
    instrument: round.instrument,
    horizon: round.horizon?.trim() || '1d',
    category: round.category,
    subjectName: round.subject_label?.trim() || round.instrument,
    propositionKind: round.proposition_kind ?? null,
    series: series.bars.map((bar) => ({ date: bar.date, close: bar.close })),
    latestClose: typeof series.latestClose === 'number' ? series.latestClose : series.bars[series.bars.length - 1]?.close ?? null,
    asOf: series.asOf ?? series.bars[series.bars.length - 1]?.date ?? round.opened_at ?? null,
  }
}

export function assertHistoryInputShape(input: object): asserts input is HistoryLeagueInput {
  const record = input as Record<string, unknown>
  for (const banned of HISTORY_RESEARCH_BAN) {
    if (Object.prototype.hasOwnProperty.call(record, banned) && record[banned] != null) {
      throw new Error(`history seat must not receive ${banned}`)
    }
  }
  for (const key of Object.keys(record)) {
    if (!(HISTORY_INPUT_KEYS as readonly string[]).includes(key)) {
      throw new Error(`history input forbids extra key "${key}"`)
    }
  }
}

/** Dates + closes only. No TIPS, consensus, research, or derived oscillators. */
export function formatPriceSeriesForHistory(input: Pick<HistoryLeagueInput, 'instrument' | 'series' | 'latestClose' | 'asOf'>): string {
  const bars = input.series.filter((bar) => typeof bar.close === 'number' && bar.date)
  if (bars.length === 0) return `Instrument: ${input.instrument}\n(no daily closes)`
  const printed = bars.slice(-HISTORY_SERIES_PRINT_BARS)
  const rows = printed.map((bar) => `  ${bar.date}: ${bar.close}`).join('\n')
  const lines = [
    `Instrument: ${input.instrument}`,
    input.asOf ? `As of: ${input.asOf}` : null,
    typeof input.latestClose === 'number' ? `Latest close: ${input.latestClose}` : null,
    `Daily closes (oldest→newest, last ${printed.length} of ${bars.length}):`,
    rows,
  ]
  return lines.filter((line): line is string => Boolean(line)).join('\n')
}

export function historyPatternVocabularyLine(): string {
  return HISTORY_PATTERN_VOCABULARY.map((row) => row.label).join(', ')
}

export function buildHistorySystemPrompt(): string {
  const vocab = historyPatternVocabularyLine()
  return [
    HISTORY_PERSONA,
    '',
    'You are the 📜 역사·패턴 extra seat in a prediction league. You answer ALONE.',
    'Read ONLY the daily close path below plus your own knowledge of classical chart patterns and market-history precedents.',
    'Do not browse the web. Do not invent live news, yields, earnings, or packet-macro figures.',
    '',
    `Pattern vocabulary — identify which of these the current price shape most resembles, and NAME it: ${vocab}.`,
    'Also allowed: neckline, analog years (1987, 2000, 2008, 2020), and well-known seasonality (e.g. September softness) when the calendar on the series supports it.',
    '',
    'How to judge:',
    '- Identify the pattern by name.',
    '- State the historical tendency in prose: "이런 패턴은 역사적으로 ~하는 경향".',
    '- Then pick a direction for THIS proposition and horizon.',
    '',
    'FORBIDDEN — never do these:',
    '- Do NOT assign fake fixed probabilities to patterns (no "이 패턴은 90% 상승", no "historical win rate 78%", no "10번 중 9번"). Those numbers are not statistically valid. Never cite a made-up per-pattern win rate.',
    '- Do NOT cite live news, fundamentals, or packet-macro prints (no TIPS, CPI, FOMC, earnings, yields, unemployment). That is another seat\'s job.',
    '- Do NOT compute a raw statistical base rate / hit-rate table and call that the answer. Pattern + precedent, not a calculator.',
    '',
    'Confidence: an integer 0–100 for how clearly the shape matches a known pattern and how applicable the precedent feels. That is YOUR judgment, not a claimed historical hit rate of the pattern. Never write "this pattern wins N% of the time".',
    '',
    'Visible output: brief pattern reasoning, then exactly ONE JSON line as the LAST line:',
    '{"direction":"up"|"down","probability":0-100,"rationale":"..."}',
    'direction is up or down only (never flat/abstain). For yes/no or above/below propositions, up = the first/affirmative side, down = the other.',
    'rationale: 1–2 sentences, max 400 characters, in the customer language of the proposition when it is Korean — name the pattern and the historical tendency. No fake win-rate percents.',
  ].join('\n')
}

export function buildHistoryUserPrompt(input: HistoryLeagueInput): string {
  assertHistoryInputShape(input)
  return [
    `PROPOSITION: ${input.proposition}`,
    `SUBJECT: ${input.subjectName}`,
    `INSTRUMENT: ${input.instrument}`,
    `HORIZON: ${input.horizon}`,
    `CATEGORY: ${input.category}`,
    '',
    'PRICE SERIES (shape only — dates and closes):',
    formatPriceSeriesForHistory(input),
    '',
    'Identify the pattern, state the historical tendency (no invented win rates), then output the JSON line.',
  ].join('\n')
}

export function historyRetryInstruction(): string {
  return [
    'RETRY: Rewrite as the 역사·패턴 seat.',
    'Name one pattern from the vocabulary. State the historical tendency in words.',
    'Do not cite news, TIPS, CPI, earnings, or yields. Do not invent a per-pattern win rate or "N% of the time".',
    'Last line must be JSON: {"direction":"up"|"down","probability":0-100,"rationale":"..."}.',
  ].join(' ')
}

export function findNamedHistoryPattern(text: string | null | undefined): string | null {
  if (!text) return null
  const lower = text.toLowerCase()
  for (const row of HISTORY_PATTERN_VOCABULARY) {
    for (const alias of row.aliases) {
      if (lower.includes(alias.toLowerCase())) return row.label
    }
  }
  return null
}

export function findHistoryNewsFundamentalLeak(text: string | null | undefined): string | null {
  if (!text) return null
  const lower = text.toLowerCase()
  for (const token of NEWS_FUNDAMENTAL_LEAKS) {
    if (lower.includes(token.toLowerCase())) return token
  }
  return null
}

export function findFakePatternWinRate(text: string | null | undefined): string | null {
  if (!text) return null
  for (const re of FAKE_WINRATE_RES) {
    const match = text.match(re)
    if (match) return match[0]
  }
  return null
}

export function historyRationaleNeedsRetry(rationale: string | null): boolean {
  if (!rationale) return true
  if (findFakePatternWinRate(rationale)) return true
  if (findHistoryNewsFundamentalLeak(rationale) && !findNamedHistoryPattern(rationale)) return true
  if (!findNamedHistoryPattern(rationale)) return true
  return false
}

/** Strip invented per-pattern win-rate clauses. Never invent a replacement percent. */
export function stripFakePatternWinRates(text: string): string {
  let out = text
  for (const re of FAKE_WINRATE_RES) {
    out = out.replace(re, '')
  }
  return out.replace(/\s{2,}/g, ' ').replace(/\s+([,.])/g, '$1').trim()
}

export function parseHistoryOutput(text: string | null): HistoryEngineOutput | null {
  const parsed = parsePrediction(text)
  if (!parsed?.direction) return null
  const rawRationale = parsed.rationale ?? sanitizeRationale(text)
  if (!rawRationale) return null
  const rationale = stripFakePatternWinRates(rawRationale).slice(0, 500)
  if (!rationale) return null
  return {
    verdict: parsed.direction,
    rationale,
    confidence: parsed.probability,
    namedPattern: findNamedHistoryPattern(rationale),
  }
}

export function leagueSideFromHistory(
  verdict: 'up' | 'down',
  propositionKind: string | null | undefined,
): AnswerSide {
  return leagueSideFromDivination(verdict, null, propositionKind)
}

export const HISTORY_NO_SERIES_REASON =
  '가격 시계열이 없어 차트 패턴을 읽을 수 없습니다. 역사·패턴 좌석은 가격 경로가 있을 때만 답합니다.'
