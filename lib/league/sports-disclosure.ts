/**
 * Sports market data (bookmaker identity / raw odds) is a closed-book MODEL
 * INPUT. User-visible text — card rationales, deep commentary, translations —
 * must not name a book or quote a betting price. The packet / admin grade
 * page may still keep bookKey + bookTitle for operators.
 */

const SCRUB_CATEGORIES = new Set(['sports'])

export function scrubsSportsDisclosure(category: string | null | undefined): boolean {
  return SCRUB_CATEGORIES.has((category ?? '').trim().toLowerCase())
}

/**
 * Bookmaker keys/titles that appear in our Odds API fixtures/code, plus the
 * common books that model search will name even when we did not store them.
 */
const BOOKMAKER_NAMES = [
  'Pinnacle',
  'DraftKings',
  'Draft Kings',
  'FanDuel',
  'Fan Duel',
  'Bet365',
  'Bet 365',
  'BetMGM',
  'Bet MGM',
  'Caesars',
  'William Hill',
  'Betfair Exchange',
  'Betfair',
  'Unibet',
  'Bovada',
  '1xBet',
  '1x Bet',
  'Matchbook',
  'Smarkets',
  '888sport',
  '888 sport',
] as const

const BOOKMAKER_KEYS = [
  'pinnacle',
  'draftkings',
  'fanduel',
  'bet365',
  'betmgm',
  'caesars',
  'williamhill',
  'betfair_ex_eu',
  'betfair_ex_uk',
  'betfair',
  'unibet',
  'bovada',
  'onexbet',
  '1xbet',
  'matchbook',
  'smarkets',
  '888sport',
] as const

function escapeRe(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function bookmakerPattern(): RegExp {
  const titles = BOOKMAKER_NAMES.map((name) =>
    name
      .split(/\s+/)
      .map(escapeRe)
      .join('\\s+'),
  )
  const keys = BOOKMAKER_KEYS.map((key) => escapeRe(key))
  const parts = [...titles, ...keys].sort((a, b) => b.length - a.length)
  return new RegExp(`\\b(?:${parts.join('|')})\\b`, 'gi')
}

const BOOKMAKER_RE = bookmakerPattern()

const ODDS_CTX = String.raw`(?:odds|line|moneyline|price|배당|오즈)`

const RULES: Array<[RegExp, string]> = [
  [BOOKMAKER_RE, ''],
  // Decimal odds: @2.10, @1.85
  [/@\s*\d+(?:\.\d+)?/g, ''],
  // Decimal odds next to an odds-context word (do not strip 57% or xG 1.85 alone)
  [new RegExp(String.raw`${ODDS_CTX}\s*[:=]?\s*\d{1,2}\.\d{1,2}\b`, 'gi'), ''],
  [new RegExp(String.raw`\b\d{1,2}\.\d{1,2}\s+${ODDS_CTX}`, 'gi'), ''],
  // American odds next to context: line -140, odds +150
  [new RegExp(String.raw`${ODDS_CTX}\s*[:=]?\s*[+-]\d{3,4}\b`, 'gi'), ''],
  [new RegExp(String.raw`[+-]\d{3,4}\s+${ODDS_CTX}`, 'gi'), ''],
  // Fractional odds next to context: 5/2 (not scores like 3-1)
  [new RegExp(String.raw`${ODDS_CTX}\s*[:=]?\s*\d{1,2}\s*/\s*\d{1,2}\b`, 'gi'), ''],
  [new RegExp(String.raw`\b\d{1,2}\s*/\s*\d{1,2}\s+${ODDS_CTX}`, 'gi'), ''],
]

export function scrubSportsDisclosure(text: string | null | undefined): string | null {
  if (typeof text !== 'string') return null
  let out = text
  for (const [re, rep] of RULES) out = out.replace(re, rep)
  out = out.replace(/[ \t]{2,}/g, ' ').replace(/\s+([,.;:)])/g, '$1').replace(/\(\s*\)/g, '').trim()
  return out || null
}

/** Apply the sports scrub when the round category is sports; otherwise pass through. */
export function sportsVisibleText(
  category: string | null | undefined,
  text: string | null | undefined,
): string | null {
  if (typeof text !== 'string') return null
  if (!scrubsSportsDisclosure(category)) return text
  return scrubSportsDisclosure(text)
}

const DEEP_SKIP_KEYS = new Set(['instrument', 'category', 'horizon', 'outputLanguage', 'roleId', 'provider'])

function scrubDeepValue(category: string, key: string, value: unknown): unknown {
  if (DEEP_SKIP_KEYS.has(key)) return value
  if (typeof value === 'string') return sportsVisibleText(category, value)
  if (Array.isArray(value)) return value.map((item) => scrubDeepValue(category, key, item))
  if (value && typeof value === 'object') {
    const next: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      next[k] = scrubDeepValue(category, k, v)
    }
    return next
  }
  return value
}

/** Scrub user-visible strings on a deep-open / deep-debate state blob before persist or return. */
export function scrubSportsDeepState(state: Record<string, unknown>): Record<string, unknown> {
  const category = typeof state.category === 'string' ? state.category : ''
  if (!scrubsSportsDisclosure(category)) return state
  return scrubDeepValue(category, '', state) as Record<string, unknown>
}
