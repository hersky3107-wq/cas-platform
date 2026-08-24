import type { CardRoundMeta } from '@/lib/league/card-types'
import type { LeagueUiPack } from '@/lib/league/i18n/dictionary'
import type { LeagueLocale } from '@/lib/league/i18n/locales'
import { formatInstrumentPrice, formatRoundOpenedDate, formatSessionDate } from '@/lib/league/card-header-copy'

/**
 * Shown INSTEAD OF `VerdictPanel` while a round has zero graded predictions
 * (`hitRecord.graded <= 0` — see `VerdictPanel`'s own bail-out, which this
 * component does not touch). A 1-day round only sits here for hours, but a
 * 1-month or 3-month round sits here for WEEKS, so this can never be an
 * empty panel: it names the proposition, the anchor, and exactly when the
 * round grades, so the card stays worth reading before a single model call
 * has been scored.
 *
 * Does not read or duplicate any grading-engine logic, glyph rule, or the
 * correlation notice — presentation only, over fields `CardRoundMeta`
 * already carries (`proposition_text`, `anchorPrice`, `anchorSessionDate` /
 * `anchorPriceAt`, `resolves_at`). NEVER renders a hit figure or a
 * percentage — those belong to `VerdictPanel`, which only renders once
 * `graded > 0`; this component is the ungraded branch and has no access to
 * `hitRecord` at all (only `round`, `t`, `locale`, `now` are accepted).
 */
export function PendingVerdictPanel({
  round,
  t,
  locale,
  now = new Date(),
}: {
  round: CardRoundMeta
  t: LeagueUiPack
  locale: LeagueLocale
  /** Injectable for deterministic rendering/tests; defaults to the real clock. */
  now?: Date
}) {
  const anchorDate = round.anchorSessionDate
    ? formatSessionDate(round.anchorSessionDate, locale)
    : round.anchorPriceAt
      ? formatRoundOpenedDate(round.anchorPriceAt, locale)
      : null
  const resolvesDate = formatRoundOpenedDate(round.resolves_at, locale)
  const daysRemaining = Math.max(0, Math.ceil((Date.parse(round.resolves_at) - now.getTime()) / 86_400_000))

  return (
    <div className="mx-2 mb-3 mt-1 rounded-xl border border-league-border bg-league-bg-elevated px-4 py-4 md:mx-3 md:px-5 md:py-5">
      <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-league-fg-muted">
        {t.verdict.pendingHeading}
      </p>
      <p className="mt-1.5 text-sm font-semibold leading-snug text-league-fg md:text-base">
        {round.proposition_text}
      </p>
      {round.anchorPrice !== null && anchorDate ? (
        <p className="mt-2 text-[12px] text-league-fg-muted" dir="ltr">
          {t.verdict.pendingAnchorLine(formatInstrumentPrice(round.instrument, round.anchorPrice), anchorDate)}
        </p>
      ) : null}
      <p className="mt-1 text-[12px] text-league-fg-muted" dir="ltr">
        {t.verdict.pendingResolvesLine(resolvesDate)} {'\u00b7'} {t.verdict.pendingDaysRemaining(daysRemaining)}
      </p>
    </div>
  )
}
