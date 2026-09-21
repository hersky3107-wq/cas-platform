import type { CardData } from '@/lib/league/card-types'
import { getProgressRosterIds } from '@/lib/league/roster'
import { revealConsensusConclusion } from '@/lib/league/generation-progress'
import type { LeagueUiPack } from '@/lib/league/i18n/dictionary'
import type { LeagueLocale } from '@/lib/league/i18n/locales'
import { sideLabelsFor } from '@/lib/league/side-labels'
import { toneFor } from '@/lib/league/tone'
import type { ComplianceReceipt } from './CardCompliance'
import { CardHeader } from './CardHeader'
import { OperatorEvidenceNote } from './OperatorEvidenceNote'
import { DivisionBoard } from './DivisionBoard'
import { GenerationProgressStrip } from './GenerationProgressStrip'
import { VerdictPanel } from './VerdictPanel'
import { PendingVerdictPanel } from './PendingVerdictPanel'
import { ExtraCompare } from './ExtraCompare'

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
  rationaleInFlight = false,
  showOriginal = false,
  onToggleOriginal,
  streaming = false,
  droppedModelIds = [],
  liveProgress = null,
}: {
  data: CardData
  receipt: ComplianceReceipt
  t: LeagueUiPack
  locale: LeagueLocale
  gradingStalled?: boolean
  translations?: Record<string, string> | null
  rationaleInFlight?: boolean
  showOriginal?: boolean
  onToggleOriginal?: () => void
  /** Live generation: four tier shells fill concurrently. */
  streaming?: boolean
  droppedModelIds?: readonly string[]
  liveProgress?: { answered: number; rosterSize: number; complete: boolean } | null
}) {
  void receipt
  const tone = toneFor(data.round.color_bucket)
  const hasTranslation = Boolean(translations && Object.keys(translations).length > 0)
  // ONE resolver per card: every side word/glyph below (tiles, tallies,
  // verdict, hero) derives from this round's (kind, subject_label, category).
  const labels = sideLabelsFor(data.round, t)
  const generating =
    streaming || data.generation?.status === 'queued' || data.generation?.status === 'running'
  const seatComplete = revealConsensusConclusion(
    data.generation?.complete ?? liveProgress?.complete,
    generating,
  )
  const answered = data.generation?.answered ?? liveProgress?.answered
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
      <OperatorEvidenceNote evidence={data.round.operatorEvidence} t={t} locale={locale} />
      {streaming || data.generation?.status === 'queued' || data.generation?.status === 'running' ? (
        <GenerationProgressStrip
          queued={(data.generation?.status ?? (streaming ? 'running' : null)) === 'queued'}
          answered={data.generation?.answered ?? liveProgress?.answered ?? 0}
          rosterSize={data.generation?.rosterSize ?? liveProgress?.rosterSize ?? getProgressRosterIds().length}
          complete={data.generation?.complete ?? liveProgress?.complete ?? false}
          t={t}
        />
      ) : null}
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
        labels={labels}
        roundGraded={data.round.gradingState === 'graded'}
        translations={translations}
        rationaleInFlight={rationaleInFlight}
        locale={locale}
        showOriginal={showOriginal}
        actualMagnitudePct={data.round.actualMagnitudePct}
        streaming={
          streaming || data.generation?.status === 'queued' || data.generation?.status === 'running'
        }
        droppedModelIds={
          droppedModelIds.length > 0
            ? droppedModelIds
            : (data.droppedModelIds ?? []).length > 0
              ? data.droppedModelIds
              : (data.generation?.droppedModelIds ?? [])
        }
      />
      <ExtraCompare models={data.models} consensus={data.consensus} t={t} labels={labels} />
      {data.hitRate.graded > 0 ? (
        <p className="border-t border-league-border/50 px-3 py-2 text-[10px] leading-snug text-league-fg-muted md:px-4">
          {t.bracket.resultLegend}
        </p>
      ) : null}
      {data.verdict.hitRecord.graded > 0 ? (
        <VerdictPanel
          verdict={data.verdict}
          models={data.models}
          t={t}
          labels={labels}
          consensus={data.consensus}
          horizon={data.round.horizon}
          magnitudeCompare={
            data.consensus.aggregateMagnitudePct !== null && data.round.actualMagnitudePct !== null
              ? { predictedPct: data.consensus.aggregateMagnitudePct, actualPct: data.round.actualMagnitudePct }
              : null
          }
        />
      ) : (
        <PendingVerdictPanel
          round={data.round}
          t={t}
          locale={locale}
          labels={labels}
          consensus={data.consensus}
          campSplit={data.campSplit}
          tierSplit={data.tierSplit}
          bookSplit={data.bookSplit}
          weightsSplit={data.weightsSplit}
          seatComplete={seatComplete}
          answered={answered}
        />
      )}
    </>
  )
}
