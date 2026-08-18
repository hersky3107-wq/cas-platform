import type { LeaderboardRow, LeaderboardSlice } from '@/lib/league/leaderboard-aggregate'
import type { LeagueUiPack } from '@/lib/league/i18n/dictionary'
import { WinRateFigure } from './WinRateFigure'

/**
 * The viral hook: US vs. China aggregate win rate, rendered prominently
 * above the detailed tables. Purely a bigger presentation of two rows
 * already present in `data.campHeadline` — no separate computation.
 */
export function LeaderboardCampHeadline({ slice, t }: { slice: LeaderboardSlice; t: LeagueUiPack }) {
  const us = slice.rows.find((r) => r.key === 'us')
  const china = slice.rows.find((r) => r.key === 'china')
  if (!us && !china) return null

  return (
    <div className="mx-4 mb-3 rounded-xl bg-league-accent-soft p-3">
      <p className="pb-2 text-center text-[10px] font-semibold uppercase tracking-wide text-league-fg-muted">
        {t.leaderboard.campHeadline}
      </p>
      <div className="grid grid-cols-2 gap-2">
        <CampStat row={us} label={t.leaderboard.campLabels.us} t={t} />
        <CampStat row={china} label={t.leaderboard.campLabels.china} t={t} />
      </div>
    </div>
  )
}

function CampStat({ row, label, t }: { row: LeaderboardRow | undefined; label: string; t: LeagueUiPack }) {
  return (
    <div className="text-center">
      <p className="text-[11px] font-medium text-league-fg-muted">{label}</p>
      <div className="mt-0.5">
        <WinRateFigure row={row} t={t} size="hero" />
      </div>
      <p className="text-[10px] text-league-fg-muted">{row ? t.leaderboard.sampleCount(row.n) : t.leaderboard.emptyState}</p>
    </div>
  )
}
