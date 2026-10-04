/**
 * One display-layer pass for user-visible league text. Sports book/odds and
 * equity flow/analyst/broker/outlet figures are model input. Apply this to
 * stored rationales, translations, extra seats, scouts, and deep output —
 * never to the packet.
 */

import { scrubAnalystDisclosure, scrubsAnalystDisclosure } from './analyst-disclosure'
import { scrubAirankDisclosure, scrubsAirankDisclosure } from './ai-ranking/disclosure'
import { scrubSportsDisclosure, scrubsSportsDisclosure } from './sports-disclosure'

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
  if (!scrubsSportsDisclosure(category) && !scrubsAnalystDisclosure(category) && !scrubsAirankDisclosure(category)) {
    return state
  }
  return scrubDeepValue(category, '', state) as Record<string, unknown>
}
