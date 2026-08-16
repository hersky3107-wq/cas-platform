'use client'

import { useState } from 'react'
import type { LeaderboardData, LeaderboardRow, LeaderboardScope } from '@/lib/league/leaderboard-aggregate'
import type { LeagueUiPack } from '@/lib/league/i18n/dictionary'
import type { ComplianceReceipt } from './CardCompliance'
import { LeaderboardCampHeadline } from './LeaderboardCampHeadline'

const SCOPES: LeaderboardScope[] = ['camp', 'model', 'tier', 'category']

/**
 * The actual leaderboard content (title, camp headline, scope tabs, table).
 * Do NOT render this outside `<CardCompliance>` — see `CardBody.tsx` for why
 * `receipt` is typed the way it is; this component follows the exact same
 * pattern so the leaderboard can never render without its disclaimer either.
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
  const [scope, setScope] = useState<LeaderboardScope>('camp')
  const slice = data[scope]
  const anyProvisional = slice.rows.some((r) => r.provisional)

  return (
    <>
      <div className="px-4 pt-4 pb-1">
        <h2 className="text-sm font-semibold text-league-fg">{t.leaderboard.title}</h2>
        <p className="text-[11px] text-league-fg-muted">{t.leaderboard.subtitle}</p>
      </div>

      <LeaderboardCampHeadline slice={data.camp} t={t} />

      <div className="flex gap-0.5 overflow-x-auto px-4 pb-2 text-[11px]">
        {SCOPES.map((s) => (
          <ScopeTabButton key={s} active={scope === s} onClick={() => setScope(s)} label={t.leaderboard.tabs[tabLabelKey(s)]} />
        ))}
      </div>

      <LeaderboardTable slice={slice.rows} t={t} />

      {anyProvisional ? <p className="px-4 pb-3 pt-1 text-[10px] text-league-fg-muted">{t.leaderboard.provisionalNote}</p> : null}
    </>
  )
}

function tabLabelKey(scope: LeaderboardScope): keyof LeagueUiPack['leaderboard']['tabs'] {
  return scope
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

function LeaderboardTable({ slice, t }: { slice: LeaderboardRow[]; t: LeagueUiPack }) {
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
          <th className="px-4 py-1.5 text-right">{t.leaderboard.columns.sample}</th>
        </tr>
      </thead>
      <tbody>
        {slice.map((row, i) => (
          <tr key={row.key} className="border-b border-league-border/20 last:border-b-0">
            <td className="px-4 py-2 text-league-fg-muted">{i + 1}</td>
            <td className="max-w-[8rem] truncate py-2 font-medium text-league-fg">{row.label}</td>
            <td className="py-2 text-right font-semibold tabular-nums text-league-fg">
              {row.winRatePct !== null ? `${row.winRatePct}%` : '—'}
            </td>
            <td className="px-4 py-2 text-right text-league-fg-muted">
              <span className="tabular-nums">{t.leaderboard.sampleCount(row.n)}</span>
              {row.provisional ? (
                <span className="ml-1 inline-block rounded-full bg-league-bg-elevated px-1 py-0.5 text-[9px] font-semibold">
                  {t.leaderboard.provisionalBadge}
                </span>
              ) : null}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
