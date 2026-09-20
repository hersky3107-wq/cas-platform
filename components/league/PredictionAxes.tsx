import type { BookSplit, CampSplit, DirectionTally, TierSplit, WeightsSplit } from '@/lib/league/card-types'
import { CAMPS, LEAGUE_TIERS } from '@/lib/league/card-types'
import {
  BOOK_ACCENT,
  CAMP_ACCENT,
  SIDE_DOWN_CLASS,
  SIDE_MUTED_CLASS,
  SIDE_UP_CLASS,
  TIER_ACCENT,
  WEIGHT_ACCENT,
} from '@/lib/league/breakdown-display'
import type { LeagueUiPack } from '@/lib/league/i18n/dictionary'
import type { SideLabels } from '@/lib/league/side-labels'
import { DetailsDisclosure } from './DetailsDisclosure'

/**
 * Pre-grading breakdown of every axis using PREDICTION counts.
 *
 * Shared chrome: every chip, every category. Graded cards keep VerdictPanel
 * (hit counts with ✓ + total). This panel must never look like that panel —
 * no ✓, no slash-over-total, heading says predictions not hits.
 *
 * Collapsed behind "자세히 보기" by default — these rows are for enthusiasts.
 * Numbers come from server tallies; this file only styles them.
 */

function modelCount(tally: DirectionTally): number {
  return tally.up + tally.down + tally.flat + tally.abstain
}

function AxisBlock({
  title,
  rows,
  t,
  labels,
}: {
  title: string
  rows: { key: string; label: string; tally: DirectionTally; accent: string }[]
  t: LeagueUiPack
  labels: SideLabels
}) {
  const shown = rows.filter((row) => modelCount(row.tally) > 0)
  if (shown.length === 0) return null
  const upWord = labels.tallyWord(labels.sides[0])
  const downWord = labels.tallyWord(labels.sides[1])
  const flatWord = labels.tallyWord('flat')
  const noneWord = labels.tallyWord(null)
  return (
    <div className="mt-4 first:mt-0">
      <p className="text-[13px] font-bold tracking-wide text-league-fg md:text-sm">{title}</p>
      <ul className="mt-2 space-y-2">
        {shown.map((row) => {
          const n = modelCount(row.tally)
          return (
            <li
              key={row.key}
              className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-lg bg-white/70 px-2.5 py-2 ring-1 ring-league-border/40"
            >
              <span className="inline-flex min-w-0 items-center gap-2">
                <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${row.accent}`} aria-hidden />
                <span className="truncate text-[14px] font-semibold text-league-fg">{row.label}</span>
                <span className="shrink-0 text-[12px] font-medium text-league-fg-muted">{n}</span>
              </span>
              <span className="inline-flex flex-wrap items-center gap-x-2.5 text-[14px] font-semibold tabular-nums">
                {row.tally.up > 0 ? (
                  <span className={SIDE_UP_CLASS}>
                    {t.predictions.axisPart(row.tally.up, upWord)}
                  </span>
                ) : null}
                {row.tally.down > 0 ? (
                  <span className={SIDE_DOWN_CLASS}>
                    {t.predictions.axisPart(row.tally.down, downWord)}
                  </span>
                ) : null}
                {row.tally.flat > 0 ? (
                  <span className={SIDE_MUTED_CLASS}>
                    {t.predictions.axisPart(row.tally.flat, flatWord)}
                  </span>
                ) : null}
                {row.tally.abstain > 0 ? (
                  <span className={SIDE_MUTED_CLASS}>
                    {t.predictions.axisPart(row.tally.abstain, noneWord)}
                  </span>
                ) : null}
                {row.tally.up + row.tally.down + row.tally.flat + row.tally.abstain === 0 ? (
                  <span className={SIDE_MUTED_CLASS}>{t.predictions.noCalls}</span>
                ) : null}
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

export function PredictionAxes({
  campSplit,
  tierSplit,
  bookSplit,
  weightsSplit,
  t,
  labels,
  inProgress = false,
}: {
  campSplit: CampSplit
  tierSplit: TierSplit
  bookSplit: BookSplit
  weightsSplit: WeightsSplit
  t: LeagueUiPack
  labels: SideLabels
  inProgress?: boolean
}) {
  return (
    <DetailsDisclosure t={t} inProgress={inProgress}>
      <p className="text-[13px] font-bold tracking-wide text-league-fg md:text-sm">{t.predictions.heading}</p>
      <AxisBlock
        title={t.verdict.sectionCamp}
        rows={CAMPS.map((key) => ({
          key,
          label: t.verdict.campLabels[key],
          tally: campSplit[key],
          accent: CAMP_ACCENT[key],
        }))}
        t={t}
        labels={labels}
      />
      <AxisBlock
        title={t.verdict.sectionTier}
        rows={LEAGUE_TIERS.map((key) => ({
          key,
          label: t.verdict.tierLabels[key],
          tally: tierSplit[key],
          accent: TIER_ACCENT[key],
        }))}
        t={t}
        labels={labels}
      />
      <AxisBlock
        title={t.verdict.sectionBook}
        rows={[
          { key: 'closed', label: t.verdict.bookLabels.closed, tally: bookSplit.closed, accent: BOOK_ACCENT.closed },
          { key: 'scout', label: t.verdict.bookLabels.scout, tally: bookSplit.scout, accent: BOOK_ACCENT.scout },
        ]}
        t={t}
        labels={labels}
      />
      <AxisBlock
        title={t.verdict.sectionWeights}
        rows={[
          { key: 'closed', label: t.verdict.weightLabels.closed, tally: weightsSplit.closed, accent: WEIGHT_ACCENT.closed },
          { key: 'open', label: t.verdict.weightLabels.open, tally: weightsSplit.open, accent: WEIGHT_ACCENT.open },
        ]}
        t={t}
        labels={labels}
      />
    </DetailsDisclosure>
  )
}
