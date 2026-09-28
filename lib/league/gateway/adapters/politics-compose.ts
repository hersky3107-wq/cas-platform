import { isUiHorizon, type UiHorizon } from '../../horizon'
import type { ComposedRound } from '../types'
import {
  decodePoliticsInstrument,
  formatElectionProposition,
  raceTitle,
  type PoliticsInstrumentParts,
} from './politics-catalog'

export function horizonForPollClose(pollCloseIso: string, now: Date): UiHorizon {
  const target = Date.parse(pollCloseIso)
  if (!Number.isFinite(target)) return '1m'
  const days = Math.ceil((target - now.getTime()) / 86_400_000)
  if (days <= 2) return '1d'
  if (days <= 10) return '1w'
  if (days <= 45) return '1m'
  return '3m'
}

export function politicsResolutionRule(parts: PoliticsInstrumentParts): string {
  return (
    `Official certified result of ${raceTitle(parts)}. ` +
    `${parts.candidate} is elected to that office = Yes. ` +
    `Any other certified winner, a failed runoff, or the candidate not taking office = No. ` +
    `Graded manually from the electoral authority's published result. ` +
    `Not a poll and not a wager.`
  )
}

export function buildPoliticsRankedRoundInput(
  instrument: string,
  uiHorizon?: UiHorizon,
  now: Date = new Date(),
): ComposedRound | null {
  const parts = decodePoliticsInstrument(instrument)
  if (!parts) return null
  const pollCloseIso = new Date(parts.pollCloseMs).toISOString()
  const horizon = uiHorizon && isUiHorizon(uiHorizon) ? uiHorizon : horizonForPollClose(pollCloseIso, now)
  return {
    proposition_text: formatElectionProposition(parts),
    category: 'politics_election',
    instrument,
    horizon,
    resolution_rule: politicsResolutionRule(parts),
    resolves_at: pollCloseIso,
    item_type: 'ranked',
    cache_key: `politics|${instrument}`,
    proposition_kind: 'binary_subject_outcome',
    subject_label: parts.candidate,
    observation_shape: 'name_match',
  }
}
