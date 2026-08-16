import { directionBadgeLabel } from '@/lib/league/compliance'
import { CAMP_LABEL, TIER_LABEL, type CardModelPrediction, type Direction } from '@/lib/league/card-types'
import type { LeagueUiPack } from '@/lib/league/i18n/dictionary'

/**
 * One model's row. Direction badge text comes only from
 * `directionBadgeLabel` (UP/DOWN/FLAT/NO CALL, translated via `t`) — never
 * "BUY"/"SELL". The `reasoning_snippet` is the model's own free-text output,
 * rendered VERBATIM as an attributed quote — it is intentionally NOT run
 * through `t` or machine-translated in this pass (see i18n dictionary.ts
 * header comment for why).
 */
export function ModelRow({ model, t }: { model: CardModelPrediction; t: LeagueUiPack }) {
  return (
    <li className="flex flex-col gap-1 border-b border-league-border/40 px-4 py-3 last:border-b-0">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-sm font-medium text-league-fg">{model.brand}</span>
          <span className="shrink-0 rounded bg-league-bg-elevated px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-league-fg-muted">
            {TIER_LABEL[model.league_tier]}
          </span>
          <span className="shrink-0 text-[10px] text-league-fg-muted">{CAMP_LABEL[model.camp]}</span>
        </div>
        <DirectionBadge direction={model.direction} probability={model.probability} t={t} />
      </div>
      {model.reasoning_snippet ? (
        <p className="truncate text-xs italic text-league-fg-muted">&ldquo;{model.reasoning_snippet}&rdquo;</p>
      ) : null}
      {model.is_correct !== null ? (
        <span
          className={`w-fit rounded px-1.5 py-0.5 text-[10px] font-semibold ${
            model.is_correct ? 'bg-emerald-500/10 text-emerald-700' : 'bg-rose-500/10 text-rose-700'
          }`}
        >
          {model.is_correct ? t.modelList.correct : t.modelList.missed}
        </span>
      ) : null}
    </li>
  )
}

const DIRECTION_STYLE: Record<Direction, string> = {
  up: 'bg-emerald-500/10 text-emerald-700',
  down: 'bg-rose-500/10 text-rose-700',
  flat: 'bg-slate-500/10 text-slate-600',
}
const NO_CALL_STYLE = 'bg-slate-400/10 text-slate-500'

function DirectionBadge({
  direction,
  probability,
  t,
}: {
  direction: Direction | null
  probability: number | null
  t: LeagueUiPack
}) {
  const style = direction ? DIRECTION_STYLE[direction] : NO_CALL_STYLE
  const probSuffix = direction && probability !== null ? ` ${Math.round(probability)}%` : ''
  return (
    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${style}`}>
      {directionBadgeLabel(direction, t)}
      {probSuffix}
    </span>
  )
}
