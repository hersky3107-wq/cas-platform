import { CAMP_LABEL } from '@/lib/league/card-types'
import type { LeaderboardRow, LeaderboardSlice } from '@/lib/league/leaderboard-aggregate'
import type { LeagueUiPack } from '@/lib/league/i18n/dictionary'

/**
 * The viral hook: US vs. China aggregate win rate, rendered prominently
 * above the detailed per-scope table. Purely a bigger presentation of two
 * rows already present in `data.camp` — no separate computation, so it can
 * never disagree with the Camp tab below it. 'other' is intentionally not
 * shown here (it isn't the headline comparison); it is still selectable via
 * the Camp tab.
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
        <CampStat row={us} label={CAMP_LABEL.us} t={t} />
        <CampStat row={china} label={CAMP_LABEL.china} t={t} />
      </div>
    </div>
  )
}

function CampStat({ row, label, t }: { row: LeaderboardRow | undefined; label: string; t: LeagueUiPack }) {
  return (
    <div className="text-center">
      <p className="text-[11px] font-medium text-league-fg-muted">{label}</p>
      <p className="text-2xl font-bold tabular-nums text-league-fg">
        {row && row.winRatePct !== null ? `${row.winRatePct}%` : '—'}
      </p>
      <p className="text-[10px] text-league-fg-muted">{row ? t.leaderboard.sampleCount(row.n) : t.leaderboard.emptyState}</p>
      {row?.provisional ? (
        <span className="mt-1 inline-block rounded-full bg-league-bg-elevated px-1.5 py-0.5 text-[9px] font-semibold text-league-fg-muted">
          {t.leaderboard.provisionalBadge}
        </span>
      ) : null}
    </div>
  )
}
