import type { SportsMarketView } from '@/lib/league/sports-market'
import type { LeagueUiPack } from '@/lib/league/i18n/dictionary'

export function SportsMarketPanel({
  view,
  t,
}: {
  view: SportsMarketView
  t: LeagueUiPack
}) {
  const copy = t.sportsMarket
  const divergence =
    view.divergencePp == null
      ? null
      : copy.divergenceLabel(view.divergencePp > 0 ? `+${view.divergencePp}` : String(view.divergencePp))
  const fracture =
    view.fracture === 'iron'
      ? copy.fractureIron
      : view.fracture === 'soft'
        ? copy.fractureSoft
        : view.fracture === 'warn'
          ? copy.fractureWarn
          : null

  return (
    <section
      className="mx-2 mb-3 rounded-xl border border-league-border bg-league-bg-elevated/60 px-3 py-3 md:mx-3 md:px-4"
      data-testid="sports-market"
    >
      <ul className="flex flex-wrap items-stretch gap-1.5">
        <li className="rounded-lg border border-league-border bg-white px-2.5 py-1.5 text-[13px] font-semibold text-league-fg">
          {copy.ensembleLabel}
          <span className="ml-1.5">{view.ensembleWinPct == null ? '—' : `${view.ensembleWinPct}%`}</span>
        </li>
        <li className="rounded-lg border border-league-border bg-white px-2.5 py-1.5 text-[13px] font-semibold text-league-fg">
          {copy.marketBaselineLabel}
          <span className="ml-1.5">{view.marketBaselinePct == null ? '—' : `${view.marketBaselinePct}%`}</span>
        </li>
        {divergence ? (
          <li className="rounded-lg border border-league-border bg-white px-2.5 py-1.5 text-[13px] font-semibold text-league-fg">
            {divergence}
          </li>
        ) : null}
        {view.agreementPct != null ? (
          <li className="rounded-lg border border-league-border bg-white px-2.5 py-1.5 text-[13px] font-semibold text-league-fg">
            {copy.agreement(String(view.agreementPct))}
            {fracture ? <span className="ml-1.5 text-[11px] font-medium text-league-fg-muted">{fracture}</span> : null}
          </li>
        ) : null}
      </ul>
      <p className="mt-2 text-[11px] leading-snug text-league-fg-muted">{copy.disclaimer}</p>
    </section>
  )
}
