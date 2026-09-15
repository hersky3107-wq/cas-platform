'use client'

import { useEffect, useState } from 'react'
import type { LeagueUiPack } from '@/lib/league/i18n/dictionary'

export type GenerationProgressStripProps = {
  queued: boolean
  answered: number
  rosterSize: number
  complete: boolean
  t: LeagueUiPack
}

/**
 * Shared live-generation chrome for every category: progress bar + looping
 * motif while seats resolve, then a brief completion beat that dismisses.
 */
export function GenerationProgressStrip({
  queued,
  answered,
  rosterSize,
  complete,
  t,
}: GenerationProgressStripProps) {
  const [phase, setPhase] = useState<'work' | 'done' | 'gone'>(complete ? 'done' : 'work')

  useEffect(() => {
    if (!complete) {
      setPhase('work')
      return
    }
    setPhase('done')
    const id = window.setTimeout(() => setPhase('gone'), 2200)
    return () => window.clearTimeout(id)
  }, [complete])

  if (phase === 'gone') return null

  const total = Math.max(0, rosterSize)
  const n = Math.min(Math.max(0, answered), total || answered)
  const pct = total > 0 ? Math.round((n / total) * 100) : 0

  if (phase === 'done') {
    return (
      <div
        className="mx-3 mb-2 flex items-center gap-2.5 rounded-2xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 md:mx-4"
        role="status"
        aria-live="polite"
        data-testid="generation-complete"
      >
        <span className="league-gen-pop inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white">
          <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden>
            <path
              fill="currentColor"
              d="M9.2 16.2 5.8 12.8l-1.4 1.4 4.8 4.8 10-10-1.4-1.4z"
            />
          </svg>
        </span>
        <p className="text-xs font-semibold leading-relaxed text-emerald-950">
          {t.hub.generationComplete(total || n)}
        </p>
      </div>
    )
  }

  return (
    <div
      className="mx-3 mb-2 rounded-2xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 md:mx-4"
      role="status"
      aria-live="polite"
      aria-busy="true"
      data-testid="generation-progress"
    >
      <div className="flex items-center gap-2.5">
        <HourglassMotif />
        <p className="min-w-0 flex-1 text-xs font-medium leading-relaxed text-emerald-950">
          {queued ? t.hub.generationQueued : t.hub.generationProgress(n, total)}
        </p>
        <span className="shrink-0 font-mono text-[11px] font-semibold tabular-nums text-emerald-800">
          {pct}%
        </span>
      </div>
      <div
        className="mt-2 h-1.5 overflow-hidden rounded-full bg-emerald-200/80"
        aria-hidden
      >
        <div
          className="h-full rounded-full bg-emerald-500 transition-[width] duration-500 ease-out"
          style={{ width: `${queued ? 6 : Math.max(pct, 4)}%` }}
        />
      </div>
      <p className="mt-1.5 text-[11px] leading-snug text-emerald-800/80">
        {t.hub.generationWaitingNote}
      </p>
    </div>
  )
}

function HourglassMotif() {
  return (
    <span className="relative inline-flex h-8 w-8 shrink-0 items-center justify-center" aria-hidden>
      <svg viewBox="0 0 32 32" className="league-gen-orbit h-8 w-8 text-emerald-500">
        <circle cx="16" cy="16" r="13" fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2" />
        <circle cx="16" cy="3" r="2.2" fill="currentColor" />
      </svg>
      <svg viewBox="0 0 24 24" className="absolute h-4 w-4 text-emerald-800">
        <path
          fill="currentColor"
          d="M6 3h12v3.2c0 2.1-1.2 4-3.1 5L15 12l-.1.8c1.9 1 3.1 2.9 3.1 5V21H6v-3.2c0-2.1 1.2-4 3.1-5L9 12l.1-.8C7.2 10.2 6 8.3 6 6.2V3zm2 2v1.2c0 1.5.9 2.9 2.3 3.5L12 10.4l1.7-.7C15.1 9.1 16 7.7 16 6.2V5H8zm0 14h8v-1.2c0-1.5-.9-2.9-2.3-3.5L12 13.6l-1.7.7C8.9 14.9 8 16.3 8 17.8V19z"
        />
        <rect className="league-gen-sand" x="10" y="6.2" width="4" height="3" rx="0.6" fill="currentColor" opacity="0.85" />
      </svg>
    </span>
  )
}
