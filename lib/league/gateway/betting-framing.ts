/**
 * Korea 국민체육진흥법 — sports (and any category) prompts that are framed
 * as betting cannot be opened. Detects 토토 / 배당률 / 핸디캡 / 베팅 /
 * 오버언더 / 픽 and the English equivalents. Never treats 배당 alone as a
 * hit: that token is the Korean word for a stock dividend.
 *
 * Ambiguous parlay slang (폴더 / 단폴 / 다폴더) matches only as a whole
 * token, and only with betting context or in sports/politics. Product words
 * (폴더블, Galaxy Z Fold, foldable) are masked first so a hub example like
 * "3단 폴더블" is not a hit.
 *
 * Pure. No I/O. Used by the sports adapter on the raw mention AND by the
 * gateway shell as a hard-stop when the adapter emits `betting_framing`.
 */

const PRODUCT_MASK =
  /폴더블(?:폰)?|트라이폴드|트라이[\s-]*폴드|갤럭시\s*Z?\s*폴드\d*|Galaxy\s+(?:Z\s+)?Fold\d*|\bfoldable\b|\bZ\s*Fold\d*\b/gi

const ALWAYS_RES: readonly RegExp[] = [
  /토토/,
  /스포츠토토/,
  /배당률/,
  /핸디캡/,
  /베팅/,
  /배팅/,
  /오버언더/,
  /언더오버/,
  /프로토/,
  /마권/,
  /도박/,
  /픽스터/,
  /조합픽/,
  /축구픽/,
  /경기픽/,
  /오늘의픽/,
  /(?:^|[^\w가-힣])픽(?:$|[^\w가-힣])/,
  /승부식/,
  /\bbetting\b/i,
  /\bbetfair\b/i,
  /\bhandicap\b/i,
  /\bparlay\b/i,
  /\bspread\b/i,
  /\btoto\b/i,
  /over[\s/_-]?under/i,
]

const SLANG_TOKENS = ['다폴더', '단폴더', '다폴', '단폴', '폴더'] as const

const BETTING_CONTEXT =
  /배당|베팅|배팅|토토|픽스터|조합픽|축구픽|경기픽|오늘의픽|(?:^|[^\w가-힣])픽(?:$|[^\w가-힣])|승부식|오즈|\bodds\b|\bparlay\b|\bbet(?:ting|fair)?\b/i

const SLANG_OPEN_CATEGORIES = new Set(['sports', 'politics', 'politics_election'])

export type BettingFramingOpts = {
  /** Ledger or public category. Sports/politics may treat parlay slang as a hit. */
  category?: string | null
}

export function detectBettingFraming(
  raw: string | null | undefined,
  opts?: BettingFramingOpts,
): boolean {
  if (!raw) return false
  const text = raw.trim()
  if (!text) return false
  for (const re of ALWAYS_RES) {
    if (re.test(text)) return true
  }
  const masked = text.replace(PRODUCT_MASK, ' ')
  if (!hasSlangToken(masked)) return false
  if (opts?.category && SLANG_OPEN_CATEGORIES.has(opts.category)) return true
  return BETTING_CONTEXT.test(text)
}

function hasSlangToken(text: string): boolean {
  for (const term of SLANG_TOKENS) {
    const re = new RegExp(`(?:^|[^\\w가-힣])${term}(?:$|[^\\w가-힣])`, 'i')
    if (re.test(text)) return true
  }
  return false
}
