/**
 * Sports dual-display math — AI ensemble win probability vs market baseline.
 * Pure. No gambling-term copy lives here; chrome is in the i18n dictionary.
 */

import type { ConsensusSummary } from './card-types'

export type SportsFractureKind = 'iron' | 'soft' | 'warn' | 'none'

/** "철벽" only when the weighted confidence is this high. */
export const IRON_MIN_CONFIDENCE_PCT = 70

export type SportsMarketView = {
  ensembleWinPct: number | null
  marketBaselinePct: number | null
  divergencePp: number | null
  agreementPct: number | null
  fracture: SportsFractureKind
}

export function ensembleSubjectWinPct(
  consensus: Pick<ConsensusSummary, 'aggregateDirection' | 'aggregateProbability'>,
): number | null {
  const p = consensus.aggregateProbability
  if (p == null || !Number.isFinite(p)) return null
  const dir = consensus.aggregateDirection
  if (dir === 'yes' || dir === 'up' || dir === 'above') return round1(p)
  if (dir === 'no' || dir === 'down' || dir === 'below') return round1(100 - p)
  return round1(p)
}

export function agreementPctOf(
  consensus: Pick<ConsensusSummary, 'tally' | 'respondedModels'>,
): number | null {
  const responded = consensus.respondedModels
  if (!responded || responded <= 0) return null
  const a = Math.max(consensus.tally.up, consensus.tally.down)
  return round1((a / responded) * 100)
}

export function fractureFromAgreement(
  agreementPct: number | null,
  confidencePct?: number | null,
): SportsFractureKind {
  if (agreementPct == null) return 'none'
  if (agreementPct > 85) {
    if (confidencePct == null || confidencePct >= IRON_MIN_CONFIDENCE_PCT) return 'iron'
    return 'soft'
  }
  if (agreementPct >= 45 && agreementPct <= 55) return 'warn'
  return 'none'
}

export function buildSportsMarketView(args: {
  consensus: ConsensusSummary
  marketBaselinePct: number | null
}): SportsMarketView {
  const ensembleWinPct = ensembleSubjectWinPct(args.consensus)
  const marketBaselinePct =
    args.marketBaselinePct != null && Number.isFinite(args.marketBaselinePct)
      ? round1(args.marketBaselinePct)
      : null
  const divergencePp =
    ensembleWinPct != null && marketBaselinePct != null ? round1(ensembleWinPct - marketBaselinePct) : null
  const agreementPct = agreementPctOf(args.consensus)
  return {
    ensembleWinPct,
    marketBaselinePct,
    divergencePp,
    agreementPct,
    fracture: fractureFromAgreement(agreementPct, args.consensus.aggregateProbability),
  }
}

function round1(n: number): number {
  return Math.round(n * 10) / 10
}

export const SPORTS_UI_BANNED_RE = /토토|배당|핸디캡|픽|베팅|배팅/
