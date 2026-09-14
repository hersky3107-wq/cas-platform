'use client'

import { useCallback, useState } from 'react'
import { creditsForLeagueArchive, creditsForLeagueRecordRoom } from '@/lib/credits'
import type { RecordRoomPage } from '@/lib/league/record-room-aggregate'
import { RECORD_ROOM_PURCHASE_ROUND_LIMIT } from '@/lib/league/view-purchase-policy'
import { useLeagueLocale } from '@/lib/league/i18n/use-league-locale'
import { CardCompliance } from './CardCompliance'
import { RecordRoomBody } from './RecordRoomBody'
import { LanguageToggle } from './LanguageToggle'

export type RecordRoomProps = {
  initialData: RecordRoomPage
  /** DEV-ONLY: forwarded to `useLeagueLocale`, same escape hatch `PredictionCard` uses. */
  devSignalsQuery?: string
  onRefreshWindow?: () => void
  refreshing?: boolean
}

const ARCHIVE_COST = creditsForLeagueArchive()
const ROOM_COST = creditsForLeagueRecordRoom()

/**
 * Paid record room: listing is the purchased 30-round window (GET).
 * CSV of that same window is a separate higher charge (POST /deep).
 */
export function RecordRoom({ initialData, devSignalsQuery, onRefreshWindow, refreshing }: RecordRoomProps) {
  const { locale, t, dir, setLocale } = useLeagueLocale(devSignalsQuery)
  const [data, setData] = useState(initialData)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [modelId, setModelId] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  const loadPage = useCallback(
    async (page: number) => {
      setLoading(true)
      setError(null)
      try {
        const params = new URLSearchParams({ page: String(page), pageSize: '20' })
        if (modelId.trim()) params.set('modelId', modelId.trim())
        if (from.trim()) params.set('from', from.trim())
        if (to.trim()) params.set('to', to.trim())
        const res = await fetch(`/api/league/record-room?${params.toString()}`, { credentials: 'include' })
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

  const exportCsv = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/league/record-room/deep', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          modelId: modelId.trim() || undefined,
          from: from.trim() || undefined,
          to: to.trim() || undefined,
          format: 'csv',
        }),
      })
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
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'failed to export record room')
    } finally {
      setLoading(false)
    }
  }, [from, modelId, t.recordRoom, to])

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
            locale={locale}
            archiveCost={ARCHIVE_COST}
            roomCost={ROOM_COST}
            windowRounds={data.window?.roundLimit ?? RECORD_ROOM_PURCHASE_ROUND_LIMIT}
            loading={loading || refreshing === true}
            modelId={modelId}
            from={from}
            to={to}
            onModelIdChange={setModelId}
            onFromChange={setFrom}
            onToChange={setTo}
            onPageChange={(page) => void loadPage(page)}
            onExportCsv={() => void exportCsv()}
            onRefreshWindow={onRefreshWindow}
          />
        )}
      </CardCompliance>
    </div>
  )
}
