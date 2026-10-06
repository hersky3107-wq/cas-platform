/**
 * Sports dual-display math — AI ensemble win probability vs market baseline.
 * Pure. No gambling-term copy lives here; chrome is in the i18n dictionary.
 */

import type { ConsensusSummary } from './card-types'

export type SportsFractureKind = 'iron' | 'soft' | 'warn' | 'none'

/**
 * Weak-confidence crowding and the soft fracture use this ceiling:
 * agreement above 85% with confidence under 70% is crowded, not iron.
 */
export const IRON_MIN_CONFIDENCE_PCT = 70

/** The words 철벽 / ironclad render only at or above this weighted confidence. */
export const IRON_WORD_MIN_CONFIDENCE_PCT = 80

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
    if (confidencePct != null && confidencePct >= IRON_WORD_MIN_CONFIDENCE_PCT) return 'iron'
    if (confidencePct != null && confidencePct < IRON_MIN_CONFIDENCE_PCT) return 'soft'
    return 'none'
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

const PRICED_BASELINE_SOURCES = new Set(['kalshi', 'polymarket', 'odds_api', 'api_football'])

/**
 * The market seat's stored implied probability, as a 0–100 percent.
 * `raw` is the 0–1 fraction written by the market matcher (0.71 → 71).
 * Search and "no market" sources do not fill the hero.
 */
export function impliedProbabilityPct(source: string | null | undefined, raw: number | null | undefined): number | null {
  if (!source || !PRICED_BASELINE_SOURCES.has(source)) return null
  const n = Number(raw)
  if (!Number.isFinite(n)) return null
  const pct = n >= 0 && n <= 1 ? n * 100 : n
  if (pct < 0 || pct > 100) return null
  return round1(pct)
}

/** Stored seat probability wins; the fixture cache fills the gap when the seat has none. */
export function marketBaselinePctForCard(storedPct: number | null, cachePct: number | null): number | null {
  return storedPct ?? cachePct
}

function round1(n: number): number {
  return Math.round(n * 10) / 10
}

export const SPORTS_UI_BANNED_RE = /토토|배당|핸디캡|픽|베팅|배팅/
