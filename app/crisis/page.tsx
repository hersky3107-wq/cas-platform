'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { DeepProgress } from '@/components/crisis/DeepProgress'
import { CrisisLanguageToggle } from '@/components/crisis/LanguageToggle'
import { CrisisPulseStyles } from '@/components/crisis/CrisisPulseStyles'
import { HazardIconRow } from '@/components/crisis/HazardIcon'
import { HazardMapLegend } from '@/components/crisis/HazardMapLegend'
import { PrecursorLayerShapes, PrecursorLayerToggles, usePrecursorGeo } from '@/components/crisis/PrecursorLayers'
import { TriggerChip } from '@/components/crisis/TriggerChip'
import { WorldBasemap } from '@/components/crisis/WorldBasemap'
import { UnlockedCardView, type UnlockedCard } from '@/components/crisis/briefing/BriefingCardsSection'
import { authenticatedFetch } from '@/lib/api/authenticated-fetch'
import { projectLonLat, stageColor } from '@/lib/crisis/admin/geo'
import { CRISIS_BRIEF_CREDITS, CRISIS_DEEP_CREDITS, CRISIS_GLOBAL_CREDITS, CRISIS_ZONE_CREDITS } from '@/lib/crisis/credits'
import { CRISIS_ZONES, zoneDisplayName, type ZoneKey } from '@/lib/crisis/zones'
import { stageBannerText, type CrisisUiPack } from '@/lib/crisis/i18n/dictionary'
import { countryDisplayName, regionDisplayName } from '@/lib/crisis/i18n/place-names'
import { useCrisisLocale } from '@/lib/crisis/i18n/use-crisis-locale'
import { formatPeopleShort, type TriggerFact } from '@/lib/crisis/public/format'
import type { ProgressGroup } from '@/lib/crisis/public/progress'
import { shouldPulse } from '@/lib/crisis/public/policy'
import { hazardIconsFor } from '@/lib/crisis/ui/hazards'
import { severityTheme } from '@/lib/crisis/ui/severity'
import { supabase } from '@/lib/db/supabase'

const MAP_W = 900
const MAP_H = 440
const TABLE_TOP = 200

type FragilityGroup = { kind: string; names: string[] }

type MapRegion = {
  regionId: number
  name: string
  country: string
  iso3: string | null
  stage: number
  score: number
  triggers: string[]
  lat: number
  lon: number
  fragility: string[]
  fragilityGroups?: FragilityGroup[]
  peopleNorm: number | null
  peopleCount?: number | null
  urban: Array<{ name: string; pop: number }>
  triggerFacts?: TriggerFact[]
}

type DeepStatus = 'idle' | 'pending' | 'ready' | 'cached' | 'failed'

type DeepProgressState = {
  requestStatus: string
  elapsedSec: number
  waitingForWorker: boolean
  groups: ProgressGroup[]
}

type DeepBody = {
  status?: string
  message?: string
  cached?: boolean
  card?: UnlockedCard
  error?: string
  code?: string
  requestStatus?: string
  elapsedSec?: number
  waitingForWorker?: boolean
  groups?: ProgressGroup[]
}

function applyDeepBody(
  body: DeepBody,
  t: CrisisUiPack,
  setStatus: (s: DeepStatus) => void,
  setMsg: (m: string | null) => void,
  setCard: (c: UnlockedCard | null) => void,
  setProgress: (p: DeepProgressState | null) => void,
) {
  if (body.status === 'failed') {
    setStatus('failed')
    setMsg(body.message ?? t.deepFailed)
    setCard(null)
    setProgress(null)
    return
  }
  if (body.status === 'ready') {
    setStatus(body.cached ? 'cached' : 'ready')
    setMsg(body.cached ? t.deepCached : t.deepReady)
    setCard(body.card ?? null)
    setProgress(null)
    return
  }
  if (body.status === 'pending') {
    setStatus('pending')
    setMsg(body.waitingForWorker ? t.workerWaiting : (body.message ?? t.deepWait))
    setCard(null)
    setProgress({
      requestStatus: body.requestStatus ?? 'queued',
      elapsedSec: body.elapsedSec ?? 0,
      waitingForWorker: Boolean(body.waitingForWorker),
      groups: body.groups ?? [],
    })
    return
  }
  setStatus('idle')
  setMsg(null)
  setCard(null)
  setProgress(null)
}

