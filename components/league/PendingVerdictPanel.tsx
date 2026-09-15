import type { BookSplit, CampSplit, CardRoundMeta, ConsensusSummary, TierSplit, WeightsSplit } from '@/lib/league/card-types'
import type { LeagueUiPack } from '@/lib/league/i18n/dictionary'
import type { LeagueLocale } from '@/lib/league/i18n/locales'
import type { SideLabels } from '@/lib/league/side-labels'
import { unresolvableReasonCopy } from '@/lib/league/card-status'
import { formatInstrumentPrice, formatRoundOpenedDate, formatSessionDate } from '@/lib/league/card-header-copy'
import { ConsensusHero } from '@/components/league/ConsensusHero'
import { PredictionAxes } from '@/components/league/PredictionAxes'

/**
 * Shown INSTEAD OF `VerdictPanel` while a round has zero graded predictions.
 *
 * Hierarchy: pending kicker (plain language) → glanceable hero (the answer)
 * → proposition/anchor as supporting notes → enthusiast breakdowns behind
 * a collapsed "자세히 보기" toggle.
 */
export function PendingVerdictPanel({
  round,
  t,
  locale,
  labels,
  consensus = null,
  campSplit = null,
  tierSplit = null,
  bookSplit = null,
  weightsSplit = null,
  now = new Date(),
  seatComplete = true,
  answered,
}: {
  round: CardRoundMeta
  t: LeagueUiPack
  locale: LeagueLocale
  /** The round's side-label resolver. Omitted only by legacy price-round callers. */
  labels?: SideLabels
  consensus?: ConsensusSummary | null
  campSplit?: CampSplit | null
  tierSplit?: TierSplit | null
  bookSplit?: BookSplit | null
  weightsSplit?: WeightsSplit | null
  now?: Date
  /** Seat-resolution flag. False while generation is still filling seats. */
  seatComplete?: boolean
  answered?: number
}) {
  const anchorDate = round.anchorSessionDate
    ? formatSessionDate(round.anchorSessionDate, locale)
    : round.anchorPriceAt
      ? formatRoundOpenedDate(round.anchorPriceAt, locale)
      : null
  const resolvesDate = formatRoundOpenedDate(round.resolves_at, locale)
  const daysRemaining = Math.max(0, Math.ceil((Date.parse(round.resolves_at) - now.getTime()) / 86_400_000))
  const unresolvable = round.gradingState === 'unresolvable'
  const hasHero = Boolean(consensus && consensus.totalModels > 0)

  return (
    <div className="mx-2 mb-3 mt-1 rounded-xl border border-league-border bg-league-bg-elevated px-4 py-4 md:mx-3 md:px-5 md:py-5">
      {unresolvable ? (
        <p className="text-[11px] font-semibold leading-snug text-league-fg-muted">{t.grading.unresolvable}</p>
      ) : (
        <p className="text-[13px] font-semibold leading-snug text-league-fg md:text-sm">
          {t.verdict.pendingHeadline(resolvesDate)}
        </p>
      )}
      {hasHero && consensus ? (
        <ConsensusHero
          consensus={consensus}
          horizon={round.horizon}
          t={t}
          labels={labels}
          seatComplete={seatComplete}
          answered={answered}
        />
      ) : null}
      <p
        className={
          hasHero
            ? 'mt-3 text-[12px] leading-snug text-league-fg-muted'
            : 'mt-1.5 text-sm font-semibold leading-snug text-league-fg md:text-base'
        }
      >
        {round.proposition_text}
      </p>
      {round.anchorPrice !== null && anchorDate ? (
        <p className="mt-2 text-[12px] text-league-fg-muted" dir="ltr">
          {t.verdict.pendingAnchorLine(formatInstrumentPrice(round.instrument, round.anchorPrice), anchorDate)}
        </p>
      ) : null}
      {unresolvable ? (
        <>
          <p className="mt-2 text-[12px] leading-snug text-league-fg">
            {unresolvableReasonCopy(round.unresolvableReason, t, round.proposition_kind)}
          </p>
          <p className="mt-1 text-[11px] leading-snug text-league-fg-muted">{t.grading.unresolvableNote}</p>
        </>
      ) : (
        <p className="mt-1 text-[12px] text-league-fg-muted" dir="ltr">
          {t.verdict.pendingDaysRemaining(daysRemaining)}
        </p>
      )}
      {labels && campSplit && tierSplit && bookSplit && weightsSplit ? (
        <PredictionAxes
          campSplit={campSplit}
          tierSplit={tierSplit}
          bookSplit={bookSplit}
          weightsSplit={weightsSplit}
          t={t}
          labels={labels}
          inProgress={!seatComplete}
        />
      ) : null}
    </div>
  )
}
