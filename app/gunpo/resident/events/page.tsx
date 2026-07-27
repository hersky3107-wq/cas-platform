'use client'

/**
 * 축제·행사 — Gunpo resident events chip. Cloned from
 * app/jeju/resident/events/page.tsx, group set matches
 * lib/gunpo/resident/events.ts (도정시정 → 시정행사).
 *
 * STEP5: backend dropped the 문화정보원 API entirely — every item now comes
 * from Perplexity search (군포시청 공식 행사·축제 안내), always carries a
 * source url, and `source` is always '검색'.
 *
 * Data: GET /api/gunpo/resident/events
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { FriendlyErrors } from '@/components/gunpo/FriendlyErrors'

interface EventItem {
  title: string
  group: string
  place: string | null
  startDate: string | null
  endDate: string | null
  price: string | null
  url: string | null
  status: '진행중' | '예정'
  source: '검색'
  asOf: string | null
}
type EventGroups = Record<string, EventItem[]>
interface ContextMeta {
  source: string
  retrievedAt: string
  asOf: string | null
}
interface EventsPayload {
  ok: true
  windowDays: number
  today: string
  groups: EventGroups
  contextMeta: ContextMeta
  freshnessNote: string
  updatedAt: string
  errors: string[]
  fromCache: boolean
}
type EventsResult = EventsPayload | { ok: false; error: string }

const GROUP_LABELS: { key: string; label: string; emoji: string }[] = [
  { key: '축제', label: '축제', emoji: '🎉' },
  { key: '공연전시', label: '공연·전시', emoji: '🎭' },
  { key: '체험강좌', label: '체험·강좌', emoji: '🎨' },
  { key: '시정행사', label: '시정 행사', emoji: '🏛' },
  { key: '기타', label: '기타', emoji: '📌' },
]

function fmtDateRange(start: string | null, end: string | null): string {
  if (!start) return '날짜 미정'
  if (!end || end === start) return start
  const [sy, sm, sd] = start.split('-')
  const [ey, em, ed] = end.split('-')
  if (sy === ey && sm === em) return `${Number(sm)}월 ${Number(sd)}일~${Number(ed)}일`
  if (sy === ey) return `${Number(sm)}월 ${Number(sd)}일 ~ ${Number(em)}월 ${Number(ed)}일`
  return `${start} ~ ${end}`
}

function fmtRetrieval(meta: ContextMeta): string {
  const date = meta.retrievedAt.slice(0, 10)
  return meta.asOf ? `🔍 검색 · ${meta.asOf} 기준 · ${date} 조회` : `🔍 검색 · ${date} 조회`
}

export default function GunpoEventsPage() {
  const router = useRouter()
  const [data, setData] = useState<EventsPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const fetchData = useCallback(async () => {
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setLoading(true)
    setFetchError(null)
    try {
      const res = await fetch('/api/gunpo/resident/events', { signal: ctrl.signal, cache: 'no-store' })
      const json = (await res.json()) as EventsResult
      if (!json.ok) {
        setFetchError((json as { ok: false; error: string }).error)
        setData(null)
      } else {
        setData(json as EventsPayload)
      }
    } catch (e: unknown) {
      if (e instanceof Error && e.name === 'AbortError') return
      setFetchError('행사 정보를 불러오지 못했어요. 잠시 후 다시 해주세요.')
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void fetchData()
    return () => abortRef.current?.abort()
  }, [fetchData])

  const totalCount = data ? Object.values(data.groups).reduce((sum, arr) => sum + arr.length, 0) : 0

  return (
    <div className="min-h-dvh bg-[#F3F6FB] text-[#0F172A]">
      <div className="sticky top-0 z-10 flex items-center gap-4 bg-[#1E3A8A] px-4 py-4 shadow-md">
        <button
          type="button"
          onClick={() => router.push('/gunpo/resident/general')}
          className="min-h-[48px] rounded-xl border-2 border-white/30 bg-white/15 px-4 text-lg font-bold text-white transition hover:bg-white/25"
        >
          ← 뒤로
        </button>
        <h1 className="text-2xl font-black text-white">🎉 축제·행사</h1>
      </div>

      <div className="mx-auto flex max-w-xl flex-col gap-4 px-4 py-6">
        {loading && (
          <div className="flex flex-col items-center gap-3 py-12" aria-live="polite" aria-busy="true">
            <span className="text-5xl">⏳</span>
            <p className="text-xl font-bold text-[#334155]">행사 정보 불러오는 중…</p>
          </div>
        )}

        {!loading && fetchError && (
          <div className="flex flex-col items-center gap-4 rounded-2xl border-2 border-red-300 bg-red-50 p-6" role="alert">
            <p className="text-lg font-bold text-red-700">⚠ {fetchError}</p>
            <button
              type="button"
              onClick={() => void fetchData()}
              className="min-h-[48px] rounded-xl bg-[#1E3A8A] px-6 text-lg font-bold text-white"
            >
              다시 시도
            </button>
          </div>
        )}

        {!loading && data && (
          <>
            <p className="rounded-xl bg-[#E0E7FF] px-4 py-2 text-sm font-semibold text-[#1E3A8A]">
              {data.today} ~ +{data.windowDays}일 · {data.freshnessNote}
            </p>

            {totalCount === 0 ? (
              <div className="rounded-2xl border-2 border-[#CBD5E1] bg-white p-6">
                <p className="text-lg text-[#64748B]">앞으로 2주 이내 예정된 행사가 없어요.</p>
              </div>
            ) : (
              GROUP_LABELS.map(({ key, label, emoji }) => {
                const items = data.groups[key] ?? []
                if (items.length === 0) return null
                return (
                  <section key={key} className="rounded-2xl border-2 border-[#CBD5E1] bg-white p-5 shadow-sm">
                    <h2 className="mb-3 text-lg font-black text-[#1E3A8A]">
                      {emoji} {label} <span className="text-sm font-semibold text-[#94A3B8]">({items.length})</span>
                    </h2>
                    <div className="flex flex-col gap-3">
                      {items.map((ev, i) => (
                        <article key={`${key}-${i}`} className="flex flex-col gap-1.5 border-b border-[#F1F5F9] pb-3 last:border-b-0 last:pb-0">
                          <div className="flex items-center gap-2">
                            <span
                              className={`rounded-md px-2 py-0.5 text-xs font-bold ${
                                ev.status === '진행중' ? 'bg-[#DCFCE7] text-[#166534]' : 'bg-[#DBEAFE] text-[#1E40AF]'
                              }`}
                            >
                              {ev.status}
                            </span>
                            <h3 className="text-base font-bold text-[#0F172A]">{ev.title}</h3>
                          </div>
                          <p className="text-sm text-[#475569]">{fmtDateRange(ev.startDate, ev.endDate)}</p>
                          {ev.place && <p className="text-sm text-[#64748B]">📍 {ev.place}</p>}
                          {ev.price && <p className="text-sm text-[#64748B]">💰 {ev.price}</p>}
                          <div className="flex items-center gap-2">
                            <span className="rounded bg-[#E0E7FF] px-2 py-0.5 text-xs font-bold text-[#1E3A8A]">
                              {ev.source}
                            </span>
                            {ev.url ? (
                              <a href={ev.url} target="_blank" rel="noreferrer" className="text-xs font-bold text-[#1E3A8A] underline">
                                출처 보기
                              </a>
                            ) : (
                              <span className="text-xs font-bold text-[#DC2626]">출처 미확인</span>
                            )}
                          </div>
                        </article>
                      ))}
                    </div>
                  </section>
                )
              })
            )}

            <p className="text-sm text-[#64748B]">{fmtRetrieval(data.contextMeta)}</p>
            <FriendlyErrors errors={data.errors} />
          </>
        )}
      </div>
    </div>
  )
}
