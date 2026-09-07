import { formatRoundOpenedDate } from '@/lib/league/card-header-copy'
import type { LeagueUiPack } from '@/lib/league/i18n/dictionary'
import type { LeagueLocale } from '@/lib/league/i18n/locales'

/**
 * Public card chrome for an operator-graded round. Renders nothing when
 * there is no evidence row, so price-round markup stays byte-identical.
 * Never shows the observed fact.
 */
export function OperatorEvidenceNote({
  evidence,
  t,
  locale,
}: {
  evidence: { sourceUrl: string; gradedAt: string } | null
  t: LeagueUiPack
  locale: LeagueLocale
}) {
  if (!evidence) return null
  const date = formatRoundOpenedDate(evidence.gradedAt, locale)
  return (
    <p className="px-4 pb-2 text-[11px] leading-snug text-league-fg-muted">
      <span className="font-semibold text-league-fg">{t.operatorGrade.verifiedLabel}</span>
      <span className="mx-1.5">·</span>
      <a
        href={evidence.sourceUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="font-semibold text-league-accent-strong underline-offset-2 hover:underline"
      >
        {t.operatorGrade.sourceLinkLabel}
      </a>
      <span className="mx-1.5">·</span>
      {t.operatorGrade.gradedOn(date)}
    </p>
  )
}
