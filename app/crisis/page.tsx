'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { CrisisLanguageToggle } from '@/components/crisis/LanguageToggle'
import { CrisisPulseStyles } from '@/components/crisis/CrisisPulseStyles'
import { HazardIconRow } from '@/components/crisis/HazardIcon'
import { authenticatedFetch } from '@/lib/api/authenticated-fetch'
import { projectLonLat, stageColor } from '@/lib/crisis/admin/geo'
import { CRISIS_BRIEF_CREDITS, CRISIS_DEEP_CREDITS } from '@/lib/crisis/credits'
import { stageBannerText } from '@/lib/crisis/i18n/dictionary'
import { useCrisisLocale } from '@/lib/crisis/i18n/use-crisis-locale'
import { shouldPulse } from '@/lib/crisis/public/policy'
import { hazardIconsFor } from '@/lib/crisis/ui/hazards'
import { severityTheme } from '@/lib/crisis/ui/severity'
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

type DeepStatus = 'idle' | 'pending' | 'ready' | 'cached' | 'failed'

export default function CrisisMapPage() {
  const { locale, t, dir, setLocale } = useCrisisLocale()
  const [ready, setReady] = useState(false)
  const [day, setDay] = useState<string | null>(null)
  const [regions, setRegions] = useState<MapRegion[]>([])
  const [error, setError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [deepStatus, setDeepStatus] = useState<DeepStatus>('idle')
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
        const [mapRes, deepCheckRes] = await Promise.all([
          authenticatedFetch('/api/crisis/map'),
          authenticatedFetch('/api/crisis/deep'),
        ])
        const body = (await mapRes.json().catch(() => null)) as { day?: string; regions?: MapRegion[]; error?: string }
        if (!mapRes.ok) throw new Error(body?.error ?? t.mapLoadError)
        setDay(body.day ?? null)
        setRegions(body.regions ?? [])

        const deepCheck = (await deepCheckRes.json().catch(() => null)) as {
          activeRegionId?: number | null
          message?: string | null
        }
        if (deepCheck?.activeRegionId) {
          setSelectedId(deepCheck.activeRegionId)
          setDeepStatus('pending')
        }
        if (deepCheck?.message) setDeepMsg(deepCheck.message)
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : t.mapLoadError)
      }
    })()
  }, [t.mapLoadError])

  useEffect(() => {
    if (!selectedId) {
      setDeepMsg(null)
      setDeepStatus('idle')
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const res = await authenticatedFetch(`/api/crisis/deep?regionId=${selectedId}`)
        const body = (await res.json().catch(() => null)) as {
          status?: string
          message?: string
          cached?: boolean
        }
        if (cancelled) return
        if (body?.status === 'failed') {
          setDeepStatus('failed')
          setDeepMsg(body.message ?? t.deepFailed)
        } else if (body?.status === 'ready') {
          setDeepStatus(body.cached ? 'cached' : 'ready')
          setDeepMsg(body.cached ? t.deepCached : t.deepReady)
        } else if (body?.status === 'pending') {
          setDeepStatus('pending')
          setDeepMsg(body.message ?? t.deepWait)
        } else {
          setDeepStatus('idle')
          setDeepMsg(null)
        }
      } catch {
        if (!cancelled) {
          setDeepStatus('idle')
          setDeepMsg(null)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [selectedId, t.deepCached, t.deepFailed, t.deepReady, t.deepWait])

  useEffect(() => {
    if (deepStatus !== 'pending' || !selectedId) return
    const timer = setInterval(() => {
      void (async () => {
        try {
          const res = await authenticatedFetch(`/api/crisis/deep?regionId=${selectedId}`)
          const body = (await res.json().catch(() => null)) as {
            status?: string
            message?: string
            cached?: boolean
          }
          if (body?.status === 'failed') {
            setDeepStatus('failed')
            setDeepMsg(t.deepFailed)
          } else if (body?.status === 'ready') {
            setDeepStatus(body.cached ? 'cached' : 'ready')
            setDeepMsg(body.cached ? t.deepCached : t.deepReady)
          }
        } catch {
          // ignore polling error
        }
      })()
    }, 10_000)
    return () => clearInterval(timer)
  }, [deepStatus, selectedId, t.deepCached, t.deepFailed, t.deepReady])

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
        code?: string
      }
      if (res.status === 402) throw new Error(t.notEnoughCredits)
      if (res.status === 429) {
        if (body?.code === 'active_request_exists') throw new Error(t.limitActive)
        if (body?.code === 'daily_limit_exceeded') throw new Error(t.limitDaily)
        throw new Error(body?.error ?? t.requestFailed)
      }
      if (!res.ok) throw new Error(body?.error ?? t.requestFailed)
      if (body.status === 'failed') {
        setDeepStatus('failed')
        setDeepMsg(t.deepFailed)
      } else if (body.status === 'pending') {
        setDeepStatus('pending')
        setDeepMsg(body.message ?? t.deepWait)
      } else if (body.status === 'ready') {
        setDeepStatus(body.cached ? 'cached' : 'ready')
        setDeepMsg(body.cached ? t.deepCached : t.deepReady)
      } else {
        setDeepMsg(body.message ?? t.deepRequested)
      }
    } catch (e: unknown) {
      setDeepMsg(e instanceof Error ? e.message : t.requestFailed)
    } finally {
      setBusy(false)
    }
  }

  if (!ready) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#03050c] text-slate-400" dir={dir}>
        {t.loading}
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-[#03050c] text-white" dir={dir}>
      <CrisisPulseStyles />
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(34,211,238,0.12),transparent_45%),radial-gradient(circle_at_80%_80%,rgba(251,113,133,0.08),transparent_40%)]" />
      <div className="relative mx-auto max-w-6xl space-y-6 px-4 py-8">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-cyan-300/80">{t.brand}</p>
            <h1 className="mt-1 text-3xl font-black tracking-tight">{t.mapTitle}</h1>
            <p className="mt-1 text-sm text-slate-400">{t.mapSubtitle(day ?? '—')}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <CrisisLanguageToggle locale={locale} onChange={setLocale} label={t.languageToggle} />
            <Link
              href="/crisis/briefing"
              className="rounded-xl border border-cyan-400/30 bg-cyan-500/10 px-4 py-2 text-sm font-semibold text-cyan-100 hover:bg-cyan-500/20"
            >
              {t.briefingLink} →
            </Link>
          </div>
        </header>

        {error ? (
          <div className="rounded-2xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">{error}</div>
        ) : null}

        <section className="overflow-hidden rounded-3xl border border-white/10 bg-black/40 shadow-[0_0_80px_rgba(34,211,238,0.08)]">
          <svg viewBox={`0 0 ${MAP_W} ${MAP_H}`} className="h-auto w-full" role="img" aria-label={t.mapTitle}>
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
              const isSelected = row.regionId === selectedId
              return (
                <g
                  key={row.regionId}
                  transform={`translate(${pt.x} ${pt.y})`}
                  className="cursor-pointer"
                  onClick={() => setSelectedId(row.regionId)}
                >
                  {pulse ? <circle r={7} fill={color} opacity={0.35} className="crisis-flare" /> : null}
                  <circle
                    r={isSelected ? 8 : row.stage >= 4 ? 6 : 3.6}
                    fill={color}
                    filter="url(#crisis-glow)"
                    stroke={isSelected ? '#fff' : 'transparent'}
                    strokeWidth={1.4}
                  >
                    <title>{`${row.name} · ${row.country} · ${t.stageWord} ${row.stage}`}</title>
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
              {t.stageWord} {stage}
              {shouldPulse(stage) ? ` · ${t.pulse}` : ''}
            </span>
          ))}
        </div>

        <section className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03]">
          <div className="grid grid-cols-12 gap-2 border-b border-white/10 px-4 py-3 text-xs font-semibold text-slate-400">
            <div className="col-span-4">{t.colRegion}</div>
            <div className="col-span-3">{t.colCountry}</div>
            <div className="col-span-1">{t.colStage}</div>
            <div className="col-span-1 text-right">{t.colScore}</div>
            <div className="col-span-3">{t.colTriggers}</div>
          </div>
          {regions.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-slate-500">{t.noScores}</p>
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
        <aside
          className={`fixed inset-y-0 right-0 z-20 flex w-full max-w-md flex-col border-l bg-[#070b16]/95 p-5 shadow-[-20px_0_80px_rgba(0,0,0,0.55)] backdrop-blur ${
            severityTheme(selected.stage).pulseBorder ? 'crisis-pulse-border' : ''
          }`}
          style={{ borderColor: severityTheme(selected.stage).border }}
        >
          <div
            className="mb-4 rounded-xl px-3 py-2 text-sm font-black"
            style={{
              background: severityTheme(selected.stage).bannerBg,
              color: severityTheme(selected.stage).color,
            }}
          >
            {stageBannerText(selected.stage, t)}
          </div>
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <p className="text-[11px] uppercase tracking-[0.2em] text-cyan-300/70">{t.freeLayer}</p>
              <h2 className="text-2xl font-black">{selected.name}</h2>
              <p className="text-sm text-slate-400">{selected.country}</p>
              <div className="mt-2">
                <HazardIconRow kinds={hazardIconsFor(selected.triggers)} color={stageColor(selected.stage)} />
              </div>
            </div>
            <button type="button" onClick={() => setSelectedId(null)} className="rounded-lg border border-white/15 px-2 py-1 text-xs text-slate-300">
              {t.close}
            </button>
          </div>
          <dl className="space-y-3 text-sm">
            <div>
              <dt className="text-xs uppercase tracking-wide text-slate-500">{t.colStage}</dt>
              <dd className="mt-1 text-3xl font-black" style={{ color: stageColor(selected.stage) }}>
                {selected.stage}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-slate-500">{t.colTriggers}</dt>
              <dd className="mt-1 flex flex-wrap gap-1">
                {selected.triggers.length === 0
                  ? '—'
                  : selected.triggers.map((key) => (
                      <span key={key} className="rounded-full border border-white/12 px-2 py-0.5 text-xs">
                        {key}
                      </span>
                    ))}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-slate-500">{t.fragility}</dt>
              <dd className="mt-1 text-slate-200">{selected.fragility.length ? selected.fragility.join(', ') : '—'}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-slate-500">{t.population}</dt>
              <dd className="mt-1 text-slate-200">
                {selected.peopleNorm != null ? t.exposure(selected.peopleNorm.toFixed(2)) : '—'}
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
              {t.briefingLocked(CRISIS_BRIEF_CREDITS)}
            </Link>
            <button
              type="button"
              onClick={() => void requestDeep()}
              disabled={busy}
              className="w-full rounded-xl bg-cyan-600 px-4 py-3 text-sm font-semibold text-white hover:bg-cyan-500 disabled:opacity-50"
            >
              {busy ? t.requesting : t.deepAnalyze(CRISIS_DEEP_CREDITS)}
            </button>
            {deepMsg ? <p className="text-xs text-cyan-200">{deepMsg}</p> : null}
          </div>
        </aside>
      ) : null}
    </main>
  )
}
