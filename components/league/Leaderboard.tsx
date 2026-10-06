'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { boardLabels } from '@/lib/league/boards/display'
import { boardFiltersQuery } from '@/lib/league/boards/filters'
import { isBoardsResponse, type BoardFilters, type BoardsResponse } from '@/lib/league/boards/types'
import { leaderboardBoardCopy } from '@/lib/league/i18n/leaderboard-board-copy'
import { useLeagueLocale } from '@/lib/league/i18n/use-league-locale'
import { useLeagueRequestSignals } from '@/lib/league/use-league-request-signals'
import { admissionStockLane } from '@/lib/league/stock-lane'
import { formatKrTrackRecord } from '@/lib/league/korea-disclosure'
import { KrTrackRecordNotice } from '@/components/league/KrLaneDisclosureBlocks'
import { CardCompliance } from './CardCompliance'
import { LeaderboardBoards } from './LeaderboardBoards'
import { LanguageToggle } from './LanguageToggle'

export type LeaderboardProps = {
  initial: BoardsResponse
  /** Appended to every refetch, e.g. `test=1` on the admin preview. */
  query?: string
  /** DEV-ONLY: forwarded to `useLeagueLocale`, same escape hatch `PredictionCard` uses. */
  devSignalsQuery?: string
}

/**
 * The public entry point for the league leaderboard. Renders cached boards
 * from `GET /api/league/leaderboard` and refetches when a filter changes —
 * it never computes a win rate itself.
 *
 * Reuses the exact same compliance wrapper (`CardCompliance` +
 * `DisclaimerFooter`) and Layer A locale machinery as the prediction card,
 * for the same reason: this is AI-model PERFORMANCE content, and the same
 * "never render without the disclaimer" guarantee applies. `colorBucket` is
 * fixed to `'green'` (calm tone) — a leaderboard isn't any one round's risk
 * bucket, so it always renders at the calmest, most neutral tone.
 */
export function Leaderboard({ initial, query, devSignalsQuery }: LeaderboardProps) {
  const { locale, t, dir, setLocale, showLanguageToggle } = useLeagueLocale(devSignalsQuery)
  const signals = useLeagueRequestSignals(devSignalsQuery)
  const koreaLaneViewer =
    admissionStockLane({
      declaredCountry: signals.declaredCountry,
      ipCountry: signals.ipCountry,
    }) === 'korea'

  const [response, setResponse] = useState(initial)
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)
  const requestId = useRef(0)

  useEffect(() => {
    requestId.current += 1
    setResponse(initial)
    setLoading(false)
  }, [initial])

  const changeFilters = useCallback(
    async (next: BoardFilters) => {
      const id = ++requestId.current
      setLoading(true)
      setFailed(false)
      try {
        const qs = [boardFiltersQuery(next), query].filter(Boolean).join('&')
        const res = await fetch(`/api/league/leaderboard?${qs}`, { credentials: 'include' })
        const body: unknown = await res.json()
        if (id !== requestId.current) return
        if (res.ok && isBoardsResponse(body)) setResponse(body)
        else setFailed(true)
      } catch {
        if (id === requestId.current) setFailed(true)
      } finally {
        if (id === requestId.current) setLoading(false)
      }
    },
    [query],
  )

  const view = useMemo(() => {
    const copy = leaderboardBoardCopy(locale)
    return { t, copy, labels: boardLabels(locale, t, copy), locale }
  }, [locale, t])

  const trackRecordText = formatKrTrackRecord({ n: response.meta.rounds })

  return (
    <div dir={dir}>
      <div className="flex items-center justify-between gap-2 pb-1">
        <p className="text-[11px] text-league-fg-muted">
          {response.meta.generatedAt ? t.leaderboard.asOf(formatAsOf(response.meta.generatedAt)) : null}
        </p>
        {showLanguageToggle ? (
          <LanguageToggle locale={locale} onChange={setLocale} label={t.languageToggleLabel} />
        ) : null}
      </div>
      <CardCompliance colorBucket="green" t={t}>
        {() => (
          <>
            <LeaderboardBoards
              response={response}
              view={view}
              loading={loading}
              onFilters={(next) => void changeFilters(next)}
            />
            {failed ? <p className="px-4 pb-2 text-[11px] text-rose-600">{t.hub.genericError}</p> : null}
            {koreaLaneViewer ? <KrTrackRecordNotice text={trackRecordText} /> : null}
          </>
        )}
      </CardCompliance>
    </div>
  )
}

function formatAsOf(iso: string): string {
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return iso
  }
}