function triggerFactLine(fact: TriggerFact, t: CrisisUiPack): string {
  if (fact.key === 'quake' && fact.rateMultiplier != null && fact.count7d != null && fact.usual7d != null) {
    return t.earthquakeProbabilityLine(fact.rateMultiplier, fact.count7d, fact.usual7d, fact.oaf)
  }
  if (fact.key === 'volcano' && fact.precursors && fact.precursors.length > 0) {
    return t.volcanoProbabilityLine(fact.precursors)
  }
  if (fact.key === 'heat' && fact.wetBulbC != null) {
    return t.heatForecastLine(fact.wetBulbC, fact.heatDays ?? 1, fact.anomalyC ?? null)
  }
  if (fact.key === 'cold' && fact.windChillC != null) {
    return t.coldForecastLine(fact.windChillC, fact.heatDays ?? 1, fact.anomalyC ?? null)
  }
  if (fact.key === 'drought' && fact.droughtFactors && fact.droughtFactors.length > 0) {
    return t.droughtForecastLine(fact.rainRatio ?? null, fact.droughtFactors)
  }
  if (fact.key === 'internet' && fact.outageCause) return t.internetCauseLine(fact.outageCause)
  if (fact.key === 'advisory' && fact.advisoryLevel != null) return t.advisoryReasonLine(fact.advisoryLevel, fact.advisoryReasons ?? [])
  if (fact.key === 'terror') return t.terrorRiskLine()
  if (fact.key === 'waterborne') return t.waterborneLine()
  if (fact.key === 'outbreak' && fact.disease) return t.outbreakLine(fact.disease)
  if (fact.key === 'space_weather' && fact.geomagneticG != null) return t.spaceWeatherLine(fact.geomagneticG)
  if (fact.key === 'slow_burn' && fact.risePct != null) return t.slowBurnRiseLine(fact.risePct)
  if (fact.expectedWindow) {
    const line = t.triggerChipLine(fact.key, fact.expectedWindow)
    if (fact.key === 'quake' && fact.oaf) return `${line} · ${t.aftershockWeekLine(fact.oaf.m5, fact.oaf.m6, fact.oaf.m7)}`
    return line
  }
  if (fact.key === 'rain' && fact.sumMm != null) {
    return t.rainForecast(fact.sumMm, fact.maxDayMm ?? 0)
  }
  if (fact.key === 'river' && fact.peakM3s != null) return t.riverPeak(fact.peakM3s)
  if (fact.key === 'quake' && fact.mag != null) {
    return fact.oaf
      ? `${t.quakeMag(fact.mag)} · ${t.aftershockWeekLine(fact.oaf.m5, fact.oaf.m6, fact.oaf.m7)}`
      : t.quakeMag(fact.mag)
  }
  return t.triggerLabel(fact.key)
}

function factForKey(facts: TriggerFact[] | undefined, key: string): TriggerFact | undefined {
  return facts?.find((row) => row.key === key)
}

function isProbability(fact: TriggerFact | undefined): boolean {
  if (!fact) return false
  return fact.rateMultiplier != null || Boolean(fact.precursors?.length) || fact.oaf != null
}

