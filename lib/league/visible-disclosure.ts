/**
 * One display-layer pass for user-visible league text. Sports book/odds and
 * equity flow/analyst/broker/outlet figures are model input. Apply this to
 * stored rationales, translations, extra seats, scouts, and deep output —
 * never to the packet.
 */

import { scrubAnalystDisclosure, scrubsAnalystDisclosure } from './analyst-disclosure'
import { scrubAirankDisclosure, scrubsAirankDisclosure } from './ai-ranking/disclosure'
import { scrubSportsDisclosure, scrubsSportsDisclosure } from './sports-disclosure'

export const COMMON_TLDS =
  'com|org|net|io|ai|co|kr|me|app|xyz|dev|info|biz|cc|tv|so|ca|uk|jp|cn|de|fr|edu|gov|ly|us'

/** Strip citation markers like [1], [14], [1-3], 【1】, 【출처】 across ALL categories. */
export function scrubCitationMarkers(text: string): string {
  return text
    .replace(/\[\d+(?:[,\s–-]+\d+)*\]/g, '')
    .replace(/【[^】]+】/g, '')
    .replace(/\[(?:출처|source|citation|ref|reference)[:\s][^\]]*\]/gi, '')
}

/** Strip markdown link residue like [](/foo), [foo](http://...), and raw URLs. */
export function scrubLinkResidue(text: string): string {
  return text
    // Empty markdown links: [](/...) or [](url)
    .replace(/\[\s*\]\([^)]*\)/g, '')
    // Markdown links with text: [text](url) -> text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    // Raw URLs: https://... or http://...
    .replace(/https?:\/\/[^\s)\]]+/gi, '')
}

/** Strip bare and parenthesized web domains like (benchleader.com), benchleader.com. */
export function scrubDomains(text: string): string {
  // Parenthesized domains: (benchleader.com), (www.lmarena.ai/leaderboard)
  const parenDomainRe = new RegExp(
    `\\(\\s*(?:https?:\\/\\/)?(?:www\\.)?[a-zA-Z0-9][-a-zA-Z0-9]*(?:\\.[a-zA-Z0-9][-a-zA-Z0-9]*)*\\.(?:${COMMON_TLDS})(?:\\/[^\\s)\\]]*)?\\s*\\)`,
    'gi',
  )
  // Bare domains: benchleader.com, lmarena.ai (ensure not part of email or model number like gpt-4.5)
  const bareDomainRe = new RegExp(
    `(?<![@\\w./])(?:www\\.)?[a-zA-Z0-9][-a-zA-Z0-9]*(?:\\.[a-zA-Z0-9][-a-zA-Z0-9]*)*\\.(?:${COMMON_TLDS})(?:\\/[^\\s)\\]]*)?`,
    'gi',
  )
  return text.replace(parenDomainRe, '').replace(bareDomainRe, '')
}

/** Generic display scrub applied to ALL categories. */
export function scrubGenericDisclosure(text: string | null | undefined): string | null {
  if (typeof text !== 'string') return null
  let out = text
  out = scrubCitationMarkers(out)
  out = scrubLinkResidue(out)
  out = scrubDomains(out)
  return out || null
}

export function visibleLeagueText(
  category: string | null | undefined,
  text: string | null | undefined,
): string | null {
  if (typeof text !== 'string') return null
  let out: string | null = text
  if (scrubsSportsDisclosure(category)) {
    out = scrubSportsDisclosure(out)
  }
  if (scrubsAnalystDisclosure(category)) {
    out = scrubAnalystDisclosure(out)
  }
  if (scrubsAirankDisclosure(category)) {
    out = scrubAirankDisclosure(out)
  }
  out = scrubGenericDisclosure(out)
  return out
}

const DEEP_SKIP_KEYS = new Set(['instrument', 'category', 'horizon', 'outputLanguage', 'roleId', 'provider'])

function scrubDeepValue(category: string, key: string, value: unknown): unknown {
  if (DEEP_SKIP_KEYS.has(key)) return value
  if (typeof value === 'string') return visibleLeagueText(category, value)
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
export function scrubVisibleDeepState(state: Record<string, unknown>): Record<string, unknown> {
  const category = typeof state.category === 'string' ? state.category : ''
  return scrubDeepValue(category, '', state) as Record<string, unknown>
}
