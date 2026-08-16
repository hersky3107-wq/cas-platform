import {
  CAMPS,
  LEAGUE_TIERS,
  emptyTally,
  type CampSplit,
  type CardData,
  type CardModelPrediction,
  type CardRoundMeta,
  type ColorBucket,
  type ConsensusSummary,
  type Direction,
  type DirectionTally,
  type HitRateSummary,
  type TierSplit,
} from './card-types'

/**
 * AI Prediction League — CARD DATA CONTRACT (Layer 1), pure assembly.
 *
 * `round + predictions -> CardData`, with every aggregate the UI needs
 * (consensus / camp split / tier split / hit rate) computed exactly ONCE,
 * here, so the client never has to (and can't drift from this definition of
 * "majority" / "abstain" / "hit rate").
 *
 * Deliberately has NO 'server-only' import and NO DB access — it is pure
 * data-in/data-out, which is what makes it unit-testable with vitest without
 * a Supabase connection (see `__tests__/card.test.ts`). The actual DB read
 * path lives in `card.ts` (which IS 'server-only') and calls this function.
 */

export type RoundRow = {
  id: string
  proposition_text: string
  category: string
  color_bucket: string
  instrument: string
  horizon: string
  resolution_rule: string
  resolves_at: string
  opened_at: string
  actual_outcome: string | null
  resolved_at: string | null
}

export type PredictionRow = {
  model_id: string
  brand: string
  camp: string
  league_tier: string
  predicted_direction: string | null
  predicted_value: number | null
  reasoning_snippet: string | null
  is_correct: boolean | null
  cost_usd: number | null
  predicted_at: string
}

function toDirection(raw: string | null): Direction | null {
  return raw === 'up' || raw === 'down' || raw === 'flat' ? raw : null
}

function toColorBucket(raw: string): ColorBucket {
  return raw === 'green' || raw === 'yellow' || raw === 'red' ? raw : 'yellow'
}

function tallyOf(models: CardModelPrediction[]): DirectionTally {
  const t = emptyTally()
  for (const m of models) {
    if (m.direction === null) t.abstain++
    else t[m.direction]++
  }
  return t
}

function majorityOf(tally: DirectionTally): Direction | null {
  const entries: Array<[Direction, number]> = [
    ['up', tally.up],
    ['down', tally.down],
    ['flat', tally.flat],
  ]
  entries.sort((a, b) => b[1] - a[1])
  const [topDir, topCount] = entries[0]!
  if (topCount === 0) return null
  const tiedForTop = entries.filter(([, c]) => c === topCount).length
  return tiedForTop === 1 ? topDir : null
}

function buildConsensus(models: CardModelPrediction[]): ConsensusSummary {
  const tally = tallyOf(models)
  const directional = models.filter((m) => m.direction !== null)
  const probs = directional.map((m) => m.probability).filter((p): p is number => typeof p === 'number')
  const avgProbability = probs.length ? probs.reduce((a, b) => a + b, 0) / probs.length : null
  return {
    tally,
    majorityDirection: majorityOf(tally),
    totalModels: models.length,
    respondedModels: models.length - tally.abstain,
    avgProbability: avgProbability === null ? null : Math.round(avgProbability * 10) / 10,
  }
}

function buildCampSplit(models: CardModelPrediction[]): CampSplit {
  const split = {} as CampSplit
  for (const camp of CAMPS) split[camp] = tallyOf(models.filter((m) => m.camp === camp))
  return split
}

function buildTierSplit(models: CardModelPrediction[]): TierSplit {
  const split = {} as TierSplit
  for (const tier of LEAGUE_TIERS) split[tier] = tallyOf(models.filter((m) => m.league_tier === tier))
  return split
}

function buildHitRate(round: RoundRow, models: CardModelPrediction[]): HitRateSummary {
  const graded = models.filter((m) => m.is_correct !== null)
  const correct = graded.filter((m) => m.is_correct === true).length
  return {
    resolved: round.resolved_at !== null,
    graded: graded.length,
    correct: graded.length ? correct : null,
    hitRatePct: graded.length ? Math.round((correct / graded.length) * 1000) / 10 : null,
  }
}

function toCardModel(row: PredictionRow): CardModelPrediction {
  const tier = row.league_tier as CardModelPrediction['league_tier']
  const camp = row.camp as CardModelPrediction['camp']
  return {
    model_id: row.model_id,
    brand: row.brand,
    camp,
    league_tier: tier,
    direction: toDirection(row.predicted_direction),
    probability: row.predicted_value,
    reasoning_snippet: row.reasoning_snippet,
    is_correct: row.is_correct,
    cost_usd: row.cost_usd,
    predicted_at: row.predicted_at,
  }
}

function toRoundMeta(row: RoundRow): CardRoundMeta {
  return {
    round_id: row.id,
    instrument: row.instrument,
    category: row.category,
    horizon: row.horizon,
    resolution_rule: row.resolution_rule,
    proposition_text: row.proposition_text,
    color_bucket: toColorBucket(row.color_bucket),
    resolves_at: row.resolves_at,
    opened_at: row.opened_at,
    resolved_at: row.resolved_at,
    actual_outcome: row.actual_outcome,
  }
}

/** Pure assembly step: round + predictions -> CardData. No I/O. */
export function buildCardData(roundRow: RoundRow, predictionRows: PredictionRow[]): CardData {
  const models = predictionRows.map(toCardModel)
  return {
    round: toRoundMeta(roundRow),
    models,
    consensus: buildConsensus(models),
    campSplit: buildCampSplit(models),
    tierSplit: buildTierSplit(models),
    hitRate: buildHitRate(roundRow, models),
    generatedAt: new Date().toISOString(),
  }
}
