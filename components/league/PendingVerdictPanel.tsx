import type { CardRoundMeta, ConsensusSummary } from '@/lib/league/card-types'
import type { LeagueUiPack } from '@/lib/league/i18n/dictionary'
import type { LeagueLocale } from '@/lib/league/i18n/locales'
import type { SideLabels } from '@/lib/league/side-labels'
import { unresolvableReasonCopy } from '@/lib/league/card-status'
import { formatInstrumentPrice, formatRoundOpenedDate, formatSessionDate } from '@/lib/league/card-header-copy'
import { ConsensusHero } from '@/components/league/ConsensusHero'

/**
 * Shown INSTEAD OF `VerdictPanel` while a round has zero graded predictions
 * (`hitRecord.graded <= 0` — see `VerdictPanel`'s own bail-out, which this
 * component does not touch). A 1-day round only sits here for hours, but a
 * 1-month or 3-month round sits here for WEEKS, so this can never be an
 * empty panel: it names the proposition, the anchor, and exactly when the
 * round grades, so the card stays worth reading before a single model call
 * has been scored.
 *
 * UNRESOLVABLE rounds land here too (they never grade, so graded stays 0).
 * For those, the "grades on {date}" promise is a lie — the panel instead
 * explains ITSELF: the no-result heading, the kind-aware plain-language
 * reason (`unresolvableReasonCopy`), and the no-winner note. That is the fix
 * for the round-65192045 card that said nothing.
 *
 * When `consensus` is supplied, renders the two-line hero (answer + magnitude,
 * then supporting tally + aggregate confidence) — same component as graded
 * cards use, minus the post-grading comparison and hit record.
 */
export function PendingVerdictPanel({
  round,
  t,
  locale,
  labels,
  consensus = null,
  now = new Date(),
}: {
  round: CardRoundMeta
  t: LeagueUiPack
  locale: LeagueLocale
  /** The round's side-label resolver. Omitted only by legacy price-round callers. */
  labels?: SideLabels
  consensus?: ConsensusSummary | null
  now?: Date
}) {
  const anchorDate = round.anchorSessionDate
    ? formatSessionDate(round.anchorSessionDate, locale)
    : round.anchorPriceAt
      ? formatRoundOpenedDate(round.anchorPriceAt, locale)
      : null
  const resolvesDate = formatRoundOpenedDate(round.resolves_at, locale)
  const daysRemaining = Math.max(0, Math.ceil((Date.parse(round.resolves_at) - now.getTime()) / 86_400_000))
  const unresolvable = round.gradingState === 'unresolvable'

  return (
    <div className="mx-2 mb-3 mt-1 rounded-xl border border-league-border bg-league-bg-elevated px-4 py-4 md:mx-3 md:px-5 md:py-5">
      <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-league-fg-muted">
        {unresolvable ? t.grading.unresolvable : t.verdict.pendingHeading}
      </p>
      <p className="mt-1.5 text-sm font-semibold leading-snug text-league-fg md:text-base">
        {round.proposition_text}
      </p>
      {consensus && consensus.totalModels > 0 ? (
        <ConsensusHero consensus={consensus} horizon={round.horizon} t={t} labels={labels} />
      ) : null}
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
          {t.verdict.pendingResolvesLine(resolvesDate)} {'\u00b7'} {t.verdict.pendingDaysRemaining(daysRemaining)}
        </p>
      )}
    </div>
  )
}
