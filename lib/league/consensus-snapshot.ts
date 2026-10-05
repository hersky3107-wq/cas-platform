/**
 * Persisted "AI 종합" snapshot — the same log-odds math the live card uses,
 * plus brand_table's #1-brand pick. Pure: no I/O.
 */

import { DEFAULT_SIDES, binaryCallsFromModels, dualConsensus, logOddsConsensus, type DefaultSide } from './log-odds-consensus'
import { aggregateMagnitude } from './magnitude'
import { officialRowsForConsensus } from './extra/seats'
import { decodeActualTableOutcome, decodeBrandTableRanking } from './ai-ranking/brand-table'
import type { AnswerSide } from './answer-contract'

export const BRAND_TABLE_OTHER_SIDE = '__other__'

export type ConsensusRowInput = {
  model_id?: string | null
  league_tier?: string | null
  direction: string | null
  probability: number | null
  magnitude?: number | null
  qualifierText?: string | null
}

export type ConsensusSnapshot = {
  majorityDirection: string | null
  majorityProbability: number | null
  aggregateDirection: string | null
  aggregateProbability: number | null
  aggregateMagnitudePct: number | null
  aggregateMagnitudeN: number
}

export type ConsensusMode = 'binary' | 'brand_table'

const BINARY_TOKENS = new Set(['up', 'down', 'yes', 'no', 'above', 'below'])

export function firstOutcomeToken(actual: string | null | undefined): string | null {
  if (!actual) return null
  const m = actual.trim().match(/^(up|down|yes|no|above|below)\b/i)
  return m ? m[1]!.toLowerCase() : null
}

export function brandTableFirstPick(qualifierText: string | null | undefined): string | null {
  const ranking = decodeBrandTableRanking(qualifierText)
  return ranking[0] ?? null
}

function officialInputs(rows: readonly ConsensusRowInput[]): ConsensusRowInput[] {
  return officialRowsForConsensus(rows)
}

function binarySnapshot(
  rows: readonly ConsensusRowInput[],
  sides: readonly [string, string],
): ConsensusSnapshot {
  const official = officialInputs(rows)
  const pair = sides as readonly [AnswerSide, AnswerSide]
  const dual = dualConsensus(binaryCallsFromModels(official, pair), pair)
  const magnitude = aggregateMagnitude(
    official.map((r) => ({ direction: r.direction as AnswerSide | null, magnitude: r.magnitude ?? null })),
    dual.aggregate.direction,
  )
  return {
    majorityDirection: dual.majority.direction,
    majorityProbability: dual.majority.probability,
    aggregateDirection: dual.aggregate.direction,
    aggregateProbability: dual.aggregate.probability,
    aggregateMagnitudePct: magnitude.medianPct,
    aggregateMagnitudeN: magnitude.n,
  }
}

function pluralityBrand(picks: readonly { brand: string; probability: number }[]): {
  majority: string | null
  aggregate: string | null
} {
  const counts = new Map<string, { n: number; sumP: number }>()
  for (const p of picks) {
    const cur = counts.get(p.brand) ?? { n: 0, sumP: 0 }
    cur.n += 1
    cur.sumP += p.probability
    counts.set(p.brand, cur)
  }
  let topN = 0
  let tied = false
  let majority: string | null = null
  let aggregate: string | null = null
  let bestSum = -1
  for (const [brand, { n, sumP }] of counts) {
    if (n > topN) {
      topN = n
      majority = brand
      tied = false
    } else if (n === topN) {
      tied = true
    }
    if (sumP > bestSum || (sumP === bestSum && (aggregate == null || brand.localeCompare(aggregate) < 0))) {
      bestSum = sumP
      aggregate = brand
    }
  }
  return { majority: tied ? null : majority, aggregate }
}

function brandTableSnapshot(rows: readonly ConsensusRowInput[]): ConsensusSnapshot {
  const official = officialInputs(rows)
  const picks: { brand: string; probability: number }[] = []
  for (const r of official) {
    const brand = brandTableFirstPick(r.qualifierText)
    if (!brand) continue
    const p = typeof r.probability === 'number' && Number.isFinite(r.probability) ? r.probability : 50
    picks.push({ brand, probability: p })
  }
  if (!picks.length) {
    return {
      majorityDirection: null,
      majorityProbability: null,
      aggregateDirection: null,
      aggregateProbability: null,
      aggregateMagnitudePct: null,
      aggregateMagnitudeN: 0,
    }
  }
  const { majority, aggregate } = pluralityBrand(picks)
  const winner = aggregate
  const meanP = picks.reduce((s, p) => s + p.probability, 0) / picks.length
  const majorityProbability = Number.isFinite(meanP) ? Math.round(meanP * 10) / 10 : null
  if (!winner) {
    return {
      majorityDirection: majority,
      majorityProbability,
      aggregateDirection: null,
      aggregateProbability: null,
      aggregateMagnitudePct: null,
      aggregateMagnitudeN: 0,
    }
  }
  const sides = [winner, BRAND_TABLE_OTHER_SIDE] as const
  const calls = picks.map((p) => ({
    direction: p.brand === winner ? winner : BRAND_TABLE_OTHER_SIDE,
    probability: p.probability,
  }))
  const aggregateOdds = logOddsConsensus(calls, sides)
  return {
    majorityDirection: majority,
    majorityProbability,
    aggregateDirection: winner,
    aggregateProbability: aggregateOdds.probability,
    aggregateMagnitudePct: null,
    aggregateMagnitudeN: 0,
  }
}

export function computeConsensusSnapshot(args: {
  rows: readonly ConsensusRowInput[]
  sides?: readonly [string, string]
  mode: ConsensusMode
}): ConsensusSnapshot {
  if (args.mode === 'brand_table') return brandTableSnapshot(args.rows)
  return binarySnapshot(args.rows, args.sides ?? DEFAULT_SIDES)
}

export function consensusIsCorrect(args: {
  aggregateDirection: string | null
  actualOutcome: string | null
  mode: ConsensusMode
}): boolean | null {
  const pick = args.aggregateDirection?.trim()
  if (!pick || !args.actualOutcome?.trim()) return null
  if (args.mode === 'brand_table') {
    const actual = decodeActualTableOutcome(args.actualOutcome).ranking[0]
    if (!actual) return null
    return actual.toLowerCase() === pick.toLowerCase()
  }
  const token = firstOutcomeToken(args.actualOutcome)
  if (!token || !BINARY_TOKENS.has(pick.toLowerCase())) return null
  return token === pick.toLowerCase()
}

export function persistFieldsFromSnapshot(snapshot: ConsensusSnapshot): {
  consensus_majority_direction: string | null
  consensus_majority_probability: number | null
  consensus_aggregate_direction: string | null
  consensus_aggregate_probability: number | null
  consensus_aggregate_magnitude_pct: number | null
  consensus_aggregate_magnitude_n: number
} {
  return {
    consensus_majority_direction: snapshot.majorityDirection,
    consensus_majority_probability: snapshot.majorityProbability,
    consensus_aggregate_direction: snapshot.aggregateDirection,
    consensus_aggregate_probability: snapshot.aggregateProbability,
    consensus_aggregate_magnitude_pct: snapshot.aggregateMagnitudePct,
    consensus_aggregate_magnitude_n: snapshot.aggregateMagnitudeN,
  }
}

export type { DefaultSide }
