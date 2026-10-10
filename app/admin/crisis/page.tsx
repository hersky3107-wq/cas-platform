'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CrisisLanguageToggle } from '@/components/crisis/LanguageToggle'
import { CrisisPulseStyles } from '@/components/crisis/CrisisPulseStyles'
import { HazardIconRow } from '@/components/crisis/HazardIcon'
import { SeverityCard } from '@/components/crisis/SeverityCard'
import { WorldBasemap } from '@/components/crisis/WorldBasemap'
import { projectLonLat, stageColor } from '@/lib/crisis/admin/geo'
import { countryDisplayName, regionDisplayName } from '@/lib/crisis/i18n/place-names'
import { ESTIMATE_USD_PER_REGION } from '@/lib/crisis/admin/types'
import type { AdminRegion, QueueRow, QueueStatus } from '@/lib/crisis/admin/types'
import { stageBannerText, type CrisisUiPack } from '@/lib/crisis/i18n/dictionary'
import type { CrisisLocale } from '@/lib/crisis/i18n/locales'
import { useCrisisLocale } from '@/lib/crisis/i18n/use-crisis-locale'
import { hazardIconsFor } from '@/lib/crisis/ui/hazards'
import { maxStage, severityTheme } from '@/lib/crisis/ui/severity'
import { supabase } from '@/lib/db/supabase'

const OWNER_EMAIL = 'hersky3107@gmail.com'
const MAP_W = 800
const MAP_H = 400

type AuthState = 'checking' | 'denied' | 'allowed'

type HypothesisView = {
  title: string
  novelty?: string
  stage?: number
  possibility?: string
  why_humans_miss?: string
  what_to_do?: string[]
  hazards?: string[]
  official_links?: Array<{ label: string; url: string }>
  evidence?: Array<{ type: string; ref: string; url?: string }>
}

type BaselineView = {
  title: string
  stage: number
  possibility: string
  what_to_do: string[]
  reason?: string
}

type RunView = {
  id: string
  regionId: number
  status: string
  costUsd: number
  result: {
    headlines: HypothesisView[]
    missed_by_others: HypothesisView[]
    baseline_risks: BaselineView[]
    novelty_counts?: { only_us: number; also_seen_elsewhere: number }
    headline_en?: string
    headline_ko?: string
    summary_en?: string
    summary_ko?: string
    headline_fallback?: boolean
  } | null
  searchUrls: string[]
  public: boolean
}

type Overview = {
  day: string
  regions: AdminRegion[]
  queue: QueueRow[]
  runAllCount: number
  estimateUsdPerRegion: number
  runAllEstimateUsd: number
}

function formatTime(iso: string | null): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return iso
  }
}

function statusClass(status: QueueStatus): string {
  if (status === 'running') return 'bg-cyan-500/15 text-cyan-200'
  if (status === 'done') return 'bg-emerald-500/15 text-emerald-200'
  if (status === 'failed') return 'bg-rose-500/15 text-rose-200'
  return 'bg-white/10 text-slate-300'
}

