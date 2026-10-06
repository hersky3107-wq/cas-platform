'use client'

import { useState, type ReactNode } from 'react'
import { rateText } from '@/lib/league/boards/display'
import { boardDoorOfCategory, normalizeBoardFilters } from '@/lib/league/boards/filters'
import {
  BOARD_DOORS,
  BOARD_HORIZONS,
  BOARD_PERIODS,
  type BannerBoard,
  type BoardFilters,
  type BoardsResponse,
  type HighlightCard,
} from '@/lib/league/boards/types'
import { BOARD_TABS, type BoardTab } from '@/lib/league/i18n/leaderboard-board-copy'
import { BattleRows, BoardTabBody, RateBar, RateFigure, type BoardView } from './LeaderboardBoardTabs'

/**
 * Leaderboard body: filters → AI 종합 banner → today's matchups → tabs.
 * Renders a cached `BoardsResponse` as-is; it never computes a figure.
 */
export function LeaderboardBoards({
  response,
  view,
  loading = false,
  onFilters,
  initialTab = 'battle',
}: {
  response: BoardsResponse
  view: BoardView
  loading?: boolean
  onFilters: (next: BoardFilters) => void
  initialTab?: BoardTab
}) {
  const [tab, setTab] = useState<BoardTab>(initialTab)
  const { t, copy } = view
  const { boards, meta } = response

  return (
    <div aria-busy={loading}>
      <div className="px-4 pb-2 pt-4">
        <h2 className="text-sm font-semibold text-league-fg">{t.leaderboard.title}</h2>
        <p className="text-[11px] text-league-fg-muted">{t.leaderboard.subtitle}</p>
      </div>

      <FiltersBar filters={response.filters} categories={meta.categories} view={view} onChange={onFilters} />

      {response.pending ? (
        <p className="mx-4 mb-3 rounded-xl border border-league-border/40 bg-league-bg-elevated p-3 text-center text-xs text-league-fg-muted">
          {copy.pending}
        </p>
      ) : (
        <>
          <Banner banner={boards.banner} view={view} />
          <Highlights cards={boards.highlights} view={view} />
          <TabBar tab={tab} onChange={setTab} view={view} />
          <BoardTabBody tab={tab} boards={boards} view={view} />
        </>
      )}

      {loading ? (
        <p className="px-4 pb-1 text-[10px] text-league-fg-muted" aria-live="polite">
          {copy.loading}
        </p>
      ) : null}
      <p className="px-4 pt-1 text-[10px] text-league-fg-muted">{copy.scopeLine(meta.rounds)}</p>
      <p className="px-4 pb-3 pt-0.5 text-[10px] text-league-fg-muted">{copy.minSampleNote(meta.minSample)}</p>
    </div>
  )
}

function Chip({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`shrink-0 rounded-full px-2.5 py-0.5 font-semibold transition ${
        active ? 'bg-league-accent text-white' : 'bg-league-bg-elevated text-league-fg-muted hover:text-league-fg'
      }`}
    >
      {label}
    </button>
  )
}

function FilterRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-1.5 overflow-x-auto px-4 pb-1.5 text-[11px]">
      <span className="w-16 shrink-0 text-[10px] font-semibold uppercase tracking-wide text-league-fg-muted">{label}</span>
      {children}
    </div>
  )
}

function FiltersBar({
  filters,
  categories,
  view,
  onChange,
}: {
  filters: BoardFilters
  categories: readonly string[]
  view: BoardView
  onChange: (next: BoardFilters) => void
}) {
  const { copy, labels } = view
  const set = (patch: Partial<BoardFilters>) => onChange(normalizeBoardFilters({ ...filters, ...patch }))
  const chips = categories.filter((category) => filters.door === 'all' || boardDoorOfCategory(category) === filters.door)
  if (filters.category && !chips.includes(filters.category)) chips.push(filters.category)

  return (
    <div className="pb-2">
      <FilterRow label={copy.filters.door}>
        {BOARD_DOORS.map((door) => (
          <Chip key={door} active={filters.door === door} label={copy.filters.doors[door]} onClick={() => set({ door })} />
        ))}
      </FilterRow>
      <FilterRow label={copy.filters.category}>
        <Chip active={filters.category === null} label={copy.filters.all} onClick={() => set({ category: null })} />
        {chips.map((category) => (
          <Chip
            key={category}
            active={filters.category === category}
            label={labels.category(category)}
            onClick={() => set({ category })}
          />
        ))}
      </FilterRow>
      <FilterRow label={copy.filters.horizon}>
        {BOARD_HORIZONS.map((horizon) => (
          <Chip
            key={horizon}
            active={filters.horizon === horizon}
            label={horizon === 'all' ? copy.filters.all : labels.horizon(horizon)}
            onClick={() => set({ horizon })}
          />
        ))}
      </FilterRow>
      <FilterRow label={copy.filters.period}>
        {BOARD_PERIODS.map((period) => (
          <Chip
            key={period}
            active={filters.period === period}
            label={copy.filters.periods[period]}
            onClick={() => set({ period })}
          />
        ))}
      </FilterRow>
    </div>
  )
}

