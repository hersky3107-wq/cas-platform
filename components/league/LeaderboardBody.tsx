'use client'

import { useState } from 'react'
import type { BaselineRow, BaselineSummary } from '@/lib/league/baselines'
import { COIN_FLIP_EXPECTED_PCT } from '@/lib/league/baselines'
import type { LeaderboardData, LeaderboardRow, LeaderboardScope } from '@/lib/league/leaderboard-aggregate'
import type { LeagueUiPack } from '@/lib/league/i18n/dictionary'
import type { ComplianceReceipt } from './CardCompliance'
import { LeaderboardCampHeadline } from './LeaderboardCampHeadline'
import { WinRateFigure, WinRateRecord } from './WinRateFigure'

const SECONDARY_SCOPES: Exclude<LeaderboardScope, 'model' | 'campHeadline' | 'method'>[] = [
  'camp',
  'tier',
  'brand',
  'category',
  'korea',
]

/**
 * Primary views always visible: US vs China, pure-reasoning vs research,
 * per-model ranking. Secondary comparisons sit behind a collapsible tab strip.
 */
export function LeaderboardBody({
  data,
  receipt,
  t,
}: {
  data: LeaderboardData
  receipt: ComplianceReceipt
  t: LeagueUiPack
}) {
  void receipt
  const [showMore, setShowMore] = useState(false)
  const [scope, setScope] = useState<(typeof SECONDARY_SCOPES)[number]>('camp')
  const secondary = data[scope]
  // Any unranked row means the reader is looking at a partially- or fully-unranked
  // board, and has to be told why rather than left to assume the order means something.
  const anyUnranked = data.model.rows.some((r) => r.rank === null) || secondary.rows.some((r) => r.rank === null)

  return (
    <>
      <div className="px-4 pt-4 pb-1">
        <h2 className="text-sm font-semibold text-league-fg">{t.leaderboard.title}</h2>
        <p className="text-[11px] text-league-fg-muted">{t.leaderboard.subtitle}</p>
      </div>

      <BeatingHeadline baselines={data.baselines} t={t} />
      <LeaderboardCampHeadline slice={data.campHeadline} t={t} />
      <MethodHeadline slice={data.method} t={t} />

      <LeaderboardTable slice={data.model.rows} t={t} labelFor={modelLabel} />
      <BaselineTable baselines={data.baselines} t={t} />

      <div className="px-4 pb-2 pt-3">
        <button
          type="button"
          onClick={() => setShowMore((v) => !v)}
          className="text-[11px] font-semibold text-league-accent-strong"
        >
          {showMore ? t.leaderboard.hideComparisons : t.leaderboard.moreComparisons}
        </button>
      </div>

      {showMore ? (
        <>
          <div className="flex gap-0.5 overflow-x-auto px-4 pb-2 text-[11px]">
            {SECONDARY_SCOPES.map((s) => (
              <ScopeTabButton
                key={s}
                active={scope === s}
                onClick={() => setScope(s)}
                label={t.leaderboard.tabs[tabLabelKey(s)]}
              />
            ))}
          </div>
          <LeaderboardTable slice={secondary.rows} t={t} labelFor={(row) => secondaryLabel(row, scope, t)} />
        </>
      ) : null}

      {/*
        Round-level accounting, always shown: the win rates above count graded
        rounds ONLY, so a reader has to be able to see how many rounds exist that
        no win rate reflects. Hiding the unresolvable count would make the record
        look tidier than it is.
      */}
      <p className="px-4 pt-1 text-[10px] text-league-fg-muted">
        {t.leaderboard.roundCoverage(data.roundCoverage.graded, data.roundCoverage.unresolvable)}
      </p>

      {anyUnranked ? (
        <p className="px-4 pb-3 pt-1 text-[10px] text-league-fg-muted">{t.winRate.rankingBegins(data.minSample)}</p>
      ) : null}
    </>
  )
}

function tabLabelKey(scope: (typeof SECONDARY_SCOPES)[number]): keyof LeagueUiPack['leaderboard']['tabs'] {
  return scope === 'camp' ? 'camp3' : scope
}

function modelLabel(row: LeaderboardRow): string {
  return row.label
}

function secondaryLabel(
  row: LeaderboardRow,
  scope: (typeof SECONDARY_SCOPES)[number],
  t: LeagueUiPack
): string {
  if (scope === 'camp') {
    if (row.key === 'us') return t.leaderboard.campLabels.us
    if (row.key === 'china') return t.leaderboard.campLabels.china
    if (row.key === 'other') return t.leaderboard.campLabels.other
  }
  return row.label
}

function MethodHeadline({ slice, t }: { slice: LeaderboardData['method']; t: LeagueUiPack }) {
  const reasoning = slice.rows.find((r) => r.key === 'pure_reasoning')
  const research = slice.rows.find((r) => r.key === 'research')
  if (!reasoning && !research) return null

  return (
    <div className="mx-4 mb-3 rounded-xl border border-league-border/40 bg-league-bg-elevated p-3">
      <p className="pb-2 text-center text-[10px] font-semibold uppercase tracking-wide text-league-fg-muted">
        {t.leaderboard.methodHeadline}
      </p>
      {/*
        No separate sample-size line here: `WinRateFigure` carries n inside the
        percentage string itself, so there is no layout in which the rate is
        visible and its sample size is not.
      */}
      <div className="grid grid-cols-2 gap-2">
        <div className="text-center">
          <p className="text-[11px] font-medium text-league-fg-muted">{t.leaderboard.methodLabels.pure_reasoning}</p>
          <WinRateFigure row={reasoning} t={t} size="hero" />
          {reasoning ? null : <p className="text-[10px] text-league-fg-muted">{t.leaderboard.emptyState}</p>}
        </div>
        <div className="text-center">
          <p className="text-[11px] font-medium text-league-fg-muted">{t.leaderboard.methodLabels.research}</p>
          <WinRateFigure row={research} t={t} size="hero" />
          {research ? null : <p className="text-[10px] text-league-fg-muted">{t.leaderboard.emptyState}</p>}
        </div>
      </div>
    </div>
  )
}

