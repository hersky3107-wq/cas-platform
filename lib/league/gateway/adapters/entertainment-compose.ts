import { isUiHorizon, type UiHorizon } from '../../horizon'
import type { ComposedRound } from '../types'
import {
  decodeEntertainmentInstrument,
  formatShowProposition,
  propositionKindForShow,
  showResolutionRule,
  type ShowParts,
} from './entertainment-catalog'

export function horizonForShow(resolvesAtIso: string, now: Date): UiHorizon {
  const target = Date.parse(resolvesAtIso)
  if (!Number.isFinite(target)) return '1m'
  const days = Math.ceil((target - now.getTime()) / 86_400_000)
  if (days <= 2) return '1d'
  if (days <= 10) return '1w'
  if (days <= 45) return '1m'
  return '3m'
}

export function buildEntertainmentRankedRoundInput(
  instrument: string,
  uiHorizon?: UiHorizon,
  now: Date = new Date(),
): ComposedRound | null {
  const parts = decodeEntertainmentInstrument(instrument)
  if (!parts) return null
  const resolvesAt = new Date(parts.resolvesAtMs).toISOString()
  const horizon = uiHorizon && isUiHorizon(uiHorizon) ? uiHorizon : horizonForShow(resolvesAt, now)
  const kind = propositionKindForShow(parts)
  return {
    proposition_text: formatShowProposition(parts),
    category: 'entertainment_awards',
    instrument,
    horizon,
    resolution_rule: showResolutionRule(parts),
    resolves_at: resolvesAt,
    item_type: 'ranked',
    cache_key: `entertainment|${instrument}`,
    proposition_kind: kind,
    subject_label: parts.subject,
    observation_shape: kind === 'binary_threshold' ? 'occurrence' : 'name_match',
  }
}

export function showPartsOf(instrument: string): ShowParts | null {
  return decodeEntertainmentInstrument(instrument)
}
