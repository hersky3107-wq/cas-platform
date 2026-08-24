import type { CardData } from '@/lib/league/card-types'
import type { LeagueUiPack } from '@/lib/league/i18n/dictionary'
import type { LeagueLocale } from '@/lib/league/i18n/locales'
import { toneFor } from '@/lib/league/tone'
import type { ComplianceReceipt } from './CardCompliance'
import { CardHeader } from './CardHeader'
import { DivisionBoard } from './DivisionBoard'
import { VerdictPanel } from './VerdictPanel'
import { PendingVerdictPanel } from './PendingVerdictPanel'

/**
 * The actual prediction content (header, division board, final verdict).
 *
 * Do NOT render this outside `<CardCompliance>`. That is not just a
 * convention: `receipt` is typed as `ComplianceReceipt`, whose brand symbol
 * is private to `CardCompliance.tsx`, so no caller outside that file can
 * construct a valid one — see the comment block there for the full
 * explanation. `receipt` carries no runtime information; it exists purely to
 * make that guarantee visible in this component's signature.
 *
 * `t` (Layer A chrome pack) only affects labels/templates rendered below —
 * `data` (predictions) is passed through unchanged regardless of locale.
 */
export function CardBody({
  data,
  receipt,
  t,
  locale,
  gradingStalled = false,
  translations = null,
  showOriginal = false,
  onToggleOriginal,
}: {
  data: CardData
  receipt: ComplianceReceipt
  t: LeagueUiPack
  locale: LeagueLocale
  gradingStalled?: boolean
  translations?: Record<string, string> | null
  showOriginal?: boolean
  onToggleOriginal?: () => void
}) {
  void receipt
  const tone = toneFor(data.round.color_bucket)
  const hasTranslation = Boolean(translations && Object.keys(translations).length > 0)
  return (
    <>
      <CardHeader
        round={data.round}
        hitRate={data.hitRate}
        tone={tone}
        t={t}
        locale={locale}
        gradingStalled={gradingStalled}
      />
      {hasTranslation && onToggleOriginal ? (
        <div className="px-4 pb-1">
          <button
            type="button"
            onClick={onToggleOriginal}
            className="text-[11px] font-semibold text-league-accent-strong underline-offset-2 hover:underline"
          >
            {showOriginal ? t.modelTile.hideOriginal : t.modelTile.showOriginal}
          </button>
        </div>
      ) : null}
      <DivisionBoard
        models={data.models}
        tierSplit={data.tierSplit}
        t={t}
        roundGraded={data.round.gradingState === 'graded'}
        translations={translations}
        showOriginal={showOriginal}
      />
      {data.hitRate.graded > 0 ? (
        <p className="border-t border-league-border/50 px-3 py-2 text-[10px] leading-snug text-league-fg-muted md:px-4">
          {t.bracket.resultLegend}
        </p>
      ) : null}
      {data.verdict.hitRecord.graded > 0 ? (
        <VerdictPanel verdict={data.verdict} models={data.models} t={t} />
      ) : (
        <PendingVerdictPanel round={data.round} t={t} locale={locale} />
      )}
    </>
  )
}