export default function CrisisMapPage() {
  const { locale, t, dir, setLocale } = useCrisisLocale()
  const [ready, setReady] = useState(false)
  const [day, setDay] = useState<string | null>(null)
  const [regions, setRegions] = useState<MapRegion[]>([])
  const [error, setError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [deepStatus, setDeepStatus] = useState<DeepStatus>('idle')
  const [deepMsg, setDeepMsg] = useState<string | null>(null)
  const [deepCard, setDeepCard] = useState<UnlockedCard | null>(null)
  const [deepProgress, setDeepProgress] = useState<DeepProgressState | null>(null)
  const [busy, setBusy] = useState(false)
  const [showStage1, setShowStage1] = useState(false)
  const [showPlates, setShowPlates] = useState(false)
  const [showVolcanoes, setShowVolcanoes] = useState(false)
  const [showRateCells, setShowRateCells] = useState(false)
  const precursorGeo = usePrecursorGeo(showPlates || showVolcanoes || showRateCells)
  const [showAllRows, setShowAllRows] = useState(false)
  const [zoneKey, setZoneKey] = useState<ZoneKey>('south_asia')
  const [zoneStatus, setZoneStatus] = useState<DeepStatus>('idle')
  const [zoneMsg, setZoneMsg] = useState<string | null>(null)
  const [zoneCard, setZoneCard] = useState<UnlockedCard | null>(null)
  const [zoneCards, setZoneCards] = useState<UnlockedCard[]>([])
  const [zoneProgress, setZoneProgress] = useState<DeepProgressState | null>(null)
  const [zoneBusy, setZoneBusy] = useState(false)
  const [zoneScope, setZoneScope] = useState<'zone' | 'global'>('zone')

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
      setDeepCard(null)
      setDeepProgress(null)
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const res = await authenticatedFetch(`/api/crisis/deep?regionId=${selectedId}&lang=${encodeURIComponent(locale)}`)
        const body = (await res.json().catch(() => null)) as DeepBody
        if (cancelled) return
        applyDeepBody(body, t, setDeepStatus, setDeepMsg, setDeepCard, setDeepProgress)
      } catch {
        if (!cancelled) {
          setDeepStatus('idle')
          setDeepMsg(null)
          setDeepCard(null)
          setDeepProgress(null)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [selectedId, locale, t])

  useEffect(() => {
    if (deepStatus !== 'pending' || !selectedId) return
    const timer = setInterval(() => {
      void (async () => {
        try {
          const res = await authenticatedFetch(`/api/crisis/deep?regionId=${selectedId}&lang=${encodeURIComponent(locale)}`)
          const body = (await res.json().catch(() => null)) as DeepBody
          applyDeepBody(body, t, setDeepStatus, setDeepMsg, setDeepCard, setDeepProgress)
        } catch {
          // ignore polling error
        }
      })()
    }, 5_000)
    return () => clearInterval(timer)
  }, [deepStatus, selectedId, locale, t])

  useEffect(() => {
    if (zoneStatus !== 'pending') return
    const timer = window.setInterval(() => {
      void (async () => {
        const path = zoneScope === 'global'
          ? `/api/crisis/zone?scope=global&lang=${encodeURIComponent(locale)}`
          : `/api/crisis/zone?zoneKey=${zoneKey}&lang=${encodeURIComponent(locale)}`
        const res = await authenticatedFetch(path)
        const body = (await res.json().catch(() => null)) as DeepBody & { cards?: UnlockedCard[] }
        if (!body) return
        if (body.cards) setZoneCards(body.cards)
        applyDeepBody(body, t, setZoneStatus, setZoneMsg, setZoneCard, setZoneProgress)
      })()
    }, 5000)
    return () => window.clearInterval(timer)
  }, [zoneStatus, zoneScope, zoneKey, locale, t])

  async function requestZone(scope: 'zone' | 'global') {
    setZoneBusy(true)
    setZoneScope(scope)
    setZoneMsg(null)
    setZoneCards([])
    try {
      const res = await authenticatedFetch('/api/crisis/zone', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(scope === 'global' ? { scope: 'global' } : { scope: 'zone', zoneKey }),
      })
      const body = (await res.json().catch(() => null)) as DeepBody & { cards?: UnlockedCard[] }
      if (!res.ok) throw new Error(body?.error ?? t.requestFailed)
      if (body?.cards) setZoneCards(body.cards)
      applyDeepBody(body ?? {}, t, setZoneStatus, setZoneMsg, setZoneCard, setZoneProgress)
    } catch (e: unknown) {
      setZoneMsg(e instanceof Error ? e.message : t.requestFailed)
    } finally {
      setZoneBusy(false)
    }
  }

  const selected = useMemo(() => regions.find((row) => row.regionId === selectedId) ?? null, [regions, selectedId])
  const mapDots = useMemo(
    () => regions.filter((row) => showStage1 || row.stage >= 2),
    [regions, showStage1],
  )
  const tableRows = useMemo(() => {
    const scored = regions.filter((row) => row.score > 0).sort((a, b) => b.score - a.score)
    return showAllRows ? scored : scored.slice(0, TABLE_TOP)
  }, [regions, showAllRows])
  const scoredCount = useMemo(() => regions.filter((row) => row.score > 0).length, [regions])

  async function requestDeep(regionId: number) {
    if (busy) return
    setSelectedId(regionId)
    setBusy(true)
    setDeepMsg(null)
    try {
      const res = await authenticatedFetch('/api/crisis/deep', {
        method: 'POST',
        json: { regionId, lang: locale },
      })
      const body = (await res.json().catch(() => null)) as DeepBody
      if (res.status === 402) throw new Error(t.notEnoughCredits)
      if (res.status === 429) {
        if (body?.code === 'active_request_exists') throw new Error(t.limitActive)
        if (body?.code === 'daily_limit_exceeded') throw new Error(t.limitDaily)
        throw new Error(body?.error ?? t.requestFailed)
      }
      if (!res.ok) throw new Error(body?.error ?? t.requestFailed)
      applyDeepBody(body, t, setDeepStatus, setDeepMsg, setDeepCard, setDeepProgress)
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

        <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-4">
          <h2 className="text-sm font-black text-slate-200">{t.zonePicker}</h2>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <select
              value={zoneKey}
              onChange={(event) => setZoneKey(event.target.value as ZoneKey)}
              className="rounded-xl border border-white/15 bg-black/40 px-3 py-2 text-sm"
            >
              {CRISIS_ZONES.map((zone) => (
                <option key={zone.key} value={zone.key}>
                  {zoneDisplayName(zone, locale)}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={zoneBusy || zoneStatus === 'pending'}
              onClick={() => void requestZone('zone')}
              className="rounded-xl bg-cyan-600 px-4 py-2 text-sm font-semibold text-white hover:bg-cyan-500 disabled:opacity-50"
            >
              {zoneBusy && zoneScope === 'zone' ? t.requesting : t.zoneAnalyze(CRISIS_ZONE_CREDITS)}
            </button>
            <button
              type="button"
              disabled={zoneBusy || zoneStatus === 'pending'}
              onClick={() => void requestZone('global')}
              className="rounded-xl border border-cyan-400/40 px-4 py-2 text-sm font-semibold text-cyan-100 hover:bg-cyan-500/10 disabled:opacity-50"
            >
              {zoneBusy && zoneScope === 'global' ? t.requesting : t.globalAnalyze(CRISIS_GLOBAL_CREDITS)}
            </button>
          </div>
          {zoneMsg ? <p className="mt-3 text-xs text-cyan-200">{zoneMsg}</p> : null}
          {zoneProgress && zoneStatus === 'pending' ? (
            <div className="mt-4">
              <DeepProgress
                t={t}
                requestStatus={zoneProgress.requestStatus}
                elapsedSec={zoneProgress.elapsedSec}
                waitingForWorker={zoneProgress.waitingForWorker}
                groups={zoneProgress.groups}
              />
            </div>
          ) : null}
          {zoneCard && (zoneStatus === 'ready' || zoneStatus === 'cached') ? (
            <div className="mt-4">
              <UnlockedCardView card={zoneCard} t={t} locale={locale} />
            </div>
          ) : null}
          {zoneCards.length > 0 ? (
            <div className="mt-4 space-y-6">
              {zoneCards.map((card) => (
                <UnlockedCardView key={card.runId} card={card} t={t} locale={locale} />
              ))}
            </div>
          ) : null}
        </section>

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
            <WorldBasemap width={MAP_W} height={MAP_H} />
            <PrecursorLayerShapes
              data={precursorGeo}
              showPlates={showPlates}
              showVolcanoes={showVolcanoes}
              showCells={showRateCells}
              width={MAP_W}
              height={MAP_H}
            />
            {mapDots.map((row) => {
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
                    <title>{`${regionDisplayName(row.name, row.iso3, locale, row.country)} · ${t.stageWord} ${row.stage}`}</title>
                  </circle>
                </g>
              )
            })}
          </svg>
        </section>

        <div className="flex flex-wrap items-center gap-3 text-xs text-slate-400">
          {[1, 2, 3, 4, 5].map((stage) => (
            <span key={stage} className="inline-flex items-center gap-1.5">
              <span
                className={`inline-block h-2.5 w-2.5 rounded-full ${shouldPulse(stage) ? 'crisis-flare-dot' : ''}`}
                style={{ background: stageColor(stage), boxShadow: `0 0 10px ${stageColor(stage)}` }}
              />
              {t.stageWord} {stage} · {stageBannerText(stage, t)}
              {shouldPulse(stage) ? ` · ${t.pulse}` : ''}
            </span>
          ))}
          <button
            type="button"
            onClick={() => setShowStage1((prev) => !prev)}
            className="rounded-lg border border-white/15 bg-white/5 px-2.5 py-1 text-[11px] font-semibold text-slate-200 hover:bg-white/10"
          >
            {showStage1 ? t.hideStage1 : t.showStage1}
          </button>
          <PrecursorLayerToggles
            t={t}
            plates={showPlates}
            volcanoes={showVolcanoes}
            cells={showRateCells}
            onPlates={setShowPlates}
            onVolcanoes={setShowVolcanoes}
            onCells={setShowRateCells}
          />
        </div>

        <HazardMapLegend t={t} />

        <section className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03]">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 px-4 py-3">
            <div className="grid w-full grid-cols-12 gap-2 text-xs font-semibold text-slate-400">
              <div className="col-span-3">{t.colRegion}</div>
              <div className="col-span-2">{t.colCountry}</div>
              <div className="col-span-1">{t.colStage}</div>
              <div className="col-span-1 text-right">{t.colScore}</div>
              <div className="col-span-3">{t.colTriggers}</div>
              <div className="col-span-2 text-right">{t.rowAnalyze}</div>
            </div>
          </div>
          {tableRows.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-slate-500">{t.noScores}</p>
          ) : (
            <div className="divide-y divide-white/8">
              {tableRows.map((row) => (
                <div
                  key={row.regionId}
                  role="button"
                  tabIndex={0}
                  onClick={() => setSelectedId(row.regionId)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      setSelectedId(row.regionId)
                    }
                  }}
                  className={`grid w-full cursor-pointer grid-cols-12 items-center gap-2 px-4 py-3 text-left text-sm hover:bg-white/[0.04] ${
                    selectedId === row.regionId ? 'bg-cyan-500/10' : ''
                  }`}
                >
                  <div className="col-span-3 truncate font-semibold">{row.name}</div>
                  <div className="col-span-2 truncate text-slate-300">
                    {countryDisplayName(row.iso3, locale, row.country)}
                  </div>
                  <div className="col-span-1 text-cyan-100">{row.stage}</div>
                  <div className="col-span-1 text-right tabular-nums">{row.score}</div>
                  <div className="col-span-3 flex flex-wrap gap-1">
                    {row.triggers.map((key) => (
                      <TriggerChip
                        key={key}
                        t={t}
                        triggerKey={key}
                        expectedWindow={factForKey(row.triggerFacts, key)?.expectedWindow}
                        probability={isProbability(factForKey(row.triggerFacts, key))}
                        className="rounded-full border border-cyan-400/20 bg-cyan-500/10 px-2 py-0.5 text-[10px] text-cyan-100"
                      />
                    ))}
                  </div>
                  <div className="col-span-2 text-right">
                    <button
                      type="button"
                      title={t.rowAnalyzeHint(CRISIS_DEEP_CREDITS)}
                      aria-label={t.rowAnalyzeHint(CRISIS_DEEP_CREDITS)}
                      disabled={busy || deepStatus === 'pending'}
                      onClick={(event) => {
                        event.stopPropagation()
                        void requestDeep(row.regionId)
                      }}
                      className="rounded-xl bg-cyan-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-cyan-500 disabled:opacity-50"
                    >
                      {t.rowAnalyze} · {CRISIS_DEEP_CREDITS}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
          {scoredCount > TABLE_TOP ? (
            <div className="border-t border-white/10 px-4 py-3">
              <button
                type="button"
                onClick={() => setShowAllRows((prev) => !prev)}
                className="text-xs font-semibold text-cyan-200 hover:text-cyan-100"
              >
                {showAllRows ? t.showTop200 : t.showAll(scoredCount)}
              </button>
            </div>
          ) : null}
        </section>
      </div>

      {selected ? (
        <aside
          className={`fixed inset-y-0 right-0 z-20 flex w-full max-w-md flex-col overflow-y-auto border-l bg-[#070b16]/95 p-5 shadow-[-20px_0_80px_rgba(0,0,0,0.55)] backdrop-blur ${
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
              <p className="text-sm text-slate-400">{countryDisplayName(selected.iso3, locale, selected.country)}</p>
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
              <dd className="mt-1 space-y-1">
                {(selected.triggerFacts ?? []).length === 0 && selected.triggers.length === 0 ? (
                  '—'
                ) : (selected.triggerFacts ?? []).length > 0 ? (
                  (selected.triggerFacts ?? []).map((fact) => (
                    <p key={fact.key} className="text-slate-200">
                      {triggerFactLine(fact, t)}
                    </p>
                  ))
                ) : (
                  <div className="flex flex-wrap gap-1">
                    {selected.triggers.map((key) => (
                      <TriggerChip
                        key={key}
                        t={t}
                        triggerKey={key}
                        expectedWindow={factForKey(selected.triggerFacts, key)?.expectedWindow}
                        probability={isProbability(factForKey(selected.triggerFacts, key))}
                        className="rounded-full border border-white/12 px-2 py-0.5 text-xs"
                      />
                    ))}
                  </div>
                )}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-slate-500">{t.fragility}</dt>
              <dd className="mt-1 space-y-1 text-slate-200">
                {(selected.fragilityGroups ?? []).length > 0
                  ? selected.fragilityGroups!.map((group) => (
                      <p key={group.kind}>
                        {t.fragilityKind(group.kind)}: {group.names.join(', ')}
                      </p>
                    ))
                  : selected.fragility.length
                    ? selected.fragility.join(', ')
                    : '—'}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-slate-500">{t.population}</dt>
              <dd className="mt-1 text-slate-200">
                {selected.peopleCount && selected.peopleCount > 0
                  ? t.peopleAbout(formatPeopleShort(selected.peopleCount, locale))
                  : '—'}
              </dd>
            </div>
          </dl>

          {deepProgress && deepStatus === 'pending' ? (
            <div className="mt-5">
              <DeepProgress
                t={t}
                requestStatus={deepProgress.requestStatus}
                elapsedSec={deepProgress.elapsedSec}
                waitingForWorker={deepProgress.waitingForWorker}
                groups={deepProgress.groups}
              />
            </div>
          ) : null}

          {deepCard && (deepStatus === 'ready' || deepStatus === 'cached') ? (
            <div className="mt-5 space-y-3">
              {deepMsg ? <p className="text-xs text-cyan-200">{deepMsg}</p> : null}
              <UnlockedCardView card={deepCard} t={t} locale={locale} />
            </div>
          ) : (
            <div className="mt-auto space-y-2 pt-6">
              <Link
                href="/crisis/briefing"
                className="block rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-center text-sm font-semibold text-slate-300"
              >
                {t.briefingLocked(CRISIS_BRIEF_CREDITS)}
              </Link>
              <button
                type="button"
                onClick={() => void requestDeep(selected.regionId)}
                disabled={busy || deepStatus === 'pending'}
                className="w-full rounded-xl bg-cyan-600 px-4 py-3 text-sm font-semibold text-white hover:bg-cyan-500 disabled:opacity-50"
              >
                {busy ? t.requesting : t.deepAnalyze(CRISIS_DEEP_CREDITS)}
              </button>
              {deepMsg && deepStatus !== 'pending' ? <p className="text-xs text-cyan-200">{deepMsg}</p> : null}
            </div>
          )}
        </aside>
      ) : null}
    </main>
  )
}
