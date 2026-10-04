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
  /\b\d{3,4}(?:\.\d+)?\s*Elo\b/gi,
  /\bElo\s*[:\-]?\s*\d{3,4}(?:\.\d+)?\b/gi,
  /\bscore\s*[:\-]?\s*\d{1,3}(?:,\d{3})+(?:\.\d+)?\b/gi,
  /\bscore\s*[:\-]?\s*\d{3,5}(?:\.\d+)?\b/gi,
  /\bself_vendor\b[^\n]*/gi,
]

export function scrubAirankDisclosure(text: string | null | undefined): string | null {
  const stripped = stripSelfVendorMarkers(text)
  if (typeof stripped !== 'string') return null
  let out = stripped
  for (const re of ELO_PATTERNS) {
    out = out.replace(re, '').replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n')
  }
  return out.trim() || null
}
