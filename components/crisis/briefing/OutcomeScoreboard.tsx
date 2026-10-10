'use client'

import { useEffect, useState } from 'react'
import type { CrisisLocale } from '@/lib/crisis/i18n/locales'
import { getOutcomeUi } from '@/lib/crisis/i18n/dictionary'
import { isPredictionSnapshot, summarizeScoreboard, type OutcomeScoreboard as Board, type ScoreboardOutcome, type ScoreboardPrediction } from '@/lib/crisis/outcomes/scoreboard'
import { supabase } from '@/lib/db/supabase'

export function OutcomeScoreboard({ locale }: { locale: CrisisLocale }) {
  const copy = getOutcomeUi(locale)
  const [board, setBoard] = useState<Board | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const [hypotheses, outcomes] = await Promise.all([
        supabase.from('crisis_hypotheses').select('id,created_at,title,evidence_snapshot').order('created_at', { ascending: false }).limit(300),
        supabase.from('crisis_hypothesis_outcomes').select('hypothesis_id,outcome,event_description,event_date,recorded_at,source_urls').order('recorded_at', { ascending: false }).limit(300),
      ])
      if (cancelled) return
      const predictions: ScoreboardPrediction[] = []
      for (const row of hypotheses.data ?? []) {
        const snapshot = row.evidence_snapshot
        if (!isPredictionSnapshot(snapshot)) continue
        predictions.push({
          id: Number(row.id),
          createdAt: String(row.created_at),
          title: String(row.title ?? snapshot.prediction?.where ?? ''),
          where: snapshot.prediction?.where ?? '',
          windowEnd: snapshot.prediction?.window_end ?? snapshot.window_end ?? '',
          probability: typeof snapshot.prediction?.probability === 'number' ? snapshot.prediction.probability : null,
        })
      }
      const outcomeRows: ScoreboardOutcome[] = (outcomes.data ?? []).map((row) => ({
        hypothesisId: Number(row.hypothesis_id),
        outcome: row.outcome,
        eventDescription: row.event_description,
        eventDate: row.event_date,
        recordedAt: String(row.recorded_at),
        sourceUrls: Array.isArray(row.source_urls) ? row.source_urls.map(String) : [],
      }))
      setBoard(summarizeScoreboard(predictions, outcomeRows, new Date()))
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const stats = board ?? { total: 0, hits: 0, misses: 0, pending: 0, unclear: 0, latestHits: [] }
  return (
    <section className="rounded-3xl border border-white/10 bg-white/[0.03] px-4 py-4">
      <h2 className="text-sm font-black tracking-tight text-slate-200">{copy.scoreboardTitle}</h2>
      <dl className="mt-3 grid grid-cols-5 gap-2 text-center">
        {(
          [
            [copy.scoreboardTotal, stats.total],
            [copy.scoreboardHits, stats.hits],
            [copy.scoreboardMisses, stats.misses],
            [copy.scoreboardPending, stats.pending],
            [copy.scoreboardUnclear, stats.unclear],
          ] as const
        ).map(([label, value]) => (
          <div key={label} className="rounded-xl border border-white/10 px-2 py-2">
            <dt className="text-[10px] uppercase tracking-wide text-slate-500">{label}</dt>
            <dd className="text-xl font-black text-white">{value}</dd>
          </div>
        ))}
      </dl>
      {stats.latestHits.length === 0 ? (
        <p className="mt-3 text-xs text-slate-500">{copy.scoreboardEmpty}</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {stats.latestHits.map((hit) => (
            <li key={`${hit.predictedAt}-${hit.title}`} className="text-sm text-slate-200">
              {copy.hitLine(copy.stamp(hit.predictedAt, true), copy.stamp(hit.hitAt, false))}
              <span className="ml-2 text-xs text-slate-400">
                {hit.title}
                {hit.where ? ` · ${hit.where}` : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