export function Banner({ banner, view }: { banner: BannerBoard; view: BoardView }) {
  const { copy, labels } = view
  const [open, setOpen] = useState(false)
  const figure = rateText(banner.overall, copy)
  return (
    <section
      data-board="banner"
      className="mx-4 mb-3 rounded-xl border border-league-border/40 bg-league-bg-elevated p-3"
    >
      <p className="text-center text-sm font-semibold leading-snug text-league-fg">
        {copy.bannerTitle}{' '}
        <span data-rate={figure.kind} className={figure.kind === 'pct' ? 'tabular-nums' : 'font-medium text-league-fg-muted'}>
          {figure.text}
        </span>
      </p>
      <RateBar rate={banner.overall} reference={banner.coinFlipPct} />
      <div className="relative h-3.5">
        <span
          className="absolute top-0.5 -translate-x-1/2 whitespace-nowrap text-[9px] text-league-fg-muted"
          style={{ left: `${banner.coinFlipPct}%` }}
        >
          {copy.coinFlip}
        </span>
      </div>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="pt-1 text-[11px] font-semibold text-league-accent-strong"
      >
        {open ? copy.collapse : copy.expand}
      </button>
      {open ? (
        <div className="grid grid-cols-1 gap-3 pt-2 sm:grid-cols-2">
          <div>
            <p className="pb-1.5 text-[11px] font-semibold text-league-fg">{copy.byCategory}</p>
            <BattleRows rows={banner.byCategory} label={(row) => labels.category(row.key)} view={view} />
          </div>
          <div>
            <p className="pb-1.5 text-[11px] font-semibold text-league-fg">{copy.byHorizon}</p>
            <BattleRows rows={banner.byHorizon} label={(row) => labels.horizon(row.key)} view={view} />
          </div>
        </div>
      ) : null}
    </section>
  )
}

export function Highlights({ cards, view }: { cards: readonly HighlightCard[]; view: BoardView }) {
  const { copy, labels } = view
  if (cards.length === 0) return null
  return (
    <section className="px-4 pb-3">
      <p className="pb-2 text-[10px] font-semibold uppercase tracking-wide text-league-fg-muted">{copy.todayTitle}</p>
      <div className="grid grid-cols-2 gap-2">
        {cards.map((card) => (
          <div
            key={card.id}
            data-highlight={card.id}
            className="min-w-0 rounded-xl border border-league-border/40 bg-league-bg-elevated p-2.5"
          >
            <p className="truncate pb-1.5 text-[11px] font-semibold text-league-fg">{labels.highlightTitle(card)}</p>
            <ul className="space-y-1.5">
              {card.sides.map((side) => (
                <li key={side.key} className="min-w-0">
                  <p className="truncate text-[10px] text-league-fg-muted">{labels.highlightSide(card, side.key)}</p>
                  <RateFigure rate={side.rate} view={view} pooled={card.id !== 'divination'} size="sm" />
                  <RateBar rate={side.rate} />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  )
}

function TabBar({ tab, onChange, view }: { tab: BoardTab; onChange: (tab: BoardTab) => void; view: BoardView }) {
  return (
    <div role="tablist" className="flex gap-1.5 overflow-x-auto px-4 pb-3 text-[11px]">
      {BOARD_TABS.map((id) => (
        <button
          key={id}
          type="button"
          role="tab"
          aria-selected={tab === id}
          onClick={() => onChange(id)}
          className={`shrink-0 rounded-full px-3 py-1 font-semibold transition ${
            tab === id ? 'bg-league-accent text-white' : 'bg-league-bg-elevated text-league-fg-muted hover:text-league-fg'
          }`}
        >
          {view.copy.tabs[id]}
        </button>
      ))}
    </div>
  )
}
