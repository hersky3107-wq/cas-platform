'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { KR_GROUPS, type KrGroupId, type UniverseMarket } from '@/lib/league/korea-equity-catalog'
import { UI_HORIZONS, type UiHorizon } from '@/lib/league/horizon'
import { useLeagueLocale } from '@/lib/league/i18n/use-league-locale'
import { getLeagueUiPack } from '@/lib/league/i18n/dictionary'
import type { LeagueLocale } from '@/lib/league/i18n/locales'
import { krxPrePublicationKind, lastCompletedKrxSession } from '@/lib/league/krx-calendar'
import { KR_GROUP_VISUALS, KrGroupDot, KrGroupIcon } from '@/components/league/KrGroupVisuals'

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

/** Per-market accent for the segmented tab control. */
const TAB_ACCENT: Record<MarketTab, { active: string; dot: string }> = {
  KOSPI: { active: 'bg-blue-700 text-white shadow-sm', dot: 'bg-blue-600' },
  KOSDAQ: { active: 'bg-violet-700 text-white shadow-sm', dot: 'bg-violet-600' },
  US: { active: 'bg-emerald-700 text-white shadow-sm', dot: 'bg-emerald-600' },
}

const ALL_GROUPS = 'all' as const
type GroupFilter = KrGroupId | typeof ALL_GROUPS

/** Chips shown before "더보기" per group section. */
const GROUP_PREVIEW_COUNT = 8
/** Hot strip size per tab. */
const HOT_STRIP_COUNT = 12

/** Global popularity order for the hot strip (section grids keep server order). */
export function hotStripFromRows<T extends { popularityRank: number | null }>(
  rows: readonly T[],
  limit = HOT_STRIP_COUNT,
): T[] {
  return [...rows]
    .sort((a, b) => {
      const ra = a.popularityRank
      const rb = b.popularityRank
      if (ra == null && rb == null) return 0
      if (ra == null) return 1
      if (rb == null) return -1
      return ra - rb
    })
    .slice(0, limit)
}

function krTickerFromInstrument(instrument: string): string {
  const parts = instrument.split(':')
  return parts.length === 3 ? parts[2]! : instrument
}

/** 1–2 letter monogram from a ticker (US chips). */
function tickerMonogram(ticker: string): string {
  const clean = ticker.replace(/[^A-Za-z]/g, '')
  return (clean.slice(0, 2) || ticker.slice(0, 2)).toUpperCase()
}

/**
 * Uniform stock chip: fixed height, full-width within the grid cell, name
 * truncated with ellipsis (full name in `title`). Selected = accent ring +
 * filled tint — never color alone (the check glyph + aria-pressed carry it).
 */
function StockChip({
  name,
  selected,
  onClick,
  visual,
}: {
  name: string
  selected: boolean
  onClick: () => void
  visual: { tint: string; ring: string }
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      title={name}
      className={`flex h-[44px] w-full items-center justify-center gap-1 rounded-xl px-2 text-sm font-semibold transition ${
        selected
          ? `${visual.tint} text-slate-900 ring-2 ${visual.ring} dark:text-slate-100`
          : 'bg-white text-slate-700 shadow-sm hover:bg-slate-100 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700'
      }`}
    >
      {selected ? (
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="shrink-0">
          <path d="M2 6.5 4.8 9.3 10 3.5" />
        </svg>
      ) : null}
      <span className="truncate">{name}</span>
    </button>
  )
}

/** Hot-strip chip: slightly larger, horizontal-scroll row item. */
function HotChip({
  name,
  sub,
  selected,
  onClick,
  accent,
}: {
  name: string
  sub?: string
  selected: boolean
  onClick: () => void
  accent: { tint: string; ring: string }
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      title={name}
      className={`flex h-[52px] shrink-0 flex-col justify-center rounded-xl px-3.5 text-left transition ${
        selected
          ? `${accent.tint} text-slate-900 ring-2 ${accent.ring} dark:text-slate-100`
          : 'bg-white text-slate-700 shadow-sm hover:bg-slate-100 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700'
      }`}
    >
      <span className="max-w-[140px] truncate text-sm font-semibold leading-tight">{name}</span>
      {sub ? (
        <span className="mt-0.5 text-[11px] font-medium text-slate-400 dark:text-slate-500">{sub}</span>
      ) : null}
    </button>
  )
}

