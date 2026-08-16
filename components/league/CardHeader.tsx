import type { CardRoundMeta, HitRateSummary } from '@/lib/league/card-types'
import type { LeagueUiPack } from '@/lib/league/i18n/dictionary'
import type { ToneTokens } from '@/lib/league/tone'

/** Header: instrument + tone dot + AI-hit-rate badge (placeholder until graded). */
export function CardHeader({
  round,
  hitRate,
  t,
}: {
  round: CardRoundMeta
  hitRate: HitRateSummary
  tone: ToneTokens
  t: LeagueUiPack
}) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 pt-4 pb-2">
      <div className="flex min-w-0 items-center gap-2">
        <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-league-accent" aria-hidden />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-league-fg">{round.instrument}</p>
          <p className="truncate text-[11px] text-league-fg-muted">
            {round.horizon} · {formatCategory(round.category)}
          </p>
        </div>
      </div>
      <HitRateBadge hitRate={hitRate} t={t} />
    </div>
  )
}

function HitRateBadge({ hitRate, t }: { hitRate: HitRateSummary; t: LeagueUiPack }) {
  const label = hitRate.hitRatePct !== null ? t.hitRate.pct(hitRate.hitRatePct) : t.hitRate.pending
  return (
    <span className="shrink-0 whitespace-nowrap rounded-full bg-league-accent-soft px-2.5 py-1 text-[11px] font-semibold text-league-accent-strong">
      {label}
    </span>
  )
}

/** Category is a technical/data label (like a ticker), not translated chrome — see i18n dictionary scoping note. */
function formatCategory(category: string): string {
  return category.replace(/_/g, ' ')
}
