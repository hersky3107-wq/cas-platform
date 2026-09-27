/**
 * Korea 국민체육진흥법 — sports (and any category) prompts that are framed
 * as betting cannot be opened. Detects 토토 / 배당률 / 핸디캡 / 베팅 /
 * 오버언더 / 픽 and the English equivalents. Never treats 배당 alone as a
 * hit: that token is the Korean word for a stock dividend.
 *
 * Pure. No I/O. Used by the sports adapter on the raw mention AND by the
 * gateway shell as a hard-stop when the adapter emits `betting_framing`.
 */

const BETTING_RES: readonly RegExp[] = [
  /토토/,
  /스포츠토토/,
  /배당률/,
  /핸디캡/,
  /베팅/,
  /배팅/,
  /오버언더/,
  /언더오버/,
  /프로토/,
  /폴더/,
  /마권/,
  /도박/,
  /픽스터/,
  /조합픽/,
  /축구픽/,
  /경기픽/,
  /오늘의픽/,
  /(?:^|[^\w가-힣])픽(?:$|[^\w가-힣])/,
  /\bbetting\b/i,
  /\bbetfair\b/i,
  /\bhandicap\b/i,
  /\bparlay\b/i,
  /\bspread\b/i,
  /\btoto\b/i,
  /over[\s/_-]?under/i,
]

export function detectBettingFraming(raw: string | null | undefined): boolean {
  if (!raw) return false
  const text = raw.trim()
  if (!text) return false
  for (const re of BETTING_RES) {
    if (re.test(text)) return true
  }
  return false
}