/** US chip: circular monogram + Korean name + muted ticker. */
function UsChip({
  name,
  ticker,
  selected,
  onClick,
}: {
  name: string
  ticker: string
  selected: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      title={`${name} (${ticker})`}
      className={`flex h-[56px] w-full items-center gap-2 rounded-xl px-2.5 text-left transition ${
        selected
          ? 'bg-emerald-50 text-slate-900 ring-2 ring-emerald-600 dark:bg-emerald-950/40 dark:text-slate-100 dark:ring-emerald-400'
          : 'bg-white text-slate-700 shadow-sm hover:bg-emerald-50/60 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700'
      }`}
    >
      <span
        aria-hidden
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-[11px] font-bold text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-200"
      >
        {tickerMonogram(ticker)}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold leading-tight">{name}</span>
        <span className="mt-0.5 block text-[11px] font-medium text-slate-400 dark:text-slate-500">
          {ticker}
        </span>
      </span>
    </button>
  )
}

/** Uniform responsive grid: 2–3 cols mobile, 4 tablet, 6 desktop. */
const GRID_CLASS = 'grid grid-cols-2 gap-2 min-[480px]:grid-cols-3 md:grid-cols-4 lg:grid-cols-6'

const KR_GROUP_FILTER_SCROLL_STEP = 160

/** Horizontally scrollable group filter with hidden scrollbar, edge fades, arrows, and wheel scroll. */
function GroupFilterScrollRow({
  children,
  className = '',
}: {
  children: React.ReactNode
  className?: string
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [fade, setFade] = useState({ left: false, right: false })

  const updateFade = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const { scrollLeft, scrollWidth, clientWidth } = el
    const overflow = scrollWidth > clientWidth + 1
    setFade({
      left: overflow && scrollLeft > 2,
      right: overflow && scrollLeft + clientWidth < scrollWidth - 2,
    })
  }, [])

  const scrollByStep = useCallback((delta: number) => {
    scrollRef.current?.scrollBy({ left: delta, behavior: 'smooth' })
  }, [])

  useEffect(() => {
    updateFade()
    const el = scrollRef.current
    if (!el) return
    const ro = new ResizeObserver(() => updateFade())
    ro.observe(el)
    el.addEventListener('scroll', updateFade, { passive: true })
    const onWheel = (event: WheelEvent) => {
      if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return
      el.scrollLeft += event.deltaY
      event.preventDefault()
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      ro.disconnect()
      el.removeEventListener('scroll', updateFade)
      el.removeEventListener('wheel', onWheel)
    }
  }, [updateFade, children])

  return (
    <div className={`relative ${className}`}>
      {fade.left ? (
        <>
          <div
            aria-hidden
            className="pointer-events-none absolute left-0 top-0 z-10 h-full w-10 bg-gradient-to-r from-slate-50 via-slate-50/80 to-transparent dark:from-slate-900 dark:via-slate-900/80"
          />
          <button
            type="button"
            data-testid="kr-group-filter-scroll-left"
            aria-label="이전 분야"
            onClick={() => scrollByStep(-KR_GROUP_FILTER_SCROLL_STEP)}
            className="absolute left-0 top-1/2 z-20 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full border border-slate-200/80 bg-white/95 text-slate-700 shadow-sm hover:bg-white dark:border-slate-600 dark:bg-slate-800/95 dark:text-slate-100"
          >
            <span aria-hidden className="text-sm leading-none">
              ‹
            </span>
          </button>
        </>
      ) : null}
      {fade.right ? (
        <>
          <div
            aria-hidden
            className="pointer-events-none absolute right-0 top-0 z-10 h-full w-10 bg-gradient-to-l from-slate-50 via-slate-50/80 to-transparent dark:from-slate-900 dark:via-slate-900/80"
          />
          <button
            type="button"
            data-testid="kr-group-filter-scroll-right"
            aria-label="다음 분야"
            onClick={() => scrollByStep(KR_GROUP_FILTER_SCROLL_STEP)}
            className="absolute right-0 top-1/2 z-20 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full border border-slate-200/80 bg-white/95 text-slate-700 shadow-sm hover:bg-white dark:border-slate-600 dark:bg-slate-800/95 dark:text-slate-100"
          >
            <span aria-hidden className="text-sm leading-none">
              ›
            </span>
          </button>
        </>
      ) : null}
      <div
        ref={scrollRef}
        data-testid="kr-group-filter-scroll"
        className="kr-group-filter-scroll flex flex-nowrap gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
      >
        {children}
      </div>
    </div>
  )
}

