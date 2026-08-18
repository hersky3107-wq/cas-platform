'use client'

import { useCallback, useState } from 'react'
import { creditsForLeagueArchive } from '@/lib/credits'
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

const DEEP_COST = creditsForLeagueArchive()

/**
 * Public record room: free recent-summary by default. Pagination past the
 * free window, model/date filters, and CSV go through the paid deep
 * endpoint. The server re-checks auth + credits regardless of this UI.
 */
export function RecordRoom({ initialData, devSignalsQuery }: RecordRoomProps) {
  const { locale, t, dir, setLocale } = useLeagueLocale(devSignalsQuery)
  const [data, setData] = useState(initialData)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [modelId, setModelId] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  const loadFree = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/league/record-room?page=1&pageSize=5', { credentials: 'include' })
      const body = (await res.json()) as RecordRoomPage | { error: string }
      if (!res.ok) throw new Error('error' in body ? body.error : `request failed (${res.status})`)
      setData(body as RecordRoomPage)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'failed to load record room')
    } finally {
      setLoading(false)
    }
  }, [])

  const loadDeep = useCallback(
    async (page: number, format: 'json' | 'csv' = 'json') => {
      setLoading(true)
      setError(null)
      try {
        const res = await fetch('/api/league/record-room/deep', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            page,
            pageSize: 20,
            modelId: modelId.trim() || undefined,
            from: from.trim() || undefined,
            to: to.trim() || undefined,
            format,
          }),
        })
        if (format === 'csv') {
          if (!res.ok) {
            const body = (await res.json().catch(() => null)) as
              | { error?: string; required?: number; balance?: number }
              | null
            if (res.status === 402 && body?.required != null && body.balance != null) {
              throw new Error(t.recordRoom.insufficientCredits(body.required, body.balance))
            }
            throw new Error(body?.error ?? `request failed (${res.status})`)
          }
          const blob = await res.blob()
          const url = URL.createObjectURL(blob)
          const a = document.createElement('a')
          a.href = url
          a.download = 'league-archive.csv'
          a.click()
          URL.revokeObjectURL(url)
          return
        }
        const body = (await res.json()) as RecordRoomPage | { error: string; required?: number; balance?: number }
        if (!res.ok) {
          if (res.status === 402 && 'required' in body && 'balance' in body && body.required != null && body.balance != null) {
            throw new Error(t.recordRoom.insufficientCredits(body.required, body.balance))
          }
          throw new Error('error' in body ? body.error : `request failed (${res.status})`)
        }
        setData(body as RecordRoomPage)
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : 'failed to load record room')
      } finally {
        setLoading(false)
      }
    },
    [from, modelId, t.recordRoom, to]
  )

  return (
    <div dir={dir}>
      <div className="flex items-center justify-between gap-2 pb-1">
        <p className="truncate text-[11px] text-rose-600">{error ?? ''}</p>
        <LanguageToggle locale={locale} onChange={setLocale} label={t.languageToggleLabel} />
      </div>
      <CardCompliance colorBucket="green" t={t}>
        {(receipt) => (
          <RecordRoomBody
            data={data}
            receipt={receipt}
            t={t}
            deepCost={DEEP_COST}
            loading={loading}
            modelId={modelId}
            from={from}
            to={to}
            onModelIdChange={setModelId}
            onFromChange={setFrom}
            onToChange={setTo}
            onPageChange={(page) => {
              if (data.deep || page > 1) void loadDeep(page)
              else void loadFree()
            }}
            onDeepOpen={() => void loadDeep(1)}
            onExportCsv={() => void loadDeep(1, 'csv')}
          />
        )}
      </CardCompliance>
    </div>
  )
}
