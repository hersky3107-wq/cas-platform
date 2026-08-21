import type { LeagueUiPack } from '@/lib/league/i18n/dictionary'
import { formatWinRatePct, isDisplayableWinRate, winRateDisplay, winRateLabel } from '@/lib/league/win-rate'

/** Everything this component needs: the raw counts. It derives the figure itself. */
export type WinRateSampleRow = { correct: number; resolved: number }

/**
 * The ONLY component that renders an accuracy figure. It renders whatever
 * `lib/league/win-rate.ts` allows and nothing else:
 *
 *  - at or above the minimum sample: "62% (n=34)" as ONE string, so the sample
 *    size cannot be styled down, moved into a footnote, or dropped — it always
 *    carries the same weight as the percentage;
 *  - below it: the raw record ("1W 0L, sample too small") — no percentage at any
 *    size or opacity, because a dimmed "100%" is still a "100%" claim;
 *  - nothing graded: an explicit "no graded rounds yet".
 *
 * Percentages arrive pre-truncated; this component never formats a number.
 */
export function WinRateFigure({
  row,
  t,
  size = 'table',
  recordShownSeparately = false,
  expectedPct,
}: {
  row: WinRateSampleRow | undefined
  t: LeagueUiPack
  size?: 'table' | 'hero'
  /** True in layouts with their own record column — then only the low-sample note is shown here. */
  recordShownSeparately?: boolean
  /**
   * A reference LINE (coin flip), not a scored record. When set, the figure
   * is this expected rate with n — never computed from wins/losses, and still
   * hidden below the minimum sample.
   */
  expectedPct?: number
}) {
  if (!row) return <span className="text-league-fg-muted">—</span>

  if (expectedPct !== undefined) {
    if (!isDisplayableWinRate(row.resolved)) {
      const label = row.resolved <= 0 ? t.winRate.noRounds : t.winRate.insufficientNote
      return (
        <span className={`tabular-nums text-league-fg-muted ${size === 'hero' ? 'text-sm font-medium' : 'text-[11px]'}`}>
          {label}
        </span>
      )
    }
    return (
      <span
        className={`font-semibold tabular-nums text-league-fg ${size === 'hero' ? 'text-xl font-bold md:text-2xl' : ''}`}
      >
        {t.winRate.withSample(formatWinRatePct(expectedPct), row.resolved)}
      </span>
    )
  }

  const display = winRateDisplay(row.correct, row.resolved)

  if (display.kind === 'rate') {
    return (
      <span
        className={`font-semibold tabular-nums text-league-fg ${size === 'hero' ? 'text-xl font-bold md:text-2xl' : ''}`}
      >
        {winRateLabel(display, t)}
      </span>
    )
  }

  const label =
    display.kind === 'insufficient' && recordShownSeparately ? t.winRate.insufficientNote : winRateLabel(display, t)

  return (
    <span className={`tabular-nums text-league-fg-muted ${size === 'hero' ? 'text-sm font-medium' : 'text-[11px]'}`}>
      {label}
    </span>
  )
}

/** The raw record ("34W 12L"), for layouts that show it next to the rate. */
export function WinRateRecord({ row, t }: { row: WinRateSampleRow | undefined; t: LeagueUiPack }) {
  if (!row || row.resolved <= 0) return <span className="text-league-fg-muted">—</span>
  return (
    <span className="tabular-nums">{t.winRate.record(row.correct, Math.max(0, row.resolved - row.correct))}</span>
  )
}
