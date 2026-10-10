'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/db/supabase'
import { projectLonLat, stageColor } from '@/lib/crisis/admin/geo'
import { ESTIMATE_USD_PER_REGION } from '@/lib/crisis/admin/types'
import type { AdminRegion, QueueRow, QueueStatus } from '@/lib/crisis/admin/types'

const OWNER_EMAIL = 'hersky3107@gmail.com'
const MAP_W = 800
const MAP_H = 400

type AuthState = 'checking' | 'denied' | 'allowed'

type HypothesisView = {
  title: string
  novelty?: string
  stage?: number
  possibility?: string
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
    summary_en?: string
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
  const [authState, setAuthState] = useState<AuthState>('checking')
  const [overview, setOverview] = useState<Overview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [run, setRun] = useState<RunView | null>(null)
  const [runError, setRunError] = useState<string | null>(null)
  const [publishMsg, setPublishMsg] = useState<string | null>(null)
  const [showAll, setShowAll] = useState(false)

  const loadOverview = useCallback(async () => {
    const res = await fetch('/api/admin/crisis', { credentials: 'include' })
    const body = (await res.json().catch(() => null)) as Overview & { error?: string }
    if (!res.ok) throw new Error(body?.error ?? 'Failed to load CrisisWatch')
    setOverview(body)
    return body
  }, [])

  const loadRun = useCallback(async (runId: string) => {
    setRunError(null)
    const res = await fetch(`/api/admin/crisis/runs/${runId}`, { credentials: 'include' })
    const body = (await res.json().catch(() => null)) as RunView & { error?: string }
    if (!res.ok) throw new Error(body?.error ?? 'Failed to load run')
    setRun(body)
    setSelectedId(body.regionId)
  }, [])

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
        setError(e instanceof Error ? e.message : 'Failed to load')
      }
    })()
    const timer = window.setInterval(() => {
      void loadOverview().catch(() => {})
    }, 10_000)
    return () => window.clearInterval(timer)
  }, [authState, loadOverview])

  const scoredRegions = useMemo(
    () => (overview?.regions ?? []).filter((row) => row.score > 0),
    [overview],
  )

  const displayedRegions = useMemo(
    () => (showAll ? scoredRegions : scoredRegions.slice(0, 200)),
    [scoredRegions, showAll],
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
      if (!res.ok) throw new Error(body?.error ?? 'Could not queue')
      await loadOverview()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not queue')
    } finally {
      setBusy(null)
    }
  }

  async function enqueueAll() {
    if (busy || !overview) return
    const count = overview.runAllCount
    const usd = overview.runAllEstimateUsd
    const ok = window.confirm(
      `Run the engine for ${count} region${count === 1 ? '' : 's'} at stage ≥ 3?\nEstimated cost: $${usd.toFixed(2)} (${count} × $${ESTIMATE_USD_PER_REGION.toFixed(2)}).`,
    )
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
      if (!res.ok) throw new Error(body?.error ?? 'Could not queue')
      await loadOverview()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not queue')
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
      if (!res.ok) throw new Error(body?.error ?? 'Publish failed')
      setPublishMsg('Card is public.')
      setRun({ ...run, public: true })
    } catch (e: unknown) {
      setPublishMsg(e instanceof Error ? e.message : 'Publish failed')
    } finally {
      setBusy(null)
    }
  }

  if (authState === 'checking') {
    return (
      <main className="min-h-screen bg-[#0a0f1e] px-4 py-10 text-white">
        <div className="mx-auto max-w-6xl">
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-6 text-center text-sm text-slate-300">
            Loading…
          </div>
        </div>
      </main>
    )
  }

  if (authState === 'denied') {
    return (
      <div style={{ background: '#0a0f1e', color: 'white', padding: '20px', minHeight: '100vh' }}>
        Access Denied
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
    id == null ? 'All regions' : overview?.regions.find((row) => row.regionId === id)?.name ?? `#${id}`

  return (
    <main className="min-h-screen bg-[#0a0f1e] px-4 py-10 text-white">
      <div className="mx-auto max-w-6xl space-y-8">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">CRISISWATCH</h1>
            <p className="mt-1 text-sm text-slate-400">
              Today {overview?.day ?? '—'} · score-sorted regions · engine queue
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <a
              href="/admin"
              className="rounded-xl border border-white/12 bg-white/5 px-4 py-2 text-sm font-semibold text-slate-200 hover:bg-white/8"
            >
              Dashboard
            </a>
            <button
              type="button"
              onClick={() => void enqueueAll()}
              disabled={busy !== null || !overview || overview.runAllCount === 0}
              className="rounded-xl bg-cyan-600 px-4 py-2 text-sm font-semibold text-white hover:bg-cyan-500 disabled:opacity-50"
            >
              {busy === 'all' ? 'Queueing…' : `Run all (stage ≥ 3)`}
            </button>
          </div>
        </div>

        {error ? (
          <div className="rounded-2xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">{error}</div>
        ) : null}

        <section className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-400">World map</h2>
          <svg viewBox={`0 0 ${MAP_W} ${MAP_H}`} className="h-auto w-full rounded-xl bg-[#07101f]" role="img" aria-label="Today regions">
            {[...Array(7)].map((_, i) => (
              <line
                key={`lat-${i}`}
                x1="0"
                x2={MAP_W}
                y1={(i / 6) * MAP_H}
                y2={(i / 6) * MAP_H}
                stroke="rgba(255,255,255,0.06)"
              />
            ))}
            {[...Array(13)].map((_, i) => (
              <line
                key={`lon-${i}`}
                y1="0"
                y2={MAP_H}
                x1={(i / 12) * MAP_W}
                x2={(i / 12) * MAP_W}
                stroke="rgba(255,255,255,0.06)"
              />
            ))}
            {scoredRegions.map((row) => {
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
                  <title>{`${row.name} · ${row.country} · stage ${row.stage}`}</title>
                </circle>
              )
            })}
          </svg>
          <div className="mt-3 flex flex-wrap gap-3 text-xs text-slate-400">
            {[1, 2, 3, 4, 5].map((stage) => (
              <span key={stage} className="inline-flex items-center gap-1.5">
                <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: stageColor(stage) }} />
                Stage {stage}
              </span>
            ))}
          </div>
        </section>

        <section className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04]">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 px-4 py-3">
            <div className="flex items-center gap-3">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Regions</h2>
              <span className="text-xs text-slate-500">
                ({scoredRegions.length} with score &gt; 0)
              </span>
            </div>
            <div className="flex items-center gap-3">
              {scoredRegions.length > 200 ? (
                <button
                  type="button"
                  onClick={() => setShowAll((prev) => !prev)}
                  className="rounded-xl border border-white/12 bg-white/5 px-2.5 py-1 text-xs font-semibold text-slate-300 hover:bg-white/10"
                >
                  {showAll ? 'Show top 200' : `Show all (${scoredRegions.length})`}
                </button>
              ) : null}
              <p className="text-xs text-slate-500">
                Run all estimate ${overview?.runAllEstimateUsd.toFixed(2) ?? '0.00'} ({overview?.runAllCount ?? 0} × $
                {ESTIMATE_USD_PER_REGION.toFixed(2)})
              </p>
            </div>
          </div>
          <div className="grid grid-cols-12 gap-2 border-b border-white/10 px-4 py-3 text-xs font-semibold text-slate-300">
            <div className="col-span-3">Name</div>
            <div className="col-span-2">Country</div>
            <div className="col-span-1">Stage</div>
            <div className="col-span-1 text-right">Score</div>
            <div className="col-span-2">Triggers</div>
            <div className="col-span-2">Last run</div>
            <div className="col-span-1 text-right">Run</div>
          </div>
          {!overview ? (
            <div className="px-4 py-10 text-center text-sm text-slate-300">Loading…</div>
          ) : scoredRegions.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-slate-300">No regions with score &gt; 0 today.</div>
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
                    {row.name}
                  </button>
                  <div className="col-span-2 truncate text-slate-300">{row.country}</div>
                  <div className="col-span-1">
                    <span
                      className="inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold"
                      style={{ background: `${stageColor(row.stage)}22`, color: stageColor(row.stage) }}
                    >
                      {row.stage}
                    </span>
                  </div>
                  <div className="col-span-1 text-right tabular-nums text-slate-200">{row.score}</div>
                  <div className="col-span-2 flex flex-wrap gap-1">
                    {row.triggers.length === 0 ? (
                      <span className="text-xs text-slate-500">—</span>
                    ) : (
                      row.triggers.map((key) => (
                        <span key={key} className="rounded-full border border-white/12 bg-white/5 px-2 py-0.5 text-[10px] text-slate-200">
                          {key}
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
                      {busy === `region-${row.regionId}` ? '…' : 'Run engine'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-4">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-400">Queue</h2>
          <div className="grid gap-3 md:grid-cols-4">
            {(['queued', 'running', 'done', 'failed'] as QueueStatus[]).map((status) => (
              <div key={status} className="rounded-xl border border-white/10 bg-[#0b1020] px-3 py-3">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {status} · {byStatus[status].length}
                </p>
                <ul className="space-y-2">
                  {byStatus[status].length === 0 ? (
                    <li className="text-xs text-slate-500">None</li>
                  ) : (
                    byStatus[status].slice(0, 12).map((row) => (
                      <li key={row.id}>
                        <button
                          type="button"
                          className="w-full text-left"
                          onClick={() => {
                            if (row.run_id) void loadRun(row.run_id).catch((e: unknown) => setRunError(e instanceof Error ? e.message : 'Failed'))
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

        <section className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Run result</h2>
            {run ? (
              <button
                type="button"
                onClick={() => void publishRun()}
                disabled={busy !== null || run.public || !run.result}
                className="rounded-xl bg-cyan-600 px-4 py-2 text-sm font-semibold text-white hover:bg-cyan-500 disabled:opacity-50"
              >
                {run.public ? 'Published' : busy === 'publish' ? 'Publishing…' : 'Publish'}
              </button>
            ) : null}
          </div>
          {selected ? (
            <p className="mb-3 text-sm text-slate-400">
              {selected.name} / {selected.country} · stage {selected.stage} · score {selected.score}
            </p>
          ) : null}
          {runError ? <p className="mb-3 text-sm text-rose-200">{runError}</p> : null}
          {publishMsg ? <p className="mb-3 text-sm text-slate-300">{publishMsg}</p> : null}
          {!run?.result ? (
            <p className="text-sm text-slate-500">Pick a finished queue item to inspect the three-tier card.</p>
          ) : (
            <div className="space-y-4 text-sm">
              <p className="text-slate-300">{run.result.headline_en ?? run.result.summary_en}</p>
              <p className="text-xs text-slate-500">
                Novelty: only us {run.result.novelty_counts?.only_us ?? 0} · also seen elsewhere{' '}
                {run.result.novelty_counts?.also_seen_elsewhere ?? 0} · cost ${run.costUsd.toFixed(4)}
              </p>
              <Tier title="Headlines" rows={run.result.headlines} />
              <Tier title="Missed by others" rows={run.result.missed_by_others} />
              <div>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Baseline risks</h3>
                <ul className="space-y-2">
                  {run.result.baseline_risks.map((row) => (
                    <li key={row.title} className="rounded-xl border border-white/10 bg-[#0b1020] px-3 py-2">
                      <p className="font-semibold text-white">{row.title}</p>
                      <p className="text-xs text-slate-400">
                        stage {row.stage} · {row.possibility}
                        {row.reason ? ` · ${row.reason}` : ''}
                      </p>
                    </li>
                  ))}
                </ul>
              </div>
              {run.searchUrls.length > 0 ? (
                <div>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Evidence links</h3>
                  <ul className="space-y-1 text-xs">
                    {run.searchUrls.slice(0, 12).map((url) => (
                      <li key={url}>
                        <a href={url} target="_blank" rel="noopener noreferrer" className="text-cyan-300 hover:underline">
                          {url}
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          )}
        </section>
      </div>
    </main>
  )
}

function Tier({ title, rows }: { title: string; rows: HypothesisView[] }) {
  return (
    <div>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-xs text-slate-500">None</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((row) => (
            <li key={row.title} className="rounded-xl border border-white/10 bg-[#0b1020] px-3 py-2">
              <p className="font-semibold text-white">{row.title}</p>
              <p className="text-xs text-slate-400">
                {row.novelty ?? '—'} · stage {row.stage ?? '—'} · {row.possibility ?? ''}
              </p>
              <div className="mt-1 flex flex-wrap gap-2">
                {(row.official_links ?? []).map((link) => (
                  <a key={link.url} href={link.url} target="_blank" rel="noopener noreferrer" className="text-xs text-cyan-300 hover:underline">
                    {link.label}
                  </a>
                ))}
                {(row.evidence ?? [])
                  .filter((item) => item.url)
                  .map((item) => (
                    <a key={item.url} href={item.url} target="_blank" rel="noopener noreferrer" className="text-xs text-cyan-300/80 hover:underline">
                      {item.ref}
                    </a>
                  ))}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
