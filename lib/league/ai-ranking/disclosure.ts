/**
 * Display scrub for `ai_models` cards. Raw Elo / score figures are packet
 * input only — they must not appear in user-visible rationales or deep copy.
 */

import { stripSelfVendorMarkers } from './self-vendor'

const SCRUB_CATEGORIES = new Set(['ai_models'])

export function scrubsAirankDisclosure(category: string | null | undefined): boolean {
  return SCRUB_CATEGORIES.has((category ?? '').trim().toLowerCase())
}

const ELO_PATTERNS: readonly RegExp[] = [
  // Comparisons: ~1582 vs ~1500, 1552>1543, 1552 > 1543, 1552 vs 1543, ~1552 대비 ~1500
  /\(?~?\d{3,4}(?:\.\d+)?\s*(?:vs\.?|>|<|>=|<=|대비)\s*~?\d{3,4}(?:\.\d+)?\)?/gi,
  // Elo prefix/suffix: Elo 1450, Elo: 1450, 1450 Elo, ~1450 Elo, 엘로 1450
  /(?:(?:\b(?:Elo|ELO)|(?:^|[^\w가-힣])엘로))\s*[:\-~]?\s*~?\d{3,4}(?:\.\d+)?(?=$|[^\w가-힣])/gi,
  /~?\d{3,4}(?:\.\d+)?\s*(?:\b(?:Elo|ELO)|엘로)(?=$|[^\w가-힣])/gi,
  // Score prefix/suffix: score 1,312, score: 1312, 점수 1,312, 점수 1312
  /(?:(?:\bscore|(?:^|[^\w가-힣])점수))\s*[:\-~]?\s*~?(?:\d{1,3}(?:,\d{3})+|\d{3,5})(?:\.\d+)?(?=$|[^\w가-힣])/gi,
  /(?:\d{1,3}(?:,\d{3})+|\d{3,5})(?:\.\d+)?\s*(?:\bscore|점수)(?=$|[^\w가-힣])/gi,
  // self_vendor leak
  /\bself_vendor\b[^\n]*/gi,
]

export function scrubAirankDisclosure(text: string | null | undefined): string | null {
  const stripped = stripSelfVendorMarkers(text)
  if (typeof stripped !== 'string') return null
  let out = stripped
  for (const re of ELO_PATTERNS) {
    out = out.replace(re, '')
  }
  out = out
    .replace(/\(\s*\)/g, '')
    .replace(/\[\s*\]/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
  return out.trim() || null
}
