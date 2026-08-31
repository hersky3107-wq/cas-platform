import type { ConsensusSummary } from '@/lib/league/card-types'
import type { LeagueUiPack } from '@/lib/league/i18n/dictionary'
import type { SideLabels } from '@/lib/league/side-labels'
import { buildConsensusHero, magnitudeCompareLine } from '@/lib/league/compliance'

/**
 * Two-line consensus hero — answer first (large), supporting figures demoted
 * (small/muted). Used on BOTH pending and graded cards via
 * `PendingVerdictPanel` and `VerdictPanel`.
 *
 * Line 1: the round's own answer phrase + optional magnitude qualifier —
 * "오른다 · 1일 내 +2.4%" on a price round, "맨유 승" / "3.4% 상회" on the
 * other contracts, all via `labels` (the round's `SideLabels`).
 * Line 2: roster tally + log-odds aggregate confidence only.
 * Graded only: optional predicted-vs-actual comparison sits directly under
 * line 2, visually grouped with the hero — never in a lower section.
 */
export function ConsensusHero({
  consensus,
  horizon,
  t,
  labels,
  magnitudeCompare = null,
}: {
  consensus: ConsensusSummary
  horizon: string
  t: LeagueUiPack
  /** The round's side-label resolver. Omitted only by legacy price-round callers. */
  labels?: SideLabels
  /** Round-level predicted (aggregate) vs actual magnitude — graded cards only. */
  magnitudeCompare?: { predictedPct: number; actualPct: number } | null
}) {
  const hero = buildConsensusHero(consensus, horizon, t, labels)
  if (!hero) return null

  if (hero.kind === 'fallback') {
    return <p className="mt-1.5 text-sm font-medium leading-snug text-league-fg-muted">{hero.message}</p>
  }

  return (
    <div className="mt-2">
      <p className="text-lg font-bold leading-snug text-league-fg md:text-xl">{hero.line1}</p>
      <p className="mt-0.5 text-[11px] font-medium leading-snug text-league-fg-muted">{hero.line2}</p>
      {magnitudeCompare ? (
        <p className="mt-1 text-[11px] font-medium text-league-fg-muted" dir="ltr">
          {magnitudeCompareLine(magnitudeCompare.predictedPct, magnitudeCompare.actualPct, t)}
        </p>
      ) : null}
    </div>
  )
}
