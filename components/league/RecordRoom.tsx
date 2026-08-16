'use client'

import { useCallback, useState } from 'react'
import type { RecordRoomPage } from '@/lib/league/record-room-aggregate'
import { useLeagueLocale } from '@/lib/league/i18n/use-league-locale'
import { CardCompliance } from './CardCompliance'
import { RecordRoomBody } from './RecordRoomBody'
import { LanguageToggle } from './LanguageToggle'

export type RecordRoomProps = {
  initialData: RecordRoomPage
  /** DEV-ONLY: forwarded to `useLeagueLocale`, same escape hatch `PredictionCard` uses. */
  devSignalsQuery?: string
}

/**
 * The public entry point for the league record room — a read-only,
 * paginated, immutable log of resolved rounds (see
 * `lib/league/record-room-aggregate.ts`). No editing affordances anywhere:
 * this component only ever fetches subsequent pages of the same endpoint,
 * it never writes.
 *
 * Reuses the same `CardCompliance` wrapper + Layer A locale machinery as the
 * prediction card and leaderboard, at the same fixed calm (`'green'`) tone.
 */
export function RecordRoom({ initialData, devSignalsQuery }: RecordRoomProps) {
  const { locale, t, dir, setLocale } = useLeagueLocale(devSignalsQuery)
  const [data, setData] = useState(initialData)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadPage = useCallback(
    async (page: number) => {
      setLoading(true)
      setError(null)
      try {
        const res = await fetch(`/api/league/record-room?page=${page}&pageSize=${data.pageSize}`, {
          credentials: 'include',
        })
        const body = (await res.json()) as RecordRoomPage | { error: string }
        if (!res.ok) throw new Error('error' in body ? body.error : `request failed (${res.status})`)
        setData(body as RecordRoomPage)
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : 'failed to load record room')
      } finally {
        setLoading(false)
      }
    },
    [data.pageSize]
  )

  return (
    <div dir={dir}>
      <div className="flex items-center justify-between gap-2 pb-1">
        <p className="truncate text-[11px] text-rose-600">{error ?? ''}</p>
        <LanguageToggle locale={locale} onChange={setLocale} label={t.languageToggleLabel} />
      </div>
      <CardCompliance colorBucket="green" t={t}>
        {(receipt) => (
          <RecordRoomBody data={data} receipt={receipt} t={t} onPageChange={(page) => void loadPage(page)} loading={loading} />
        )}
      </CardCompliance>
    </div>
  )
}
