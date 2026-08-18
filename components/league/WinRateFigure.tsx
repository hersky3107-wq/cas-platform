import type { LeaderboardRow } from '@/lib/league/leaderboard-aggregate'
import type { LeagueUiPack } from '@/lib/league/i18n/dictionary'

/**
 * Low-sample honesty: never a bold percentage without its n. When
 * provisional (n < 10) or empty, shrink/dim the rate and emphasize
 * "collecting data".
 */
export function WinRateFigure({
  row,
  t,
  size = 'table',
}: {
  row: LeaderboardRow | undefined
  t: LeagueUiPack
  size?: 'table' | 'hero'
}) {
  if (!row || row.winRatePct === null) {
    return <span className="text-league-fg-muted">{size === 'hero' ? '—' : '—'}</span>
  }

  if (row.provisional) {
    return (
      <span className={size === 'hero' ? 'block' : ''}>
        <span className="text-[10px] font-semibold uppercase tracking-wide text-league-fg-muted">
          {t.leaderboard.collectingData}
        </span>
        <span
          className={`ml-1 tabular-nums text-league-fg-muted ${size === 'hero' ? 'block text-base font-medium' : 'text-[11px]'}`}
        >
          {row.winRatePct}%
        </span>
      </span>
    )
  }

  return (
    <span className={`font-semibold tabular-nums text-league-fg ${size === 'hero' ? 'text-2xl font-bold' : ''}`}>
      {row.winRatePct}%
    </span>
  )
}
