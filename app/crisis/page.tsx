'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { authenticatedFetch } from '@/lib/api/authenticated-fetch'
import { projectLonLat, stageColor } from '@/lib/crisis/admin/geo'
import { CRISIS_BRIEF_CREDITS, CRISIS_DEEP_CREDITS } from '@/lib/crisis/credits'
import { shouldPulse } from '@/lib/crisis/public/policy'
import { supabase } from '@/lib/db/supabase'

const MAP_W = 900
const MAP_H = 440

type MapRegion = {
  regionId: number
  name: string
  country: string
  stage: number
  score: number
  triggers: string[]
  lat: number
  lon: number
  fragility: string[]
  peopleNorm: number | null
  urban: Array<{ name: string; pop: number }>
}

export default function CrisisMapPage() {
  const [ready, setReady] = useState(false)
  const [day, setDay] = useState<string | null>(null)
  const [regions, setRegions] = useState<MapRegion[]>([])
  const [error, setError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [deepMsg, setDeepMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void (async () => {
      const { data } = await supabase.auth.getUser()
      if (!data.user) {
        window.location.href = `/auth?redirectTo=${encodeURIComponent('/crisis')}`
        return
      }
      setReady(true)
      try {
        const res = await authenticatedFetch('/api/crisis/map')
        const body = (await res.json().catch(() => null)) as { day?: string; regions?: MapRegion[]; error?: string }
        if (!res.ok) throw new Error(body?.error ?? '지도를 불러오지 못했습니다')
        setDay(body.day ?? null)
        setRegions(body.regions ?? [])
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : '지도를 불러오지 못했습니다')
      }
    })()
  }, [])

  const selected = useMemo(() => regions.find((row) => row.regionId === selectedId) ?? null, [regions, selectedId])

  async function requestDeep() {
    if (!selected || busy) return
    setBusy(true)
    setDeepMsg(null)
    try {
      const res = await authenticatedFetch('/api/crisis/deep', { method: 'POST', json: { regionId: selected.regionId } })
      const body = (await res.json().catch(() => null)) as {
        status?: string
        message?: string
        error?: string
        cached?: boolean
      }
      if (res.status === 402) throw new Error('크레딧이 부족합니다')
      if (!res.ok) throw new Error(body?.error ?? '요청에 실패했습니다')
      if (body.status === 'pending') setDeepMsg(body.message ?? '분석 중, 최대 15분')
      else if (body.status === 'ready') setDeepMsg(body.cached ? '캐시된 브리핑을 열었습니다.' : '분석이 준비되었습니다.')
      else setDeepMsg(body.message ?? '요청되었습니다.')
    } catch (e: unknown) {
      setDeepMsg(e instanceof Error ? e.message : '요청에 실패했습니다')
    } finally {
      setBusy(false)
    }
  }

  if (!ready) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#03050c] text-slate-400">
        Loading…
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-[#03050c] text-white">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(34,211,238,0.12),transparent_45%),radial-gradient(circle_at_80%_80%,rgba(251,113,133,0.08),transparent_40%)]" />
      <div className="relative mx-auto max-w-6xl space-y-6 px-4 py-8">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-cyan-300/80">CrisisWatch</p>
            <h1 className="mt-1 text-3xl font-black tracking-tight">오늘의 위험 지도</h1>
            <p className="mt-1 text-sm text-slate-400">UTC {day ?? '—'} · 원이 밝을수록 단계가 높습니다</p>
          </div>
          <Link
            href="/crisis/briefing"
            className="rounded-xl border border-cyan-400/30 bg-cyan-500/10 px-4 py-2 text-sm font-semibold text-cyan-100 hover:bg-cyan-500/20"
          >
            AI 브리핑 →
          </Link>
        </header>

        {error ? (
          <div className="rounded-2xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">{error}</div>
        ) : null}

        <section className="overflow-hidden rounded-3xl border border-white/10 bg-black/40 shadow-[0_0_80px_rgba(34,211,238,0.08)]">
          <svg viewBox={`0 0 ${MAP_W} ${MAP_H}`} className="h-auto w-full" role="img" aria-label="CrisisWatch world map">
            <defs>
              <filter id="crisis-glow" x="-50%" y="-50%" width="200%" height="200%">
                <feGaussianBlur stdDeviation="3.2" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>
            <rect width={MAP_W} height={MAP_H} fill="#050816" />
            {[...Array(7)].map((_, i) => (
              <line key={`lat-${i}`} x1="0" x2={MAP_W} y1={(i / 6) * MAP_H} y2={(i / 6) * MAP_H} stroke="rgba(34,211,238,0.06)" />
            ))}
            {[...Array(13)].map((_, i) => (
              <line key={`lon-${i}`} y1="0" y2={MAP_H} x1={(i / 12) * MAP_W} x2={(i / 12) * MAP_W} stroke="rgba(34,211,238,0.05)" />
            ))}
            {regions.map((row) => {
              const pt = projectLonLat(row.lon, row.lat, MAP_W, MAP_H)
              const color = stageColor(row.stage)
              const pulse = shouldPulse(row.stage)
              const selected = row.regionId === selectedId
              return (
                <g
                  key={row.regionId}
                  transform={`translate(${pt.x} ${pt.y})`}
                  className="cursor-pointer"
                  onClick={() => setSelectedId(row.regionId)}
                >
                  {pulse ? (
                    <circle r={pulse ? 7 : 4} fill={color} opacity={0.35} className="crisis-flare" />
                  ) : null}
                  <circle
                    r={selected ? 8 : row.stage >= 4 ? 6 : 3.6}
                    fill={color}
                    filter="url(#crisis-glow)"
                    stroke={selected ? '#fff' : 'transparent'}
                    strokeWidth={1.4}
                  >
                    <title>{`${row.name} · ${row.country} · stage ${row.stage}`}</title>
                  </circle>
                </g>
              )
            })}
          </svg>
        </section>

        <div className="flex flex-wrap gap-3 text-xs text-slate-400">
          {[1, 2, 3, 4, 5].map((stage) => (
            <span key={stage} className="inline-flex items-center gap-1.5">
              <span
                className={`inline-block h-2.5 w-2.5 rounded-full ${shouldPulse(stage) ? 'crisis-flare-dot' : ''}`}
                style={{ background: stageColor(stage), boxShadow: `0 0 10px ${stageColor(stage)}` }}
              />
              Stage {stage}
              {shouldPulse(stage) ? ' · pulse' : ''}
            </span>
          ))}
        </div>

        <section className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03]">
          <div className="grid grid-cols-12 gap-2 border-b border-white/10 px-4 py-3 text-xs font-semibold text-slate-400">
            <div className="col-span-4">지역</div>
            <div className="col-span-3">국가</div>
            <div className="col-span-1">단계</div>
            <div className="col-span-1 text-right">점수</div>
            <div className="col-span-3">트리거</div>
          </div>
          {regions.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-slate-500">오늘 점수 데이터가 없습니다.</p>
          ) : (
            <div className="divide-y divide-white/8">
              {regions.map((row) => (
                <button
                  key={row.regionId}
                  type="button"
                  onClick={() => setSelectedId(row.regionId)}
                  className={`grid w-full grid-cols-12 items-center gap-2 px-4 py-3 text-left text-sm hover:bg-white/[0.04] ${
                    selectedId === row.regionId ? 'bg-cyan-500/10' : ''
                  }`}
                >
                  <div className="col-span-4 truncate font-semibold">{row.name}</div>
                  <div className="col-span-3 truncate text-slate-300">{row.country}</div>
                  <div className="col-span-1 text-cyan-100">{row.stage}</div>
                  <div className="col-span-1 text-right tabular-nums">{row.score}</div>
                  <div className="col-span-3 flex flex-wrap gap-1">
                    {row.triggers.map((key) => (
                      <span key={key} className="rounded-full border border-cyan-400/20 bg-cyan-500/10 px-2 py-0.5 text-[10px] text-cyan-100">
                        {key}
                      </span>
                    ))}
                  </div>
                </button>
              ))}
            </div>
          )}
        </section>
      </div>

      {selected ? (
        <aside className="fixed inset-y-0 right-0 z-20 flex w-full max-w-md flex-col border-l border-cyan-400/20 bg-[#070b16]/95 p-5 shadow-[-20px_0_80px_rgba(0,0,0,0.55)] backdrop-blur">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <p className="text-[11px] uppercase tracking-[0.2em] text-cyan-300/70">Free layer</p>
              <h2 className="text-xl font-bold">{selected.name}</h2>
              <p className="text-sm text-slate-400">{selected.country}</p>
            </div>
            <button type="button" onClick={() => setSelectedId(null)} className="rounded-lg border border-white/15 px-2 py-1 text-xs text-slate-300">
              닫기
            </button>
          </div>
          <dl className="space-y-3 text-sm">
            <div>
              <dt className="text-xs uppercase tracking-wide text-slate-500">단계</dt>
              <dd className="mt-1 text-2xl font-black" style={{ color: stageColor(selected.stage) }}>
                {selected.stage}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-slate-500">트리거</dt>
              <dd className="mt-1 flex flex-wrap gap-1">
                {selected.triggers.length === 0 ? '—' : selected.triggers.map((key) => (
                  <span key={key} className="rounded-full border border-white/12 px-2 py-0.5 text-xs">
                    {key}
                  </span>
                ))}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-slate-500">취약 시설</dt>
              <dd className="mt-1 text-slate-200">{selected.fragility.length ? selected.fragility.join(', ') : '—'}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-slate-500">인구</dt>
              <dd className="mt-1 text-slate-200">
                {selected.peopleNorm != null ? `노출 ${selected.peopleNorm.toFixed(2)}` : '—'}
                {selected.urban.length
                  ? ` · ${selected.urban.map((row) => `${row.name} ${row.pop ? Math.round(row.pop).toLocaleString() : ''}`).join(', ')}`
                  : ''}
              </dd>
            </div>
          </dl>
          <div className="mt-auto space-y-2 pt-6">
            <Link
              href="/crisis/briefing"
              className="block rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-center text-sm font-semibold text-slate-300"
            >
              AI 브리핑 잠김 · {CRISIS_BRIEF_CREDITS}크레딧
            </Link>
            <button
              type="button"
              onClick={() => void requestDeep()}
              disabled={busy}
              className="w-full rounded-xl bg-cyan-600 px-4 py-3 text-sm font-semibold text-white hover:bg-cyan-500 disabled:opacity-50"
            >
              {busy ? '요청 중…' : `이 지역 정밀 분석 · ${CRISIS_DEEP_CREDITS}크레딧`}
            </button>
            {deepMsg ? <p className="text-xs text-cyan-200">{deepMsg}</p> : null}
          </div>
        </aside>
      ) : null}

      <style jsx global>{`
        @keyframes crisis-flare {
          0% { transform: scale(1); opacity: 0.55; }
          100% { transform: scale(3.1); opacity: 0; }
        }
        .crisis-flare {
          transform-origin: center;
          animation: crisis-flare 1.8s ease-out infinite;
        }
        @keyframes crisis-flare-dot {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.35; }
        }
        .crisis-flare-dot { animation: crisis-flare-dot 1.6s ease-in-out infinite; }
      `}</style>
    </main>
  )
}
