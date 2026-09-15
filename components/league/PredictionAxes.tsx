import type { BookSplit, CampSplit, DirectionTally, TierSplit, WeightsSplit } from '@/lib/league/card-types'
import { CAMPS, LEAGUE_TIERS } from '@/lib/league/card-types'
import type { LeagueUiPack } from '@/lib/league/i18n/dictionary'
import type { SideLabels } from '@/lib/league/side-labels'
import { predictionAxisLine } from '@/lib/league/compliance'
import { DetailsDisclosure } from './DetailsDisclosure'

/**
 * Pre-grading breakdown of every axis using PREDICTION counts.
 *
 * Shared chrome: every chip, every category. Graded cards keep VerdictPanel
 * (hit counts with ✓ + total). This panel must never look like that panel —
 * no ✓, no slash-over-total, heading says predictions not hits.
 *
 * Collapsed behind "자세히 보기" by default — these rows are for enthusiasts.
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
  rows: { key: string; label: string; tally: DirectionTally }[]
  t: LeagueUiPack
  labels: SideLabels
}) {
  const shown = rows.filter((row) => modelCount(row.tally) > 0)
  if (shown.length === 0) return null
  return (
    <div className="mt-3 first:mt-0">
      <p className="text-[10px] font-bold uppercase tracking-wide text-league-fg-muted">{title}</p>
      <ul className="mt-1 space-y-0.5">
        {shown.map((row) => (
          <li key={row.key} className="text-[12px] leading-snug text-league-fg">
            {predictionAxisLine(row.label, row.tally, t, labels)}
          </li>
        ))}
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
      <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-league-fg-muted">{t.predictions.heading}</p>
      <AxisBlock
        title={t.verdict.sectionCamp}
        rows={CAMPS.map((key) => ({ key, label: t.verdict.campLabels[key], tally: campSplit[key] }))}
        t={t}
        labels={labels}
      />
      <AxisBlock
        title={t.verdict.sectionTier}
        rows={LEAGUE_TIERS.map((key) => ({ key, label: t.verdict.tierLabels[key], tally: tierSplit[key] }))}
        t={t}
        labels={labels}
      />
      <AxisBlock
        title={t.verdict.sectionBook}
        rows={[
          { key: 'closed', label: t.verdict.bookLabels.closed, tally: bookSplit.closed },
          { key: 'scout', label: t.verdict.bookLabels.scout, tally: bookSplit.scout },
        ]}
        t={t}
        labels={labels}
      />
      <AxisBlock
        title={t.verdict.sectionWeights}
        rows={[
          { key: 'closed', label: t.verdict.weightLabels.closed, tally: weightsSplit.closed },
          { key: 'open', label: t.verdict.weightLabels.open, tally: weightsSplit.open },
        ]}
        t={t}
        labels={labels}
      />
    </DetailsDisclosure>
  )
}