export default function CrisisAdminPage() {
  const { locale, t, dir, setLocale } = useCrisisLocale()
  const [authState, setAuthState] = useState<AuthState>('checking')
  const [overview, setOverview] = useState<Overview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [run, setRun] = useState<RunView | null>(null)
  const [runError, setRunError] = useState<string | null>(null)
  const [publishMsg, setPublishMsg] = useState<string | null>(null)
  const [showAll, setShowAll] = useState(false)
  const [showStage1, setShowStage1] = useState(false)

  const loadOverview = useCallback(async () => {
    const res = await fetch('/api/admin/crisis', { credentials: 'include' })
    const body = (await res.json().catch(() => null)) as Overview & { error?: string }
    if (!res.ok) throw new Error(body?.error ?? t.loadFailed)
    setOverview(body)
    return body
  }, [t.loadFailed])

  const loadRun = useCallback(
    async (runId: string) => {
      setRunError(null)
      const res = await fetch(`/api/admin/crisis/runs/${runId}?lang=${encodeURIComponent(locale)}`, {
        credentials: 'include',
      })
      const body = (await res.json().catch(() => null)) as RunView & { error?: string }
      if (!res.ok) throw new Error(body?.error ?? t.loadRunFailed)
      setRun(body)
      setSelectedId(body.regionId)
    },
    [locale, t.loadRunFailed],
  )

  useEffect(() => {
    void (async () => {
      const { data, error: authError } = await supabase.auth.getUser()
      const email = data.user?.email ?? ''
      if (authError || !email || email.toLowerCase() !== OWNER_EMAIL.toLowerCase()) {
        setAuthState('denied')
        return
      }
      setAuthState('allowed')
    })()
  }, [])

  useEffect(() => {
    if (authState !== 'allowed') return
    void (async () => {
      try {
        await loadOverview()
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : t.loadFailed)
      }
    })()
    const timer = window.setInterval(() => {
      void loadOverview().catch(() => {})
    }, 10_000)
    return () => window.clearInterval(timer)
  }, [authState, loadOverview, t.loadFailed])

  const runIdRef = useRef<string | null>(null)
  runIdRef.current = run?.id ?? null
  useEffect(() => {
    if (!runIdRef.current) return
    void loadRun(runIdRef.current).catch(() => {})
  }, [locale, loadRun])

  const scoredRegions = useMemo(
    () => (overview?.regions ?? []).filter((row) => row.score > 0),
    [overview],
  )

  const displayedRegions = useMemo(
    () => (showAll ? scoredRegions : scoredRegions.slice(0, 200)),
    [scoredRegions, showAll],
  )
  const mapDots = useMemo(
    () => scoredRegions.filter((row) => showStage1 || row.stage >= 2),
    [scoredRegions, showStage1],
  )

  const selected = useMemo(
    () => overview?.regions.find((row) => row.regionId === selectedId) ?? null,
    [overview, selectedId],
  )

  async function enqueueRegion(regionId: number) {
    if (busy) return
    setBusy(`region-${regionId}`)
    setError(null)
    try {
      const res = await fetch('/api/admin/crisis/queue', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope: 'region', regionId }),
      })
      const body = (await res.json().catch(() => null)) as { error?: string }
      if (!res.ok) throw new Error(body?.error ?? t.couldNotQueue)
      await loadOverview()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : t.couldNotQueue)
    } finally {
      setBusy(null)
    }
  }

  async function enqueueAll() {
    if (busy || !overview) return
    const count = overview.runAllCount
    const usd = overview.runAllEstimateUsd
    const ok = window.confirm(t.runAllConfirm(count, usd.toFixed(2)))
    if (!ok) return
    setBusy('all')
    setError(null)
    try {
      const res = await fetch('/api/admin/crisis/queue', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope: 'all' }),
      })
      const body = (await res.json().catch(() => null)) as { error?: string }
      if (!res.ok) throw new Error(body?.error ?? t.couldNotQueue)
      await loadOverview()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : t.couldNotQueue)
    } finally {
      setBusy(null)
    }
  }

  async function publishRun() {
    if (!run?.id || busy) return
    setBusy('publish')
    setPublishMsg(null)
    try {
      const res = await fetch('/api/admin/crisis/publish', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId: run.id }),
      })
      const body = (await res.json().catch(() => null)) as { error?: string; public?: boolean }
      if (!res.ok) throw new Error(body?.error ?? t.publishFailed)
      setPublishMsg(t.publishOk)
      setRun({ ...run, public: true })
    } catch (e: unknown) {
      setPublishMsg(e instanceof Error ? e.message : t.publishFailed)
    } finally {
      setBusy(null)
    }
  }

  if (authState === 'checking') {
    return (
      <main className="min-h-screen bg-[#0a0f1e] px-4 py-10 text-white" dir={dir}>
        <div className="mx-auto max-w-6xl">
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-6 text-center text-sm text-slate-300">
            {t.loading}
          </div>
        </div>
      </main>
    )
  }

  if (authState === 'denied') {
    return (
      <div style={{ background: '#0a0f1e', color: 'white', padding: '20px', minHeight: '100vh' }} dir={dir}>
        {t.accessDenied}
      </div>
    )
  }

  const queue = overview?.queue ?? []
  const byStatus = {
    queued: queue.filter((row) => row.status === 'queued'),
    running: queue.filter((row) => row.status === 'running'),
    done: queue.filter((row) => row.status === 'done'),
    failed: queue.filter((row) => row.status === 'failed'),
  }
  const nameOf = (id: number | null) =>
    id == null ? t.allRegions : overview?.regions.find((row) => row.regionId === id)?.name ?? `#${id}`

  return (
    <main className="min-h-screen bg-[#0a0f1e] px-4 py-10 text-white" dir={dir}>
      <CrisisPulseStyles />
      <div className="mx-auto max-w-6xl space-y-8">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-black tracking-tight">{t.adminTitle}</h1>
            <p className="mt-1 text-sm text-slate-400">{t.adminSubtitle(overview?.day ?? '—')}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <CrisisLanguageToggle locale={locale} onChange={setLocale} label={t.languageToggle} />
            <a
              href="/admin"
              className="rounded-xl border border-white/12 bg-white/5 px-4 py-2 text-sm font-semibold text-slate-200 hover:bg-white/8"
            >
              {t.dashboard}
            </a>
            <button
              type="button"
              onClick={() => void enqueueAll()}
              disabled={busy !== null || !overview || overview.runAllCount === 0}
              className="rounded-xl bg-cyan-600 px-4 py-2 text-sm font-semibold text-white hover:bg-cyan-500 disabled:opacity-50"
            >
              {busy === 'all' ? t.queueing : t.runAll}
            </button>
          </div>
        </div>

        {error ? (
          <div className="rounded-2xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">{error}</div>
        ) : null}

        <section className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-400">{t.worldMap}</h2>
          <svg viewBox={`0 0 ${MAP_W} ${MAP_H}`} className="h-auto w-full rounded-xl bg-[#071018]" role="img" aria-label={t.worldMap}>
            <WorldBasemap width={MAP_W} height={MAP_H} />
            {mapDots.map((row) => {
              const pt = projectLonLat(row.lon, row.lat, MAP_W, MAP_H)
              const selectedDot = row.regionId === selectedId
              return (
                <circle
                  key={row.regionId}
                  cx={pt.x}
                  cy={pt.y}
                  r={selectedDot ? 6 : 3.5}
                  fill={stageColor(row.stage)}
                  stroke={selectedDot ? '#fff' : 'transparent'}
                  strokeWidth={1.5}
                  className="cursor-pointer"
                  onClick={() => setSelectedId(row.regionId)}
                >
                  <title>{`${regionDisplayName(row.name, row.iso3, locale, row.country)} · ${t.stageWord} ${row.stage}`}</title>
                </circle>
              )
            })}
          </svg>
          <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-slate-400">
            {[1, 2, 3, 4, 5].map((stage) => (
              <span key={stage} className="inline-flex items-center gap-1.5">
                <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: stageColor(stage) }} />
                {t.stageWord} {stage} · {stageBannerText(stage, t)}
              </span>
            ))}
            <button
              type="button"
              onClick={() => setShowStage1((prev) => !prev)}
              className="rounded-lg border border-white/15 bg-white/5 px-2.5 py-1 text-[11px] font-semibold text-slate-200 hover:bg-white/10"
            >
              {showStage1 ? t.hideStage1 : t.showStage1}
            </button>
          </div>
        </section>

        <section className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04]">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 px-4 py-3">
            <div className="flex items-center gap-3">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">{t.regions}</h2>
              <span className="text-xs text-slate-500">{t.scoredCount(scoredRegions.length)}</span>
            </div>
            <div className="flex items-center gap-3">
              {scoredRegions.length > 200 ? (
                <button
                  type="button"
                  onClick={() => setShowAll((prev) => !prev)}
                  className="rounded-xl border border-white/12 bg-white/5 px-2.5 py-1 text-xs font-semibold text-slate-300 hover:bg-white/10"
                >
                  {showAll ? t.showTop200 : t.showAll(scoredRegions.length)}
                </button>
              ) : null}
              <p className="text-xs text-slate-500">
                {t.runAllEstimate(
                  overview?.runAllEstimateUsd.toFixed(2) ?? '0.00',
                  overview?.runAllCount ?? 0,
                  ESTIMATE_USD_PER_REGION.toFixed(2),
                )}
              </p>
            </div>
          </div>
          <div className="grid grid-cols-12 gap-2 border-b border-white/10 px-4 py-3 text-xs font-semibold text-slate-300">
            <div className="col-span-3">{t.colName}</div>
            <div className="col-span-2">{t.colCountry}</div>
            <div className="col-span-1">{t.colStage}</div>
            <div className="col-span-1 text-right">{t.colScore}</div>
            <div className="col-span-2">{t.colTriggers}</div>
            <div className="col-span-2">{t.colLastRun}</div>
            <div className="col-span-1 text-right">{t.colRun}</div>
          </div>
          {!overview ? (
            <div className="px-4 py-10 text-center text-sm text-slate-300">{t.loading}</div>
          ) : scoredRegions.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-slate-300">{t.noScoredRegions}</div>
          ) : (
            <div className="divide-y divide-white/8">
              {displayedRegions.map((row) => (
                <div
                  key={row.regionId}
                  className={`grid grid-cols-12 items-center gap-2 px-4 py-3 text-sm ${
                    selectedId === row.regionId ? 'bg-white/[0.04]' : ''
                  }`}
                >
                  <button type="button" className="col-span-3 truncate text-left font-semibold text-white" onClick={() => setSelectedId(row.regionId)}>
                    {regionDisplayName(row.name, row.iso3, locale, row.country)}
                  </button>
                  <div className="col-span-2 truncate text-slate-300">{countryDisplayName(row.iso3, locale, row.country)}</div>
                  <div className="col-span-1">
                    <span
                      className="inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold"
                      style={{ background: `${stageColor(row.stage)}22`, color: stageColor(row.stage) }}
                    >
                      {row.stage}
                    </span>
                  </div>
                  <div className="col-span-1 text-right tabular-nums text-slate-200">{row.score}</div>
                  <div className="col-span-2 flex flex-wrap items-center gap-1">
                    <HazardIconRow kinds={hazardIconsFor(row.triggers)} color={stageColor(row.stage)} />
                    {row.triggers.length === 0 ? (
                      <span className="text-xs text-slate-500">—</span>
                    ) : (
                      row.triggers.map((key) => (
                        <span key={key} className="rounded-full border border-white/12 bg-white/5 px-2 py-0.5 text-[10px] text-slate-200">
                          {t.triggerLabel(key)}
                        </span>
                      ))
                    )}
                  </div>
                  <div className="col-span-2 text-xs text-slate-400">{formatTime(row.lastRunAt)}</div>
                  <div className="col-span-1 text-right">
                    <button
                      type="button"
                      onClick={() => void enqueueRegion(row.regionId)}
                      disabled={busy !== null}
                      className="rounded-xl border border-cyan-400/30 bg-cyan-500/10 px-2 py-1 text-[11px] font-semibold text-cyan-100 hover:bg-cyan-500/15 disabled:opacity-50"
                    >
                      {busy === `region-${row.regionId}` ? '…' : t.runEngine}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-4">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-400">{t.queue}</h2>
          <div className="grid gap-3 md:grid-cols-4">
            {(['queued', 'running', 'done', 'failed'] as QueueStatus[]).map((status) => (
              <div key={status} className="rounded-xl border border-white/10 bg-[#0b1020] px-3 py-3">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {t.queueStatus[status]} · {byStatus[status].length}
                </p>
                <ul className="space-y-2">
                  {byStatus[status].length === 0 ? (
                    <li className="text-xs text-slate-500">{t.none}</li>
                  ) : (
                    byStatus[status].slice(0, 12).map((row) => (
                      <li key={row.id}>
                        <button
                          type="button"
                          className="w-full text-left"
                          onClick={() => {
                            if (row.run_id) void loadRun(row.run_id).catch((e: unknown) => setRunError(e instanceof Error ? e.message : t.loadRunFailed))
                            if (row.region_id) setSelectedId(row.region_id)
                          }}
                        >
                          <span className={`mr-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${statusClass(status)}`}>
                            {row.scope}
                          </span>
                          <span className="text-xs text-slate-200">{nameOf(row.region_id)}</span>
                          {row.error ? <p className="mt-1 text-[11px] text-rose-200">{row.error}</p> : null}
                        </button>
                      </li>
                    ))
                  )}
                </ul>
              </div>
            ))}
          </div>
        </section>

        <AdminResult
          t={t}
          locale={locale}
          selected={selected}
          run={run}
          runError={runError}
          publishMsg={publishMsg}
          busy={busy}
          onPublish={() => void publishRun()}
        />
      </div>
    </main>
  )
}

function AdminResult({
  t,
  locale,
  selected,
  run,
  runError,
  publishMsg,
  busy,
  onPublish,
}: {
  t: CrisisUiPack
  locale: CrisisLocale
  selected: AdminRegion | null
  run: RunView | null
  runError: string | null
  publishMsg: string | null
  busy: string | null
  onPublish: () => void
}) {
  const result = run?.result ?? null
  const stage = selected?.stage ?? maxStage([
    ...(result?.headlines ?? []).map((row) => row.stage),
    ...(result?.missed_by_others ?? []).map((row) => row.stage),
    ...(result?.baseline_risks ?? []).map((row) => row.stage),
  ])
  const theme = severityTheme(stage)
  const summary = result?.summary_ko || result?.summary_en || result?.headline_ko || result?.headline_en || ''

  return (
    <section
      className={`rounded-2xl px-4 py-4 ${theme.pulseBorder && result ? 'crisis-pulse-border' : ''}`}
      style={result ? { background: theme.bg, border: `2px solid ${theme.border}` } : { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)' }}
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">{t.runResult}</h2>
        {run ? (
          <button
            type="button"
            onClick={onPublish}
            disabled={busy !== null || run.public || !run.result}
            className="rounded-xl bg-cyan-600 px-4 py-2 text-sm font-semibold text-white hover:bg-cyan-500 disabled:opacity-50"
          >
            {run.public ? t.published : busy === 'publish' ? t.publishing : t.publish}
          </button>
        ) : null}
      </div>
      {selected ? (
        <p className="mb-3 text-sm text-slate-400">
          {regionDisplayName(selected.name, selected.iso3, locale, selected.country)} · {t.stageWord} {selected.stage} · {t.colScore} {selected.score}
        </p>
      ) : null}
      {runError ? <p className="mb-3 text-sm text-rose-200">{runError}</p> : null}
      {publishMsg ? <p className="mb-3 text-sm text-slate-300">{publishMsg}</p> : null}
      {!result ? (
        <p className="text-sm text-slate-500">{t.pickRun}</p>
      ) : (
        <div className="space-y-4">
          <div className="rounded-xl px-3 py-2 text-sm font-black" style={{ background: theme.bannerBg, color: theme.color }}>
            {stageBannerText(stage, t)}
          </div>
          <p className="text-xl font-black leading-snug text-white">{summary}</p>
          <p className="text-xs text-slate-400">
            {t.noveltyAdmin(
              result.novelty_counts?.only_us ?? 0,
              result.novelty_counts?.also_seen_elsewhere ?? 0,
              run?.costUsd.toFixed(4) ?? '0',
            )}
          </p>
          <AdminTier title={t.headlines} rows={result.headlines} t={t} />
          <AdminTier title={t.missedByOthers} rows={result.missed_by_others} t={t} />
          <div>
            <h3 className="mb-2 text-sm font-black text-slate-300">{t.baselineRisks}</h3>
            <div className="space-y-3">
              {result.baseline_risks.map((row) => (
                <SeverityCard
                  key={row.title}
                  t={t}
                  card={{
                    stage: row.stage,
                    summary: row.title,
                    whatToDo: row.what_to_do,
                    whyMiss: row.reason,
                  }}
                />
              ))}
            </div>
          </div>
          {run && run.searchUrls.length > 0 ? (
            <details>
              <summary className="cursor-pointer text-xs font-semibold text-slate-400">{t.showEvidence}</summary>
              <ul className="mt-2 space-y-1 text-xs">
                {run.searchUrls.slice(0, 12).map((url) => (
                  <li key={url}>
                    <a href={url} target="_blank" rel="noopener noreferrer" className="text-cyan-300 hover:underline">
                      {url}
                    </a>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      )}
    </section>
  )
}

function AdminTier({ title, rows, t }: { title: string; rows: HypothesisView[]; t: CrisisUiPack }) {
  return (
    <div>
      <h3 className="mb-2 text-sm font-black text-slate-300">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-xs text-slate-500">{t.none}</p>
      ) : (
        <div className="space-y-3">
          {rows.map((row) => (
            <SeverityCard
              key={row.title}
              t={t}
              card={{
                stage: row.stage ?? 1,
                summary: row.title,
                whatToDo: row.what_to_do ?? [],
                whyMiss: row.why_humans_miss,
                novelty: row.novelty,
                hazards: row.hazards,
                possibility: row.possibility,
                evidence: [
                  ...(row.official_links ?? []).map((link) => ({ label: link.label, url: link.url })),
                  ...(row.evidence ?? [])
                    .filter((item) => item.url)
                    .map((item) => ({ label: item.ref, url: item.url })),
                ],
              }}
            />
          ))}
        </div>
      )}
    </div>
  )
}
