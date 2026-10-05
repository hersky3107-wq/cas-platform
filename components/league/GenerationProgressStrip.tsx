'use client'

import { useEffect, useState } from 'react'
import type { CardModelPrediction } from '@/lib/league/card-types'
import type { LeagueUiPack } from '@/lib/league/i18n/dictionary'
import type { LeagueLocale } from '@/lib/league/i18n/locales'
import type { SideLabels } from '@/lib/league/side-labels'
import { WaitingArena } from './WaitingArena'

export type GenerationProgressStripProps = {
  queued: boolean
  answered: number
  rosterSize: number
  complete: boolean
  t: LeagueUiPack
  queuePosition?: number
  etaMinutes?: number
  models?: readonly CardModelPrediction[]
  labels?: SideLabels
  locale?: LeagueLocale
}

/**
 * Live waiting chrome. The arena shows real seat counts, the queue line,
 * and short takes from answers that have already landed.
 */
export function GenerationProgressStrip({
  queued,
  answered,
  rosterSize,
  complete,
  t,
  queuePosition,
  etaMinutes,
  models = [],
  labels,
  locale = 'en',
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
      className="mx-3 mb-2 rounded-2xl border border-league-border bg-league-bg-elevated px-3 py-2.5 md:mx-4"
      role="status"
      aria-live="polite"
      aria-busy="true"
      data-testid="generation-progress"
    >
      <WaitingArena
        queued={queued}
        answered={n}
        rosterSize={total}
        queuePosition={queuePosition}
        etaMinutes={etaMinutes}
        models={models}
        labels={labels}
        t={t}
        locale={locale}
      />
    </div>
  )
}