function ScopeTabButton({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`shrink-0 rounded-full px-3 py-1 font-semibold transition ${
        active ? 'bg-league-accent text-white' : 'bg-league-bg-elevated text-league-fg-muted'
      }`}
    >
      {label}
    </button>
  )
}

function BeatingHeadline({ baselines, t }: { baselines: BaselineSummary; t: LeagueUiPack }) {
  const line =
    baselines.alwaysUp.resolved > 0
      ? t.leaderboard.beatingAlwaysUp(baselines.modelsBeatingAlwaysUp, baselines.modelsCompared)
      : t.leaderboard.beatingAlwaysUpEmpty
  return (
    <div className="mx-4 mb-3 rounded-xl border border-league-border/40 bg-league-bg-elevated px-3 py-3">
      <p className="text-center text-sm font-semibold leading-snug text-league-fg">{line}</p>
    </div>
  )
}

function BaselineTable({ baselines, t }: { baselines: BaselineSummary; t: LeagueUiPack }) {
  return (
    <div className="mt-1 border-t border-league-border/30 bg-league-bg-elevated/50">
      <div className="px-4 pt-3 pb-1">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-league-fg-muted">
          {t.leaderboard.baselinesTitle}
        </p>
        <p className="pt-0.5 text-[10px] leading-snug text-league-fg-muted">{t.leaderboard.baselinesNote}</p>
      </div>
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-league-border/40 text-[10px] font-semibold uppercase tracking-wide text-league-fg-muted">
            <th className="px-4 py-1.5 text-left">{t.leaderboard.columns.rank}</th>
            <th className="py-1.5 text-left">{t.leaderboard.columns.name}</th>
            <th className="py-1.5 text-right">{t.leaderboard.columns.winRate}</th>
            <th className="px-4 py-1.5 text-right">{t.leaderboard.columns.record}</th>
          </tr>
        </thead>
        <tbody>
          <BaselineRowView row={baselines.alwaysUp} t={t} />
          <BaselineRowView row={baselines.coinFlip} t={t} />
        </tbody>
      </table>
    </div>
  )
}

function BaselineRowView({ row, t }: { row: BaselineRow; t: LeagueUiPack }) {
  const isMarker = row.role === 'marker'
  const name = row.key === 'always_up' ? t.leaderboard.alwaysUp : t.leaderboard.coinFlip
  const hint = row.key === 'always_up' ? t.leaderboard.alwaysUpHint : t.leaderboard.coinFlipHint
  return (
    <tr className="border-b border-league-border/20 last:border-b-0 text-league-fg-muted">
      <td className="px-4 py-2">
        <span className="inline-block rounded-full bg-league-bg-elevated px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide">
          {t.leaderboard.baselineBadge}
        </span>
      </td>
      <td className="max-w-[10rem] py-2">
        <span className="block truncate font-medium text-league-fg">{name}</span>
        <span className="block text-[10px] leading-snug">{hint}</span>
      </td>
      <td className="py-2 text-right">
        <WinRateFigure
          row={row}
          t={t}
          size="table"
          recordShownSeparately
          expectedPct={isMarker ? COIN_FLIP_EXPECTED_PCT : undefined}
        />
      </td>
      <td className="px-4 py-2 text-right">
        {isMarker ? (
          <span className="text-[10px]">{t.leaderboard.coinFlipRecord}</span>
        ) : (
          <WinRateRecord row={row} t={t} />
        )}
      </td>
    </tr>
  )
}

function LeaderboardTable({
  slice,
  t,
  labelFor,
}: {
  slice: LeaderboardRow[]
  t: LeagueUiPack
  labelFor: (row: LeaderboardRow) => string
}) {
  if (slice.length === 0) {
    return <p className="px-4 py-6 text-center text-xs text-league-fg-muted">{t.leaderboard.emptyState}</p>
  }

  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="border-b border-league-border/40 text-[10px] font-semibold uppercase tracking-wide text-league-fg-muted">
          <th className="px-4 py-1.5 text-left">{t.leaderboard.columns.rank}</th>
          <th className="py-1.5 text-left">{t.leaderboard.columns.name}</th>
          <th className="py-1.5 text-right">{t.leaderboard.columns.winRate}</th>
          <th className="px-4 py-1.5 text-right">{t.leaderboard.columns.record}</th>
        </tr>
      </thead>
      <tbody>
        {slice.map((row) => (
          <tr key={row.key} className="border-b border-league-border/20 last:border-b-0">
            {/*
              The rank comes from the data, never from the row's position: a
              below-threshold row has `rank === null` and shows a dash, so sitting
              at the top of the unranked block cannot read as "#1".
            */}
            <td className="px-4 py-2 text-league-fg-muted">{row.rank ?? '—'}</td>
            <td className="max-w-[8rem] truncate py-2 font-medium text-league-fg">{labelFor(row)}</td>
            <td className="py-2 text-right">
              <WinRateFigure row={row} t={t} size="table" recordShownSeparately />
            </td>
            <td className="px-4 py-2 text-right text-league-fg-muted">
              <WinRateRecord row={row} t={t} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
