import { consequenceOf } from '../outcomes/predictions'
import type { Prediction } from '../outcomes/predictions'
import type { EngineCard } from './schema'

export type PredictionConsistencyDrop = 'contradicts_low_reservoir' | 'contradicts_card_evidence'

const PCT = /(\d+(?:\.\d+)?)\s*%/g
const LOW_RESERVOIR =
  /\b(below|under|only|at|~|about|around)\s+(\d+(?:\.\d+)?)\s*%|\b(\d+(?:\.\d+)?)\s*%\s+(full|fill|capacity|storage)|doluluk\s+(\d+(?:\.\d+)?)\s*%|저수율\s+(\d+(?:\.\d+)?)%/gi

function percentMentions(text: string): number[] {
  const values: number[] = []
  for (const match of text.matchAll(PCT)) {
    const value = Number(match[1])
    if (Number.isFinite(value) && value >= 0 && value <= 100) values.push(value)
  }
  return values
}

function lowReservoirPercents(text: string): number[] {
  const values: number[] = []
  for (const match of text.matchAll(LOW_RESERVOIR)) {
    const raw = match[2] ?? match[3] ?? match[5] ?? match[6]
    const value = Number(raw)
    if (Number.isFinite(value)) values.push(value)
  }
  if (values.length) return values
  if (/\b(low reservoir|drought-low|below half|under 50|half empty|storage stress)\b/i.test(text)) {
    return percentMentions(text).filter((value) => value < 50)
  }
  return []
}

function cardEvidenceText(card: Pick<EngineCard, 'context' | 'components' | 'name'>): string {
  const raw = card.components.flatMap((row) => {
    const bits: string[] = []
    for (const [key, value] of Object.entries(row.raw)) {
      if (typeof value === 'string' || typeof value === 'number') bits.push(`${key} ${value}`)
    }
    return bits
  })
  return `${card.name} ${card.context.join(' ')} ${raw.join(' ')}`
}

function windowDays(prediction: Pick<Prediction, 'window_start' | 'window_end'>, now: Date): number {
  const start = Date.parse(`${prediction.window_start}T00:00:00Z`)
  if (!Number.isFinite(start)) return 99
  return Math.max(0, Math.round((start - now.getTime()) / 86_400_000))
}

export function predictionContradictsCard(
  prediction: Pick<Prediction, 'what' | 'where' | 'window_start' | 'window_end' | 'observable'>,
  card: Pick<EngineCard, 'context' | 'components' | 'name' | 'fragility'>,
  now: Date,
): PredictionConsistencyDrop | null {
  const blob = cardEvidenceText(card)
  const what = consequenceOf(prediction.what) ?? prediction.what
  const lows = lowReservoirPercents(blob)
  if ((/dam spill|overtop|spill/i.test(what) || /dam spill|overtop|spill/i.test(prediction.what)) && lows.some((value) => value < 50)) {
    if (windowDays(prediction, now) <= 3) return 'contradicts_low_reservoir'
  }
  return null
}

export function filterConsistentPredictions<T extends Prediction>(
  predictions: T[],
  card: Pick<EngineCard, 'context' | 'components' | 'name' | 'fragility'>,
  now: Date,
): T[] {
  const kept: T[] = []
  for (const prediction of predictions) {
    const reason = predictionContradictsCard(prediction, card, now)
    if (reason) {
      console.log(`prediction dropped=${reason} what=${prediction.what} where=${prediction.where} window=${prediction.window_start}..${prediction.window_end}`)
      continue
    }
    kept.push(prediction)
  }
  return kept
}
