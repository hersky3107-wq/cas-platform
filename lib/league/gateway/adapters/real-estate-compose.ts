import { isUiHorizon, type UiHorizon } from '../../horizon'
import type { ComposedRound } from '../types'
import {
  decodePropertyInstrument,
  formatPropertyProposition,
  propertyResolutionRule,
  propositionKindForProperty,
} from './real-estate-catalog'

export function horizonForProperty(resolvesAtIso: string, now: Date): UiHorizon {
  const target = Date.parse(resolvesAtIso)
  if (!Number.isFinite(target)) return '1m'
  const days = Math.ceil((target - now.getTime()) / 86_400_000)
  if (days <= 2) return '1d'
  if (days <= 10) return '1w'
  if (days <= 45) return '1m'
  return '3m'
}

export function buildRealEstateRankedRoundInput(
  instrument: string,
  uiHorizon?: UiHorizon,
  now: Date = new Date(),
): ComposedRound | null {
  const parts = decodePropertyInstrument(instrument)
  if (!parts) return null
  const resolvesAt = new Date(parts.resolvesAtMs).toISOString()
  const horizon = uiHorizon && isUiHorizon(uiHorizon) ? uiHorizon : horizonForProperty(resolvesAt, now)
  const kind = propositionKindForProperty(parts)
  return {
    proposition_text: formatPropertyProposition(parts),
    category: 'real_estate',
    instrument,
    horizon,
    resolution_rule: propertyResolutionRule(parts),
    resolves_at: resolvesAt,
    item_type: 'ranked',
    cache_key: `property|${instrument}`,
    proposition_kind: kind,
    subject_label: parts.region.nameKo,
    observation_shape: kind === 'binary_threshold' ? 'occurrence' : 'name_match',
  }
}
