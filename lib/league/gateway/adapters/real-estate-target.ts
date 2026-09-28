import type { ClarifyingQuestion } from '../types'
import {
  decodePropertyInstrument,
  instrumentForRegion,
  isBrokerageAsk,
  isDongOrComplex,
  matchPropertyRegion,
  parseMomThresholdBp,
  propertyClarifyOptions,
} from './real-estate-catalog'
import type { PropertyRegion } from './real-estate-regions'

export type PropertyHit =
  | { kind: 'ready'; entityId: string; label: string }
  | { kind: 'picks'; options: Array<{ id: string; label: string }> }
  | { kind: 'specific_property' }
  | { kind: 'brokerage_advice' }
  | { kind: 'past' }
  | { kind: 'reit' }

const REIT = /^(vnq|schh|뱅가드리츠|슈왑리츠)$/i

export function resolvePropertyTarget(raw: string, now: Date): PropertyHit {
  const text = raw.trim()
  if (!text) return { kind: 'picks', options: propertyClarifyOptions(now) }
  if (isBrokerageAsk(text)) return { kind: 'brokerage_advice' }
  if (isDongOrComplex(text)) return { kind: 'specific_property' }
  if (REIT.test(text.replace(/\s+/g, ''))) return { kind: 'reit' }

  const decoded = decodePropertyInstrument(text)
  if (decoded) {
    if (decoded.resolvesAtMs <= now.getTime()) return { kind: 'past' }
    return { kind: 'ready', entityId: text, label: decoded.region.nameKo }
  }

  const thresholdBp = parseMomThresholdBp(text)
  const matched = matchPropertyRegion(text)
  if (!matched) return { kind: 'picks', options: propertyClarifyOptions(now) }
  if (Array.isArray(matched)) {
    return {
      kind: 'picks',
      options: matched.map((row) => ({
        id: instrumentForRegion(row, text, thresholdBp, now),
        label: row.nameKo,
      })),
    }
  }
  return ready(matched, text, thresholdBp, now)
}

function ready(region: PropertyRegion, text: string, thresholdBp: number | null, now: Date): PropertyHit {
  return {
    kind: 'ready',
    entityId: instrumentForRegion(region, text, thresholdBp, now),
    label: region.nameKo,
  }
}

export function propertyPickQuestion(options: Array<{ id: string; label: string }>): ClarifyingQuestion {
  return {
    slot: 'entity_id',
    prompt_i18n_key: 'league.gateway.clarify.entity',
    allow_free_input: true,
    options: options.map((option) => ({
      id: option.id,
      label_i18n_key: 'league.gateway.clarify.entity',
      label: option.label,
    })),
  }
}
