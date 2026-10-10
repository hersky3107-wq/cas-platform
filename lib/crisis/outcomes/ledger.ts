import type { Prediction } from './predictions'

export function predictionLedgerInsert(opts: {
  prediction: Prediction
  regionId: number
  createdAt: string
  roster: unknown
}) {
  const probability = opts.prediction.probability
  const confidence: 'low' | 'medium' | 'high' = probability >= 0.66 ? 'high' : probability >= 0.33 ? 'medium' : 'low'
  return {
    created_at: opts.createdAt,
    region_ids: [opts.regionId],
    stage: 3,
    confidence,
    novelty: 'unknown' as const,
    title: opts.prediction.what,
    body: [
      opts.prediction.label,
      opts.prediction.where,
      `${opts.prediction.window_start} → ${opts.prediction.window_end}`,
      `probability ${opts.prediction.probability}`,
      opts.prediction.observable,
      opts.prediction.counts_as_hit,
    ].join('\n'),
    evidence_signal_ids: [],
    evidence_snapshot: {
      kind: 'prediction',
      prediction: opts.prediction,
      window_start: opts.prediction.window_start,
      window_end: opts.prediction.window_end,
    },
    ai_roster: opts.roster,
  }
}
