/**
 * Extra-vs-main comparison VIEW MODEL.
 *
 * DISPLAY ONLY. Never writes into consensus / camp / book / weights / verdict.
 * Extra seats stay isolated; this file only reads `consensus` (already official)
 * and extra rows already on the card.
 *
 * Win-rate lines: only from real `is_correct` rows already on the models
 * array (this-round). No invented percentages — callers must run
 * `winRateLabel(winRateDisplay(...))`. Empty track → pending copy.
 */

import type { CardModelPrediction, ConsensusSummary, ModelSide } from './card-types'
import { LEAGUE_EXTRA_ROSTER, isExtraSeat, type ExtraSeatId } from './extra/seats'
import { tallySlotOfToken } from './side-labels'

export type ExtraSeatRecord = { correct: number; graded: number }

export type ExtraCompareVsCrowd = 'agree' | 'diverge' | 'pending' | 'no-crowd'

export type ExtraCompareSeatView = {
  id: ExtraSeatId
  badge: (typeof LEAGUE_EXTRA_ROSTER)[number]['badge']
  direction: ModelSide | null
  vsCrowd: ExtraCompareVsCrowd
  record: ExtraSeatRecord | null
}

export type ExtraCompareView = {
  crowdDirection: ModelSide | null
  crowdCount: number
  seats: ExtraCompareSeatView[]
  hasAnyRecord: boolean
}

export function extraRecordsFromModels(
  models: readonly Pick<CardModelPrediction, 'model_id' | 'league_tier' | 'is_correct'>[],
): Partial<Record<ExtraSeatId, ExtraSeatRecord>> {
  const out: Partial<Record<ExtraSeatId, ExtraSeatRecord>> = {}
  for (const model of models) {
    if (!isExtraSeat(model)) continue
    if (model.is_correct === null) continue
    const id = model.model_id as ExtraSeatId
    const prev = out[id] ?? { correct: 0, graded: 0 }
    out[id] = {
      correct: prev.correct + (model.is_correct ? 1 : 0),
      graded: prev.graded + 1,
    }
  }
  return out
}

export function buildExtraCompareView(
  models: readonly CardModelPrediction[],
  consensus: ConsensusSummary,
  records: Partial<Record<ExtraSeatId, ExtraSeatRecord>> = extraRecordsFromModels(models),
): ExtraCompareView {
  const byId = new Map(models.filter(isExtraSeat).map((model) => [model.model_id, model]))
  const crowdDirection = consensus.majorityDirection ?? consensus.aggregateDirection
  const crowdSlot = tallySlotOfToken(crowdDirection)
  const seats: ExtraCompareSeatView[] = LEAGUE_EXTRA_ROSTER.map((seat) => {
    const row = byId.get(seat.model_id)
    const direction = row?.direction ?? null
    const seatSlot = tallySlotOfToken(direction)
    const record = records[seat.model_id] ?? null
    let vsCrowd: ExtraCompareVsCrowd = 'pending'
    if (crowdSlot === null) vsCrowd = 'no-crowd'
    else if (seatSlot === null) vsCrowd = 'pending'
    else vsCrowd = seatSlot === crowdSlot ? 'agree' : 'diverge'
    return {
      id: seat.model_id,
      badge: seat.badge,
      direction,
      vsCrowd,
      record: record && record.graded > 0 ? record : null,
    }
  })
  return {
    crowdDirection,
    crowdCount: consensus.totalModels,
    seats,
    hasAnyRecord: seats.some((seat) => seat.record !== null),
  }
}

export function hasExtraCompareModels(
  models: readonly Pick<CardModelPrediction, 'model_id' | 'league_tier'>[],
): boolean {
  return models.some((model) => isExtraSeat(model))
}