/** Loading skeleton that mirrors the loaded layout (no layout shift). */
function SkeletonBrowser() {
  return (
    <div data-testid="kr-chip-skeleton" className="flex flex-col gap-6">
      {/* Hot strip skeleton */}
      <div className="flex gap-2 overflow-hidden">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="h-[52px] w-[120px] shrink-0 animate-pulse rounded-xl bg-slate-200 dark:bg-slate-700" />
        ))}
      </div>
      {/* Filter row skeleton */}
      <div className="flex gap-2 overflow-hidden">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="h-[36px] w-20 shrink-0 animate-pulse rounded-full bg-slate-200 dark:bg-slate-700" />
        ))}
      </div>
      {/* Group card skeleton */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
        <div className="mb-3 h-5 w-32 animate-pulse rounded bg-slate-200 dark:bg-slate-700" />
        <div className={GRID_CLASS}>
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className="h-[44px] animate-pulse rounded-xl bg-slate-200 dark:bg-slate-700" />
          ))}
        </div>
      </div>
    </div>
  )
}

/**
 * Korean-lane chip browser. KOSPI/KOSDAQ group sections; US is one grid.
 * Non-admin KR chips show a 준비 중 notice. Admin KR chips and US chips
 * hand the instrument to the existing card/generate flow.
 */
export const KR_STOCK_PENDING_NOTICE = '국내 종목 예측은 준비 중입니다.'

export function krStockRefusalMessage(
  code: string | null | undefined,
  locale: LeagueLocale = 'ko',
  now: Date = new Date(),
): string | null {
  if (code === 'krx_calendar_unverified') return '국내 거래 일정 확인 중입니다.'
  if (code === 'krx_not_published' || code === 'not_published') {
    const last = lastCompletedKrxSession(now)
    const kind = last.ok ? krxPrePublicationKind(last.date, now) : 'later'
    return getLeagueUiPack(locale).hub.krxNotPublished(kind)
  }
  if (code === 'anchor_unavailable') return '기준가를 아직 확인할 수 없습니다. 잠시 후 다시 시도하세요.'
  if (code === 'kr_stock_not_open') return KR_STOCK_PENDING_NOTICE
  return null
}

export function scrollToLeagueRoundCard() {
  if (typeof document === 'undefined') return
  document.querySelector('[data-testid="league-round-card"]')?.scrollIntoView({
    behavior: 'smooth',
    block: 'start',
  })
}

