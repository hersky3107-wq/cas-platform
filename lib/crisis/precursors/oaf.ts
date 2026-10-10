import { asArray, asRecord, finiteNumber } from '../ingest/fetch'

export interface WeekProbabilities {
  m5: number
  m6: number
  m7: number
}

/** USGS OAF forecast.json: probability of one or more events at each magnitude during the "1 Week" bin. */
export function weekProbabilities(payload: unknown): WeekProbabilities | null {
  const root = asRecord(payload)
  const frames = asArray(root?.forecast).map((row) => asRecord(row)).filter((row): row is Record<string, unknown> => row != null)
  const week = frames.find((row) => String(row.label ?? '').trim().toLowerCase() === '1 week')
  if (!week) return null
  const bins = asArray(week.bins).map((row) => asRecord(row)).filter((row): row is Record<string, unknown> => row != null)
  const prob = (magnitude: number): number => {
    const bin = bins.find((row) => finiteNumber(row.magnitude) === magnitude)
    const value = finiteNumber(bin?.probability)
    return value != null && value >= 0 ? value : 0
  }
  return { m5: prob(5), m6: prob(6), m7: prob(7) }
}
