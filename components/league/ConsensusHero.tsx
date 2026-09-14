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
 * other contracts. When the head count and the weighted call disagree, line 1
 * is prefixed ("Weighted call:" / "가중 결론:") and a one-sentence help
 * sits next to that prefix. Do not name the statistical method.
 * Line 2: both sides + aggregate confidence (or the divergent sentence).
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

  const prefix = t.hero.weightedCallPrefix
  const remainder =
    hero.diverged && hero.line1.startsWith(prefix) ? hero.line1.slice(prefix.length) : hero.line1

  return (
    <div className="mt-2">
      <div className="text-lg font-bold leading-snug text-league-fg md:text-xl">
        {hero.diverged ? (
          <>
            <span>{prefix.trimEnd()}</span>
            <details className="relative ml-1 inline-block align-middle">
              <summary
                className="cursor-help list-none text-[11px] font-semibold text-league-fg-muted underline decoration-dotted [&::-webkit-details-marker]:hidden"
                title={t.hero.weightedCallHelp}
              >
                ?
              </summary>
              <div className="absolute left-0 z-10 mt-1 w-64 rounded-md border border-league-border bg-white px-2 py-1.5 text-[11px] font-medium leading-snug text-league-fg-muted shadow-sm">
                {t.hero.weightedCallHelp}
              </div>
            </details>{' '}
            {remainder}
          </>
        ) : (
          hero.line1
        )}
      </div>
      <p className="mt-0.5 text-[11px] font-medium leading-snug text-league-fg-muted">{hero.line2}</p>
      {magnitudeCompare ? (
        <p className="mt-1 text-[11px] font-medium text-league-fg-muted" dir="ltr">
          {magnitudeCompareLine(magnitudeCompare.predictedPct, magnitudeCompare.actualPct, t)}
        </p>
      ) : null}
    </div>
  )
}
