/**
 * Analyst data (price_target / recommendations / eps_trend / earnings /
 * statistics) is a closed-book MODEL INPUT for equity rounds. The rationale a
 * model writes is shown on the card, so vendor attribution and raw analyst
 * figures are scrubbed from it before it is stored. The packet itself keeps
 * the full numbers.
 */

const SCRUB_CATEGORIES = new Set(['stock', 'etf_index'])

export function scrubsAnalystDisclosure(category: string | null | undefined): boolean {
  return SCRUB_CATEGORIES.has((category ?? '').trim().toLowerCase())
}

const NUM = String.raw`[$€£¥₩]?\s?\d[\d,]*(?:\.\d+)?(?:\s?(?:USD|달러|원)|%)?`

const RULES: Array<[RegExp, string]> = [
  // "(source: Twelve Data /price_target; as-of …)" and bare vendor mentions
  [/\(\s*(?:source:\s*)?twelve\s*data[^)]*\)/gi, ''],
  [/\b(?:according to|per|from|via)\s+twelve\s*data\b,?\s*/gi, ''],
  [/\btwelve\s*data(?:'s)?\b/gi, 'consensus data'],
  [/\/(?:price_target|recommendations|eps_trend|earnings|statistics|analyst_ratings(?:\/light)?)\b/gi, ''],
  // "hi 400 / median 335 / lo 215" target ranges
  [new RegExp(String.raw`\b(?:hi(?:gh)?|median|lo(?:w)?|avg|average|mean)\s*:?\s*${NUM}(?:\s*/\s*(?:hi(?:gh)?|median|lo(?:w)?|avg|average|mean)\s*:?\s*${NUM})+`, 'gi'), 'analyst range'],
  // "price target of $315", "target $315", "목표가 315달러", "목표주가는 315"
  [new RegExp(String.raw`((?:consensus\s+|street\s+|analyst\s+|median\s+|average\s+|mean\s+)?(?:price\s+)?targets?|목표\s?주?가)(\s*(?:는|은|이|가)?\s*(?:of|at|is|near|around|~|≈|=|:)?\s*)${NUM}`, 'gi'), '$1'],
  // "25 buy / 14 hold / 3 sell", "6 strong_buy"
  [/\b\d+\s*(strong[_ ]buy|strong[_ ]sell|buys?|holds?|sells?|outperforms?|underperforms?)\b/gi, '$1'],
  // "trailing PE 45.2", "P/B 12", "EPS estimate 1.97"
  [new RegExp(String.raw`\b((?:trailing\s+|forward\s+)?(?:p\/?e|pe ratio|p\/?b|price[- ]to[- ](?:book|earnings)|eps(?:\s+(?:estimate|trend|actual))?))(\s*(?:of|at|is|=|:|~)?\s*)${NUM}`, 'gi'), '$1'],
]

export function scrubAnalystDisclosure(text: string | null | undefined): string | null {
  if (typeof text !== 'string') return null
  let out = text
  for (const [re, rep] of RULES) out = out.replace(re, rep)
  out = out.replace(/[ \t]{2,}/g, ' ').replace(/\s+([,.;:)])/g, '$1').replace(/\(\s*\)/g, '').trim()
  return out || null
}