export function KrSelectionBar({
  selected,
  showHorizons,
  horizon,
  horizonLabels,
  pendingNotice,
  onPickHorizon,
  onClose,
  actionLabel,
  actionEnabled = false,
  actionEta = null,
  actionNotice = null,
  onAction,
}: {
  selected: KrUniverseRow
  showHorizons: boolean
  horizon: UiHorizon
  horizonLabels: Record<UiHorizon, string>
  pendingNotice: string | null
  onPickHorizon: (next: UiHorizon) => void
  onClose: () => void
  actionLabel?: string | null
  actionEnabled?: boolean
  actionEta?: string | null
  actionNotice?: string | null
  onAction?: () => void
}) {
  const ticker = selected.market === 'US' ? krTickerFromInstrument(selected.instrument) : selected.code
  return (
    <div
      data-testid="kr-selection-bar"
      className="sticky bottom-0 z-20 -mx-1 mt-3 border-t border-slate-200 bg-white/95 px-3 pt-2.5 shadow-[0_-8px_24px_rgba(15,23,42,0.08)] backdrop-blur-sm dark:border-slate-700 dark:bg-slate-900/95 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
            {selected.name}
            <span className="ml-1.5 text-xs font-medium text-slate-400 dark:text-slate-500">{ticker}</span>
          </p>
          {showHorizons ? (
            <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label="Horizon">
              {UI_HORIZONS.map((h) => (
                <button
                  key={h}
                  type="button"
                  onClick={() => onPickHorizon(h)}
                  aria-current={horizon === h}
                  className={`min-h-[44px] rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                    horizon === h
                      ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
                      : 'bg-white text-slate-600 shadow-sm hover:bg-slate-100 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'
                  }`}
                >
                  {horizonLabels[h]}
                </button>
              ))}
            </div>
          ) : pendingNotice ? (
            <p
              data-testid="kr-chip-pending"
              className="mt-1.5 text-xs leading-relaxed text-slate-500 dark:text-slate-400"
            >
              {pendingNotice}
            </p>
          ) : null}
          {actionLabel ? (
            <InstrumentActionButton
              label={actionLabel}
              enabled={actionEnabled}
              eta={actionEta}
              notice={actionNotice}
              onPress={onAction}
            />
          ) : null}
        </div>
        <button
          type="button"
          aria-label="선택 해제"
          onClick={onClose}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-lg leading-none text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
        >
          ×
        </button>
      </div>
    </div>
  )
}

export function InstrumentActionButton({
  label,
  enabled,
  eta,
  notice,
  onPress,
}: {
  label: string
  enabled: boolean
  eta?: string | null
  notice?: string | null
  onPress?: () => void
}) {
  return (
    <div className="mt-2">
      <button
        type="button"
        data-testid="instrument-action"
        disabled={!enabled}
        onClick={() => onPress?.()}
        className="league-btn-primary w-full"
      >
        {label}
      </button>
      {eta ? (
        <p data-testid="instrument-action-eta" className="mt-1 text-[11px] leading-relaxed text-slate-500">
          {eta}
        </p>
      ) : null}
      {notice ? <p className="mt-1 text-xs text-rose-700">{notice}</p> : null}
    </div>
  )
}

