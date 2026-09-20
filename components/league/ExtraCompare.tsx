import type { CardModelPrediction, ConsensusSummary } from '@/lib/league/card-types'
import { buildExtraCompareView, extraRecordsFromModels, hasExtraCompareModels } from '@/lib/league/extra-compare'
import type { ExtraSeatId } from '@/lib/league/extra/seats'
import type { LeagueUiPack } from '@/lib/league/i18n/dictionary'
import type { SideLabels } from '@/lib/league/side-labels'
import { directionBadgeLabel } from '@/lib/league/compliance'
import { winRateDisplay, winRateLabel } from '@/lib/league/win-rate'

const SEAT_VS: Record<string, string> = {
  agree: 'ring-1 ring-emerald-400/50 bg-emerald-50/80',
  diverge: 'ring-1 ring-rose-400/50 bg-rose-50/70',
  pending: 'border border-dashed border-league-border/70 bg-league-bg-elevated/70',
  'no-crowd': 'border border-league-border/50 bg-league-bg-elevated/70',
}

/**
 * Glanceable extra-vs-40-AI strip. Display comparison only — does not
 * mix extra votes into the official consensus.
 */
export function ExtraCompare({
  models,
  consensus,
  t,
  labels,
}: {
  models: readonly CardModelPrediction[]
  consensus: ConsensusSummary
  t: LeagueUiPack
  labels?: SideLabels
}) {
  if (!hasExtraCompareModels(models)) return null
  const view = buildExtraCompareView(models, consensus, extraRecordsFromModels(models))
  const crowdWord = view.crowdDirection
    ? directionBadgeLabel(view.crowdDirection, t, labels)
    : null

  return (
    <section
      className="mx-2 mb-3 mt-1 rounded-xl border border-amber-400/40 bg-amber-50/50 px-3 py-3 md:mx-3 md:px-4"
      data-testid="extra-compare"
    >
      <p className="text-[13px] font-bold tracking-wide text-league-fg md:text-sm">{t.extraCompare.title}</p>
      <ul className="mt-2 flex flex-wrap items-stretch gap-1.5">
        <li className="inline-flex items-center gap-1.5 rounded-lg border border-league-border bg-white px-2.5 py-1.5 text-[13px] font-semibold text-league-fg">
          <span>{view.crowdCount > 0 ? t.extraCompare.crowd(view.crowdCount) : t.extraCompare.crowdPending}</span>
          <span className={crowdWord ? 'text-league-fg' : 'text-league-fg-muted'}>
            {crowdWord ?? t.modelList.noResponse}
          </span>
        </li>
        {view.seats.map((seat) => {
          const word = seat.direction
            ? directionBadgeLabel(seat.direction, t, labels)
            : t.modelList.noResponse
          const vs =
            seat.vsCrowd === 'agree'
              ? t.extraCompare.agree
              : seat.vsCrowd === 'diverge'
                ? t.extraCompare.diverge
                : null
          return (
            <li
              key={seat.id}
              className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[13px] font-semibold text-league-fg ${SEAT_VS[seat.vsCrowd]}`}
              data-extra-seat={seat.id}
              data-vs-crowd={seat.vsCrowd}
            >
              <span>
                {seat.badge}
                {t.extraCompare.seat[seat.id as ExtraSeatId]}
              </span>
              <span className={seat.direction ? 'text-league-fg' : 'text-league-fg-muted'}>{word}</span>
              {vs ? <span className="text-[11px] font-medium text-league-fg-muted">{vs}</span> : null}
            </li>
          )
        })}
      </ul>
      <div className="mt-2.5 border-t border-amber-300/40 pt-2">
        <p className="text-[12px] font-bold text-league-fg">{t.extraCompare.recordTitle}</p>
        {view.hasAnyRecord ? (
          <ul className="mt-1 space-y-0.5">
            {view.seats.map((seat) => {
              if (!seat.record) {
                return (
                  <li key={seat.id} className="text-[12px] text-league-fg-muted">
                    {seat.badge}
                    {t.extraCompare.seat[seat.id]} · {t.extraCompare.recordPending}
                  </li>
                )
              }
              return (
                <li key={seat.id} className="text-[12px] text-league-fg">
                  {seat.badge}
                  {t.extraCompare.seat[seat.id]} · {winRateLabel(winRateDisplay(seat.record.correct, seat.record.graded), t)}
                </li>
              )
            })}
          </ul>
        ) : (
          <p className="mt-0.5 text-[12px] text-league-fg-muted">{t.extraCompare.recordPending}</p>
        )}
      </div>
    </section>
  )
}
