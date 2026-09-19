/**
 * Parser for the single-reader 4–5 line rationale.
 *
 * Market-language ban lives HERE, not only in the prompt — prompt-only
 * locks have failed in this repo (prism length lock). A violation is a
 * parse miss so the adapter retries once, then falls back to code prose.
 *
 * The reader must not decide the verdict. Opposite-direction keywords
 * against the code ballot are also a parse miss.
 */
import { extractJsonObject } from '../ai/parse-layer1'
import {
  LEAGUE_READER_LINE_MAX,
  LEAGUE_READER_LINE_MIN,
  LEAGUE_READER_RATIONALE_MAX_CHARS,
} from './conventions'
import type { LeagueBinaryVote } from './types'
import { isPlusVote } from './yongshen'

/** User-specified ban + English equivalents. Matched case-insensitively. */
export const MARKET_LANGUAGE_BAN: readonly string[] = [
  '시세',
  '가격',
  '차트',
  '거래량',
  '뉴스',
  '실적',
  '금리',
  '시장',
  '전망',
  '투자',
  'price',
  'volume',
  'news',
  'chart',
  'market',
  'outlook',
  'invest',
  'earnings',
  'fundamentals',
  'ticker',
]

const PLUS_KEYWORDS = ['상승', '오름', '오를', '이기', '이길', '유리', '세효', '길한', '강하'] as const
const MINUS_KEYWORDS = ['하락', '내림', '내릴', '지다', '질 것', '불리', '응효', '흉한', '약하'] as const

export type ReaderParseOk = { ok: true; rationale: string }
export type ReaderParseFail = {
  ok: false
  reason: 'empty' | 'line_count' | 'too_long' | 'market_language' | 'direction_mismatch' | 'customer_abstention'
  detail?: string
}

/** Customer-facing ban — 결번 / voter-roll wording must never render. */
export const CUSTOMER_ABSTENTION_BAN: readonly string[] = [
  '결번',
  '말을 아낌',
  '말을 아꼈',
  '표를 냄',
  '표를 낸',
  '홀로 표를',
  'ichingalone',
  'voter roll',
  'voterroll',
]

export function findCustomerAbstention(text: string): string | null {
  const lower = text.toLowerCase()
  for (const word of CUSTOMER_ABSTENTION_BAN) {
    if (lower.includes(word.toLowerCase())) return word
  }
  return null
}
export type ReaderParseResult = ReaderParseOk | ReaderParseFail

function extractRationale(raw: string): string {
  const trimmed = raw.trim()
  const json = extractJsonObject(trimmed)
  if (json) {
    try {
      const parsed = JSON.parse(json) as { rationale?: unknown; text?: unknown }
      if (typeof parsed.rationale === 'string') return parsed.rationale.replace(/\*\*/g, '').trim()
      if (typeof parsed.text === 'string') return parsed.text.replace(/\*\*/g, '').trim()
    } catch {
      /* fall through to plain text */
    }
  }
  return trimmed.replace(/\*\*/g, '').trim()
}

export function rationaleLineCount(text: string): number {
  return text
    .split(/\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0).length
}

export function findMarketLanguage(text: string): string | null {
  const lower = text.toLowerCase()
  for (const word of MARKET_LANGUAGE_BAN) {
    if (lower.includes(word.toLowerCase())) return word
  }
  return null
}

function affirms(text: string, keywords: readonly string[]): boolean {
  return keywords.some((word) => text.includes(word))
}

export function parseLeagueReaderRationale(raw: string, codeVote: LeagueBinaryVote): ReaderParseResult {
  const rationale = extractRationale(raw)
  if (!rationale) return { ok: false, reason: 'empty' }

  const lines = rationaleLineCount(rationale)
  if (lines < LEAGUE_READER_LINE_MIN || lines > LEAGUE_READER_LINE_MAX) {
    return { ok: false, reason: 'line_count', detail: String(lines) }
  }
  if ([...rationale].length > LEAGUE_READER_RATIONALE_MAX_CHARS) {
    return { ok: false, reason: 'too_long', detail: String([...rationale].length) }
  }

  const banned = findMarketLanguage(rationale)
  if (banned) return { ok: false, reason: 'market_language', detail: banned }

  const abstention = findCustomerAbstention(rationale)
  if (abstention) return { ok: false, reason: 'customer_abstention', detail: abstention }

  const plus = isPlusVote(codeVote)
  const hasPlus = affirms(rationale, PLUS_KEYWORDS)
  const hasMinus = affirms(rationale, MINUS_KEYWORDS)
  if (plus && hasMinus && !hasPlus) return { ok: false, reason: 'direction_mismatch' }
  if (!plus && hasPlus && !hasMinus) return { ok: false, reason: 'direction_mismatch' }

  return { ok: true, rationale }
}
