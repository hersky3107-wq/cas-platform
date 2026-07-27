'use client'

/**
 * 언론 — Gunpo resident local-news briefing chip. Cloned from
 * app/jeju/resident/news/page.tsx (region term swapped, category set matches
 * lib/gunpo/resident/news.ts).
 *
 * Data: GET /api/gunpo/resident/news
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { FriendlyErrors } from '@/components/gunpo/FriendlyErrors'

const CATEGORY_ORDER = ['정치·행정', '경제·산업', '생활·물가', '교통', '날씨·재난·안전', '사회·사건', '행사·축제'] as const

interface NewsItem {
  category: string
  headline: string
  summary: string
  why: string
  source: string | null
  asOf: string | null
}
interface ContextMeta {
  source: string
  retrievedAt: string
  asOf: string | null
}
interface NewsPayload {
  ok: true
  briefing: NewsItem[]
  contextMeta: ContextMeta
  freshnessNote: string
  updatedAt: string
  errors: string[]
  fromCache?: boolean
}
type NewsResult = NewsPayload | { ok: false; error: string }

function fmtRetrieval(meta: ContextMeta): string {
  const date = meta.retrievedAt.slice(0, 10)
  return meta.asOf ? `🔍 검색 · ${meta.asOf} 기준 · ${date} 조회` : `🔍 검색 · ${date} 조회`
}

function fmtAsOf(ymd: string | null): string {
  if (!ymd) return ''
  const m = ymd.match(/(\d{4})-(\d{2})-(\d{2})/)
  return m ? `${Number(m[2])}월 ${Number(m[3])}일` : ymd
}

function groupByCategory(items: NewsItem[]): Map<string, NewsItem[]> {
  const map = new Map<string, NewsItem[]>()
  for (const cat of CATEGORY_ORDER) map.set(cat, [])
  for (const it of items) {
    const list = map.get(it.category) ?? []
    list.push(it)
    map.set(it.category, list)
  }
  return map
}

export default function GunpoNewsPage() {
  const router = useRouter()
  const [data, setData] = useState<NewsPayload | null>(null)
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
      const res = await fetch('/api/gunpo/resident/news', { signal: ctrl.signal, cache: 'no-store' })
      const json = (await res.json()) as NewsResult
      if (!json.ok) {
        setFetchError((json as { ok: false; error: string }).error)
        setData(null)
      } else {
        setData(json as NewsPayload)
      }
    } catch (e: unknown) {
      if (e instanceof Error && e.name === 'AbortError') return
      setFetchError('소식을 불러오지 못했어요. 잠시 후 다시 해주세요.')
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void fetchData()
    return () => abortRef.current?.abort()
  }, [fetchData])

  const grouped = data ? groupByCategory(data.briefing) : null
  const hasItems = (data?.briefing.length ?? 0) > 0

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
        <h1 className="flex-1 text-2xl font-black text-white">📰 언론</h1>
        <button
          type="button"
          onClick={() => void fetchData()}
          disabled={loading}
          aria-label="새로 고침"
          className="min-h-[48px] min-w-[48px] rounded-xl border-2 border-white/30 bg-white/15 text-xl font-bold text-white transition hover:bg-white/25"
        >
          {loading ? '⏳' : '🔄'}
        </button>
      </div>

      <div className="mx-auto flex max-w-xl flex-col gap-4 px-4 py-6">
        {loading && (
          <div className="flex flex-col items-center gap-3 py-12" aria-live="polite" aria-busy="true">
            <span className="text-5xl">⏳</span>
            <p className="text-xl font-bold text-[#334155]">군포 소식 불러오는 중…</p>
            <p className="text-sm text-[#64748B]">처음 불러올 때는 10~20초 걸릴 수 있어요</p>
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
            <div className="flex flex-wrap items-center gap-2">
              <p className="rounded-xl bg-[#E0E7FF] px-4 py-2 text-sm font-semibold text-[#1E3A8A]">{data.freshnessNote}</p>
              {data.fromCache && (
                <span className="rounded-lg border border-[#CBD5E1] bg-[#F1F5F9] px-3 py-1 text-xs font-bold text-[#475569]">
                  오늘 정리본
                </span>
              )}
            </div>

            {!hasItems ? (
              <div className="rounded-2xl border-2 border-[#CBD5E1] bg-white p-6">
                <p className="text-lg text-[#64748B]">최근 3일 안에 군포 관련 소식이 없어요.</p>
              </div>
            ) : (
              CATEGORY_ORDER.map((cat) => {
                const items = grouped?.get(cat) ?? []
                if (items.length === 0) return null
                return (
                  <section key={cat} className="rounded-2xl border-2 border-[#CBD5E1] bg-white p-5 shadow-sm">
                    <h2 className="mb-3 border-b-2 border-[#E2E8F0] pb-2 text-lg font-black text-[#1E3A8A]">{cat}</h2>
                    <div className="flex flex-col gap-4">
                      {items.map((it, i) => (
                        <article key={`${cat}-${i}`} className="flex flex-col gap-2 border-b border-[#F1F5F9] pb-4 last:border-b-0 last:pb-0">
                          <h3 className="text-lg font-extrabold leading-snug text-[#0F172A]">{it.headline}</h3>
                          <p className="text-base leading-relaxed text-[#334155]">{it.summary}</p>
                          {it.why && (
                            <p className="rounded-lg bg-[#F1F5F9] px-3 py-2 text-sm text-[#475569]">
                              <span className="font-bold text-[#1E3A8A]">왜 중요한가</span> {it.why}
                            </p>
                          )}
                          <div className="flex flex-wrap items-center gap-2">
                            {it.source && (
                              <span className="rounded-md bg-[#E0E7FF] px-2 py-0.5 text-xs font-bold text-[#1E3A8A]">
                                {it.source}
                              </span>
                            )}
                            {it.asOf && <span className="text-xs font-semibold text-[#94A3B8]">{fmtAsOf(it.asOf)}</span>}
                          </div>
                        </article>
                      ))}
                    </div>
                  </section>
                )
              })
            )}

            <p className="text-sm text-[#64748B]">{fmtRetrieval(data.contextMeta)}</p>
            <p className="text-sm text-[#64748B]">자료: 🔍 검색 (경기 지역·전국지 군포 보도)</p>

            <FriendlyErrors errors={data.errors} />
          </>
        )}
      </div>
    </div>
  )
}
