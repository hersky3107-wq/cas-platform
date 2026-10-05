import type { ClarifyingQuestion } from '../types'
import {
  compactPropertyQuery,
  decodePropertyInstrument,
  instrumentForRegion,
  isBrokerageAsk,
  isDongOrComplex,
  isExplicitBroadAsk,
  matchPropertyRegion,
  parseMomThresholdBp,
  propertyClarifyOptions,
} from './real-estate-catalog'
import { isOfficialHousingRegion } from '../../real-estate/supported'
import { broadPickLabel, broadPropertyChildren, type PropertyRegion } from './real-estate-regions'

/** Seoul 구 + 20-city Case-Shiller + 시도. Higher than sports fixture cap. */
export const MAX_PROPERTY_PICKS = 28

export type PropertyHit =
  | { kind: 'ready'; entityId: string; label: string }
  | { kind: 'picks'; options: Array<{ id: string; label: string }> }
  | { kind: 'specific_property' }
  | { kind: 'brokerage_advice' }
  | { kind: 'past' }
  | { kind: 'reit' }
  | { kind: 'index_discontinued' }
  | { kind: 'index_unsupported' }

const REIT = /^(vnq|schh|뱅가드리츠|슈왑리츠)$/i

export function resolvePropertyTarget(raw: string, now: Date): PropertyHit {
  const text = raw.trim()
  if (!text) return { kind: 'picks', options: openClarifyOptions(now) }
  if (isBrokerageAsk(text)) return { kind: 'brokerage_advice' }
  if (isDongOrComplex(text)) return { kind: 'specific_property' }
  if (REIT.test(text.replace(/\s+/g, ''))) return { kind: 'reit' }

  const decoded = decodePropertyInstrument(text)
  if (decoded) {
    if (!isOfficialHousingRegion(decoded.region)) return closed(decoded.region)
    if (decoded.resolvesAtMs <= now.getTime()) return { kind: 'past' }
    return { kind: 'ready', entityId: text, label: decoded.region.nameKo }
  }

  const thresholdBp = parseMomThresholdBp(text)
  const matched = matchPropertyRegion(text)
  if (!matched) return { kind: 'picks', options: openClarifyOptions(now) }
  if (!Array.isArray(matched) && !isOfficialHousingRegion(matched)) return closed(matched)
  if (Array.isArray(matched)) {
    const open = matched.filter((row) => isOfficialHousingRegion(row))
    if (open.length === 0) return closed(matched[0] ?? { country: 'AU', tier: 'official' })
    return {
      kind: 'picks',
      options: open.map((row) => ({
        id: instrumentForRegion(row, text, thresholdBp, now),
        label: row.nameKo,
      })),
    }
  }
  const compact = compactPropertyQuery(text)
  if (!isExplicitBroadAsk(compact)) {
    const children = broadPropertyChildren(matched)
    if (children && children.length > 1) {
      return {
        kind: 'picks',
        options: children.map((row) => ({
          id: instrumentForRegion(row, text, thresholdBp, now),
          label: broadPickLabel(row, matched),
        })),
      }
    }
  }
  return ready(matched, text, thresholdBp, now)
}

function closed(region: Pick<PropertyRegion, 'country' | 'tier'>): PropertyHit {
  return region.country === 'AU' ? { kind: 'index_discontinued' } : { kind: 'index_unsupported' }
}

function openClarifyOptions(now: Date) {
  return propertyClarifyOptions(now).filter((option) => {
    const decoded = decodePropertyInstrument(option.id)
    return decoded ? isOfficialHousingRegion(decoded.region) : false
  })
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