export function KrUniverseChipBrowser({
  onSelectUsInstrument,
  isAdmin = false,
  actionLabel = null,
  actionEnabled = false,
  actionEta = null,
  actionNotice = null,
  onAction,
}: {
  onSelectUsInstrument: (instrument: string, horizon: UiHorizon) => void
  /** Hub `viewerIsAdmin`. KR stocks generate for every signed-in user. */
  isAdmin?: boolean
  actionLabel?: string | null
  actionEnabled?: boolean
  actionEta?: string | null
  actionNotice?: string | null
  onAction?: () => void
}) {
  void isAdmin
  const { t } = useLeagueLocale()
  const [tab, setTab] = useState<MarketTab>('KOSPI')
  const [rows, setRows] = useState<KrUniverseRow[] | null>(null)
  const [error, setError] = useState(false)
  const [groupFilter, setGroupFilter] = useState<GroupFilter>(ALL_GROUPS)
  const [selected, setSelected] = useState<KrUniverseRow | null>(null)
  const [horizon, setHorizon] = useState<UiHorizon>('1d')
  const [expandedGroups, setExpandedGroups] = useState<ReadonlySet<KrGroupId>>(new Set())

  useEffect(() => {
    let cancelled = false
    setRows(null)
    setError(false)
    setSelected(null)
    setGroupFilter(ALL_GROUPS)
    setExpandedGroups(new Set())
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

  function generatesOnSelect(row: KrUniverseRow): boolean {
    void row
    return true
  }

  function pick(row: KrUniverseRow) {
    setSelected(row)
    if (generatesOnSelect(row)) {
      onSelectUsInstrument(row.instrument, horizon)
    }
  }

  function pickHorizon(next: UiHorizon) {
    setHorizon(next)
    if (selected && generatesOnSelect(selected)) {
      onSelectUsInstrument(selected.instrument, next)
      scrollToLeagueRoundCard()
    }
  }

  function expandGroup(id: KrGroupId) {
    setExpandedGroups((prev) => new Set(prev).add(id))
  }

  const groupsPresent =
    rows && tab !== 'US'
      ? KR_GROUPS.filter((g) => rows.some((row) => (row.groupId ?? 'other') === g.id))
      : []
  const visibleSections =
    rows && tab !== 'US'
      ? groupsPresent.filter((g) => groupFilter === ALL_GROUPS || groupFilter === g.id)
      : []
  const hotRows = rows && tab !== 'US' ? hotStripFromRows(rows) : []
  const loaded = rows !== null && !error && rows.length > 0
  const showHotStrip = loaded && tab !== 'US'

  return (
    <div data-testid="kr-universe-browser" className="flex flex-col gap-6">
      {/* Market tabs — sticky segmented control with per-market accent */}
      <div
        className="sticky top-0 z-10 -mx-1 bg-slate-50/95 px-1 py-1 backdrop-blur-sm dark:bg-slate-900/95"
      >
        <div
          className="flex gap-1 rounded-2xl bg-white p-1 shadow-sm dark:bg-slate-800"
          role="tablist"
          aria-label="시장"
        >
          {(Object.keys(TAB_LABEL) as MarketTab[]).map((key) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              onClick={() => setTab(key)}
              className={`flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-xl px-2 py-2 text-sm font-semibold transition ${
                tab === key
                  ? TAB_ACCENT[key].active
                  : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700'
              }`}
            >
              <span
                aria-hidden
                className={`h-1.5 w-1.5 rounded-full ${tab === key ? 'bg-white/80' : TAB_ACCENT[key].dot}`}
              />
              {TAB_LABEL[key]}
            </button>
          ))}
        </div>
      </div>

      {rows === null && !error ? <SkeletonBrowser /> : null}
      {error ? (
        <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">
          종목을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.
        </p>
      ) : null}
      {rows !== null && !error && rows.length === 0 ? (
        <p className="rounded-xl border border-slate-200 bg-white px-3 py-4 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
          표시할 종목이 없습니다.
        </p>
      ) : null}

      {showHotStrip ? (
        <section aria-label="지금 거래가 몰리는 종목">
          <h3 className="text-[15px] font-semibold text-slate-800 dark:text-slate-100">
            지금 거래가 몰리는 종목
          </h3>
          <div
            data-testid="kr-hot-strip"
            className="-mx-3 mt-2 flex gap-2 overflow-x-auto px-3 pb-1 sm:mx-0 sm:px-0"
          >
            {hotRows.map((row) => (
              <HotChip
                key={row.code}
                name={row.name}
                selected={selected?.code === row.code}
                onClick={() => pick(row)}
                accent={KR_GROUP_VISUALS[(row.groupId ?? 'other') as KrGroupId]}
              />
            ))}
          </div>
        </section>
      ) : null}

      {loaded && tab !== 'US' ? (
        <>
          {/* Group filter — one horizontally scrollable row, never wraps */}
          <div role="group" aria-label="업종 필터">
            <GroupFilterScrollRow className="-mx-3 px-3 sm:mx-0 sm:px-0">
            <button
              type="button"
              onClick={() => setGroupFilter(ALL_GROUPS)}
              aria-pressed={groupFilter === ALL_GROUPS}
              className={`flex h-[36px] shrink-0 items-center gap-1.5 rounded-full px-3.5 text-xs font-semibold transition ${
                groupFilter === ALL_GROUPS
                  ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
                  : 'bg-white text-slate-600 shadow-sm hover:bg-slate-100 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'
              }`}
            >
              전체
            </button>
            {groupsPresent.map((g) => (
              <button
                key={g.id}
                type="button"
                onClick={() => setGroupFilter(g.id)}
                aria-pressed={groupFilter === g.id}
                className={`flex h-[36px] shrink-0 items-center gap-1.5 rounded-full px-3.5 text-xs font-semibold transition ${
                  groupFilter === g.id
                    ? `${KR_GROUP_VISUALS[g.id].tint} text-slate-900 ring-2 ${KR_GROUP_VISUALS[g.id].ring} dark:text-slate-100`
                    : 'bg-white text-slate-600 shadow-sm hover:bg-slate-100 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'
                }`}
              >
                <KrGroupDot groupId={g.id} />
                {g.label}
              </button>
            ))}
            </GroupFilterScrollRow>
          </div>

          {visibleSections.map((group) => {
            const visual = KR_GROUP_VISUALS[group.id]
            const groupRows = rows.filter((row) => (row.groupId ?? 'other') === group.id)
            const expanded = groupFilter === group.id || expandedGroups.has(group.id)
            const shown = expanded ? groupRows : groupRows.slice(0, GROUP_PREVIEW_COUNT)
            const hiddenCount = groupRows.length - shown.length
            return (
              <section
                key={group.id}
                data-kr-group={group.id}
                className="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800"
              >
                <header className={`flex items-center gap-2 border-l-4 px-4 pb-2 pt-3 ${visual.ring.replace('ring-', 'border-')}`}>
                  <span className={visual.accent}>
                    <KrGroupIcon groupId={group.id} />
                  </span>
                  <h3 className="text-[15px] font-semibold text-slate-800 dark:text-slate-100">
                    {group.label}
                  </h3>
                  <span className="text-xs font-medium text-slate-400 dark:text-slate-500">
                    {groupRows.length}종목
                  </span>
                </header>
                <div className={`px-4 pb-3 pt-1 ${GRID_CLASS}`}>
                  {shown.map((row) => (
                    <StockChip
                      key={row.code}
                      name={row.name}
                      selected={selected?.code === row.code}
                      onClick={() => pick(row)}
                      visual={visual}
                    />
                  ))}
                </div>
                {hiddenCount > 0 ? (
                  <button
                    type="button"
                    onClick={() => expandGroup(group.id)}
                    aria-expanded={false}
                    className="block w-full border-t border-slate-100 px-4 py-2.5 text-center text-xs font-semibold text-slate-500 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-700/60"
                  >
                    더보기 (+{hiddenCount})
                  </button>
                ) : null}
              </section>
            )
          })}
        </>
      ) : null}

      {loaded && tab === 'US' ? (
        <div className={GRID_CLASS}>
          {rows.map((row) => (
            <UsChip
              key={row.code}
              name={row.name}
              ticker={krTickerFromInstrument(row.instrument)}
              selected={selected?.code === row.code}
              onClick={() => pick(row)}
            />
          ))}
        </div>
      ) : null}

      {selected ? (
        <KrSelectionBar
          selected={selected}
          showHorizons={generatesOnSelect(selected)}
          horizon={horizon}
          horizonLabels={t.catalog.horizons}
          pendingNotice={null}
          onPickHorizon={pickHorizon}
          onClose={() => setSelected(null)}
          actionLabel={actionLabel}
          actionEnabled={actionEnabled}
          actionEta={actionEta}
          actionNotice={actionNotice}
          onAction={onAction}
        />
      ) : null}
    </div>
  )
}
