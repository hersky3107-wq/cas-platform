'use client'

import { useEffect, useState } from 'react'
import { KR_GROUPS, type KrGroupId, type UniverseMarket } from '@/lib/league/korea-equity-catalog'
import { UI_HORIZONS, type UiHorizon } from '@/lib/league/horizon'
import { useLeagueLocale } from '@/lib/league/i18n/use-league-locale'

export type KrUniverseRow = {
  market: UniverseMarket
  code: string
  name: string
  groupId: KrGroupId | null
  popularityRank: number | null
  instrument: string
}

type MarketTab = 'KOSPI' | 'KOSDAQ' | 'US'

const TAB_LABEL: Record<MarketTab, string> = {
  KOSPI: '코스피',
  KOSDAQ: '코스닥',
  US: '미국',
}

const ALL_GROUPS = 'all' as const
type GroupFilter = KrGroupId | typeof ALL_GROUPS

function krTickerFromInstrument(instrument: string): string {
  const parts = instrument.split(':')
  return parts.length === 3 ? parts[2]! : instrument
}

function Chip({
  selected,
  onClick,
  children,
}: {
  selected: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`min-h-[44px] rounded-xl px-3 py-2 text-left text-sm font-semibold transition ${
        selected ? 'bg-slate-900 text-white' : 'bg-white text-slate-700 shadow-sm hover:bg-slate-100'
      }`}
    >
      {children}
    </button>
  )
}

function SkeletonChips() {
  return (
    <div className="flex flex-wrap gap-1.5" data-testid="kr-chip-skeleton">
      {Array.from({ length: 12 }, (_, i) => (
        <div key={i} className="h-[44px] w-24 animate-pulse rounded-xl bg-slate-200" />
      ))}
    </div>
  )
}

/**
 * Korean-lane chip browser. KOSPI/KOSDAQ group sections; US is one grid.
 * No search box. KR chips show a 준비 중 notice; US chips hand the STOCK
 * instrument to the existing card/generate flow.
 */
export function KrUniverseChipBrowser({
  onSelectUsInstrument,
}: {
  onSelectUsInstrument: (instrument: string, horizon: UiHorizon) => void
}) {
  const { t } = useLeagueLocale()
  const [tab, setTab] = useState<MarketTab>('KOSPI')
  const [rows, setRows] = useState<KrUniverseRow[] | null>(null)
  const [error, setError] = useState(false)
  const [groupFilter, setGroupFilter] = useState<GroupFilter>(ALL_GROUPS)
  const [selected, setSelected] = useState<KrUniverseRow | null>(null)
  const [horizon, setHorizon] = useState<UiHorizon>('1d')

  useEffect(() => {
    let cancelled = false
    setRows(null)
    setError(false)
    setSelected(null)
    setGroupFilter(ALL_GROUPS)
    void (async () => {
      try {
        const res = await fetch(`/api/league/kr-universe?market=${tab}`, { credentials: 'include' })
        const body = (await res.json().catch(() => null)) as { rows?: KrUniverseRow[] } | null
        if (cancelled) return
        if (!res.ok) {
          setError(true)
          setRows([])
          return
        }
        setRows(Array.isArray(body?.rows) ? body.rows : [])
      } catch {
        if (!cancelled) {
          setError(true)
          setRows([])
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [tab])

  function pick(row: KrUniverseRow) {
    setSelected(row)
    if (row.market === 'US') {
      onSelectUsInstrument(row.instrument, horizon)
    }
  }

  function pickHorizon(next: UiHorizon) {
    setHorizon(next)
    if (selected?.market === 'US') {
      onSelectUsInstrument(selected.instrument, next)
    }
  }

  const groupsPresent =
    rows && tab !== 'US'
      ? KR_GROUPS.filter((g) => rows.some((row) => (row.groupId ?? 'other') === g.id))
      : []
  const visibleSections =
    rows && tab !== 'US'
      ? groupsPresent.filter((g) => groupFilter === ALL_GROUPS || groupFilter === g.id)
      : []

  return (
    <div data-testid="kr-universe-browser" className="flex flex-col gap-3">
      {/* Market tabs */}
      <div className="flex gap-1 rounded-full bg-white p-1 shadow-sm" role="tablist" aria-label="시장">
        {(Object.keys(TAB_LABEL) as MarketTab[]).map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={`min-h-[44px] flex-1 rounded-full px-2 py-2 text-xs font-semibold transition ${
              tab === key ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            {TAB_LABEL[key]}
          </button>
        ))}
      </div>

      {rows === null && !error ? <SkeletonChips /> : null}
      {error ? (
        <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
          종목을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.
        </p>
      ) : null}
      {rows !== null && !error && rows.length === 0 ? (
        <p className="rounded-xl border border-slate-200 bg-white px-3 py-4 text-center text-sm text-slate-500">
          표시할 종목이 없습니다.
        </p>
      ) : null}

      {rows !== null && !error && rows.length > 0 && tab !== 'US' ? (
        <>
          {/* Group filter chips */}
          <div className="-mx-3 flex gap-1.5 overflow-x-auto px-3 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0">
            <Chip selected={groupFilter === ALL_GROUPS} onClick={() => setGroupFilter(ALL_GROUPS)}>
              전체
            </Chip>
            {groupsPresent.map((g) => (
              <Chip key={g.id} selected={groupFilter === g.id} onClick={() => setGroupFilter(g.id)}>
                {g.label}
              </Chip>
            ))}
          </div>

          {visibleSections.map((group) => (
            <section key={group.id} data-kr-group={group.id}>
              <h3 className="text-xs font-semibold tracking-wide text-slate-500">{group.label}</h3>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {rows
                  .filter((row) => (row.groupId ?? 'other') === group.id)
                  .map((row) => (
                    <Chip
                      key={row.code}
                      selected={selected?.code === row.code}
                      onClick={() => pick(row)}
                    >
                      {row.name}
                    </Chip>
                  ))}
              </div>
            </section>
          ))}
        </>
      ) : null}

      {rows !== null && !error && rows.length > 0 && tab === 'US' ? (
        <div className="flex flex-wrap gap-1.5">
          {rows.map((row) => (
            <Chip key={row.code} selected={selected?.code === row.code} onClick={() => pick(row)}>
              <span className="block text-sm">{row.name}</span>
              <span className="mt-0.5 block text-[11px] font-medium text-slate-400">
                {krTickerFromInstrument(row.instrument)}
              </span>
            </Chip>
          ))}
        </div>
      ) : null}

      {selected?.market === 'US' ? (
        <div className="flex gap-1.5" role="group" aria-label="Horizon">
          {UI_HORIZONS.map((h) => (
            <button
              key={h}
              type="button"
              onClick={() => pickHorizon(h)}
              aria-current={horizon === h}
              className={`min-h-[44px] rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                horizon === h ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 shadow-sm hover:bg-slate-100'
              }`}
            >
              {t.catalog.horizons[h]}
            </button>
          ))}
        </div>
      ) : null}

      {selected && selected.market !== 'US' ? (
        <p
          data-testid="kr-chip-pending"
          className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500"
        >
          국내 종목 예측은 준비 중입니다.
        </p>
      ) : null}
    </div>
  )
}
