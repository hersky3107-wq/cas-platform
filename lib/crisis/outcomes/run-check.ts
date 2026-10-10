import { decideOutcome, judgeUser, parseVerdict, type EvidenceHit, type OpenPrediction, type OutcomeWrite } from './check'
import type { Prediction } from './predictions'

export async function checkOpenPredictions(opts: {
  rows: OpenPrediction[]
  now: Date
  search: (prediction: Prediction) => Promise<EvidenceHit[]>
  judge?: (prompt: { system: string; user: string }) => Promise<string>
}): Promise<OutcomeWrite[]> {
  const writes: OutcomeWrite[] = []
  for (const row of opts.rows) {
    if (row.outcomeCount > 0) continue
    let evidence: EvidenceHit[] = []
    try {
      evidence = await opts.search(row.prediction)
    } catch {
      evidence = []
    }
    let judged = null
    if (evidence.length > 0 && opts.judge) {
      try {
        judged = parseVerdict(await opts.judge(judgeUser(row.prediction, evidence, opts.now)))
      } catch {
        judged = null
      }
    }
    const decision = decideOutcome({
      prediction: row.prediction,
      createdAt: row.createdAt,
      now: opts.now,
      evidence,
      judged,
    })
    if (!decision) continue
    writes.push({ ...decision, hypothesis_id: row.id })
  }
  return writes
}
