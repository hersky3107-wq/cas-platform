export type OutcomeBucket = 'hit' | 'miss' | 'unclear' | 'pending'

export interface ScoreboardPrediction {
  id: number
  createdAt: string
  title: string
  where: string
  windowEnd: string
  probability: number | null
}

export interface ScoreboardOutcome {
  hypothesisId: number
  outcome: string | null
  eventDescription: string | null
  eventDate: string | null
  recordedAt: string
  sourceUrls: string[]
}

export interface ScoreboardHit {
  title: string
  where: string
  predictedAt: string
  hitAt: string
  url: string | null
}

export interface OutcomeScoreboard {
  total: number
  hits: number
  misses: number
  pending: number
  unclear: number
  latestHits: ScoreboardHit[]
}

export function isPredictionSnapshot(snapshot: unknown): snapshot is {
  kind: 'prediction'
  window_end?: string
  prediction?: {
    what?: string
    where?: string
    window_start?: string
    window_end?: string
    probability?: number
    observable?: string
    counts_as_hit?: string
    label?: string
  }
} {
  if (!snapshot || typeof snapshot !== 'object') return false
  return (snapshot as { kind?: string }).kind === 'prediction'
}

export function bucketOutcome(
  outcome: string | null | undefined,
  description: string | null | undefined,
  windowEnd: string,
  now: Date,
): OutcomeBucket {
  const text = (description ?? '').trim().toLowerCase()
  if (outcome === 'happened' || text.startsWith('hit')) return 'hit'
  if (outcome === 'did_not_happen' || text.startsWith('miss')) return 'miss'
  if (outcome === 'partially' || text.startsWith('unclear')) return 'unclear'
  const end = Date.parse(`${windowEnd}T23:59:59Z`)
  if (Number.isFinite(end) && now.getTime() > end) return 'miss'
  return 'pending'
}

export function summarizeScoreboard(
  predictions: ScoreboardPrediction[],
  outcomes: ScoreboardOutcome[],
  now: Date,
): OutcomeScoreboard {
  const byHypothesis = new Map<number, ScoreboardOutcome>()
  for (const row of outcomes) {
    const prev = byHypothesis.get(row.hypothesisId)
    if (!prev || row.recordedAt > prev.recordedAt) byHypothesis.set(row.hypothesisId, row)
  }
  const board: OutcomeScoreboard = { total: predictions.length, hits: 0, misses: 0, pending: 0, unclear: 0, latestHits: [] }
  for (const prediction of predictions) {
    const outcome = byHypothesis.get(prediction.id)
    const bucket = bucketOutcome(outcome?.outcome, outcome?.eventDescription, prediction.windowEnd, now)
    if (bucket === 'hit') board.hits += 1
    else if (bucket === 'miss') board.misses += 1
    else if (bucket === 'unclear') board.unclear += 1
    else board.pending += 1
    if (bucket === 'hit' && outcome) {
      board.latestHits.push({
        title: prediction.title,
        where: prediction.where,
        predictedAt: prediction.createdAt,
        hitAt: outcome.eventDate ?? outcome.recordedAt,
        url: outcome.sourceUrls[0] ?? null,
      })
    }
  }
  board.latestHits.sort((a, b) => b.hitAt.localeCompare(a.hitAt))
  board.latestHits = board.latestHits.slice(0, 5)
  return board
}
