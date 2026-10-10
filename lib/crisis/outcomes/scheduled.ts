import { callEngineProvider } from '../engine/providers'
import { supabaseAdmin } from '../../supabase/server'
import { evidenceQueries, hitsFromPayload, type EvidenceHit } from './check'
import type { Prediction } from './predictions'
import { checkOpenPredictions } from './run-check'
import { outcomesDue } from './schedule'
import { isPredictionSnapshot } from './scoreboard'

let lastSuccessAt: string | null = null

async function searchFeeds(prediction: Prediction): Promise<EvidenceHit[]> {
  const app = process.env.RELIEFWEB_APPNAME?.trim() || 'crisiswatch'
  const hits: EvidenceHit[] = []
  for (const query of evidenceQueries(prediction, app)) {
    try {
      const res = await fetch(query.url, { headers: { accept: 'application/json' } })
      if (!res.ok) continue
      const json = (await res.json()) as unknown
      hits.push(...hitsFromPayload(query.source, json, prediction))
    } catch {
      // One feed failing does not skip the others.
    }
  }
  if (process.env.PERPLEXITY_API_KEY?.trim()) {
    try {
      const result = await callEngineProvider({
        model: 'sonar-reasoning-pro',
        provider: 'perplexity',
        system: 'Search for whether this consequence already happened. List source titles and urls.',
        user: `${prediction.what} at ${prediction.where} between ${prediction.window_start} and ${prediction.window_end}. ${prediction.observable}`,
        maxTokens: 600,
        timeoutMs: 40_000,
      })
      for (const item of result.searchItems ?? []) {
        hits.push({ title: item.title, url: item.url, source: 'web' })
      }
    } catch {
      // Web search is optional.
    }
  }
  return hits
}

export async function runOutcomeCheck(opts: { now?: Date; dryRun?: boolean; force?: boolean } = {}): Promise<{
  open: number
  writes: number
  skipped: boolean
}> {
  const now = opts.now ?? new Date()
  if (!opts.force && !outcomesDue(lastSuccessAt, now)) return { open: 0, writes: 0, skipped: true }
  const { data, error } = await supabaseAdmin
    .from('crisis_hypotheses')
    .select('id,created_at,title,evidence_snapshot')
    .order('id', { ascending: false })
    .limit(400)
  if (error) throw new Error(error.message)
  const ids = (data ?? []).map((row) => Number(row.id))
  const outcomeQuery = ids.length
    ? await supabaseAdmin.from('crisis_hypothesis_outcomes').select('hypothesis_id').in('hypothesis_id', ids)
    : { data: [], error: null }
  if (outcomeQuery.error) throw new Error(outcomeQuery.error.message)
  const counts = new Map<number, number>()
  for (const row of outcomeQuery.data ?? []) {
    const id = Number(row.hypothesis_id)
    counts.set(id, (counts.get(id) ?? 0) + 1)
  }
  const open = (data ?? []).flatMap((row) => {
    const snapshot = row.evidence_snapshot
    if (!isPredictionSnapshot(snapshot)) return []
    const prediction = snapshot.prediction
    if (!prediction?.what || !prediction.where || !prediction.window_end || !prediction.window_start) return []
    return [
      {
        id: Number(row.id),
        createdAt: String(row.created_at),
        prediction: prediction as Prediction,
        outcomeCount: counts.get(Number(row.id)) ?? 0,
      },
    ]
  })
  const writes = await checkOpenPredictions({
    rows: open,
    now,
    search: searchFeeds,
    judge: async ({ system, user }) => {
      const result = await callEngineProvider({
        model: 'gemini-3.5-flash-lite',
        provider: 'google',
        system,
        user,
        maxTokens: 400,
        timeoutMs: 25_000,
        jsonMode: true,
        googleThinking: 'off',
      })
      return result.text
    },
  })
  if (!opts.dryRun) {
    for (const row of writes) {
      const { error: insertError } = await supabaseAdmin.from('crisis_hypothesis_outcomes').insert({
        hypothesis_id: row.hypothesis_id,
        outcome: row.outcome,
        event_description: row.event_description,
        event_date: row.event_date,
        source_urls: row.source_urls,
        lead_time_days: row.lead_time_days,
      })
      if (insertError) throw new Error(insertError.message)
    }
    lastSuccessAt = now.toISOString()
  }
  return { open: open.length, writes: writes.length, skipped: false }
}
