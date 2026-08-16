'use client'

import { useMemo, useState } from 'react'
import {
  LEAGUE_TIERS,
  type CardModelPrediction,
  type LeagueTier,
  type TierSplit,
} from '@/lib/league/card-types'
import type { LeagueUiPack } from '@/lib/league/i18n/dictionary'
import { ModelTile } from './ModelTile'

const DIVISION_DOT: Record<LeagueTier, string> = {
  premier: 'bg-rose-500',
  challenger: 'bg-sky-500',
  world: 'bg-emerald-500',
  scout: 'bg-violet-500',
}

/**
 * Tournament-board view of one round: models grouped by league tier.
 *
 * Grouping is a client-side VIEW of the already-final `models` array.
 * Division tallies come from server-computed `tierSplit` — this file never
 * re-counts directions from the rows (see card-types.ts).
 *
 * Responsive without a forked tree: the same tiles render as slim rows on
 * a narrow viewport and as a multi-column grid from `md` up. Divisions
 * collapse on mobile (Premier starts open); `md:` always shows the grid.
 */
export function DivisionBoard({
  models,
  tierSplit,
  t,
}: {
  models: CardModelPrediction[]
  tierSplit: TierSplit
  t: LeagueUiPack
}) {
  const groups = useMemo(() => groupByTier(models), [models])
  const [open, setOpen] = useState<Record<LeagueTier, boolean>>({
    premier: true,
    challenger: false,
    world: false,
    scout: false,
  })

  if (models.length === 0) {
    return <p className="px-4 py-6 text-center text-xs text-league-fg-muted">{t.modelList.empty}</p>
  }

  return (
    <div className="flex flex-col">
      <OverallStrip groups={groups} tierSplit={tierSplit} t={t} />
      {groups.map((group) => {
        const expanded = open[group.tier]
        return (
          <section key={group.tier} className="border-t border-league-border/50">
            <button
              type="button"
              onClick={() => setOpen((prev) => ({ ...prev, [group.tier]: !prev[group.tier] }))}
              aria-expanded={expanded}
              className="flex w-full items-center gap-2 px-3 py-2 text-left md:cursor-default md:px-4"
            >
              <span className={`h-2 w-2 shrink-0 rounded-full ${DIVISION_DOT[group.tier]}`} aria-hidden />
              <span className="min-w-0 flex-1 truncate text-[11px] font-bold uppercase tracking-wide text-league-fg">
                {t.bracket.division[group.tier]}
              </span>
              <span className="shrink-0 font-mono text-[11px] font-semibold tabular-nums text-league-fg-muted">
                {t.bracket.compactTally(tierSplit[group.tier])}
              </span>
              <span className="text-[10px] text-league-fg-muted md:hidden" aria-hidden>
                {expanded ? '▾' : '▸'}
              </span>
            </button>
            <ul
              className={`${expanded ? 'grid' : 'hidden'} grid-cols-1 gap-1.5 px-2 pb-2 md:grid md:grid-cols-3 md:gap-2 md:px-3 md:pb-3 lg:grid-cols-4 xl:grid-cols-5`}
            >
              {group.models.map((model) => (
                <ModelTile key={model.model_id} model={model} t={t} />
              ))}
            </ul>
          </section>
        )
      })}
    </div>
  )
}

function OverallStrip({
  groups,
  tierSplit,
  t,
}: {
  groups: { tier: LeagueTier }[]
  tierSplit: TierSplit
  t: LeagueUiPack
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 md:px-4">
      {groups.map((group) => (
        <span key={group.tier} className="inline-flex items-center gap-1.5 font-mono text-[10px] tabular-nums text-league-fg-muted">
          <span className={`h-1.5 w-1.5 rounded-full ${DIVISION_DOT[group.tier]}`} aria-hidden />
          <span className="font-sans font-bold uppercase tracking-wide">{t.bracket.division[group.tier]}</span>
          <span>{t.bracket.compactTally(tierSplit[group.tier])}</span>
        </span>
      ))}
    </div>
  )
}

function groupByTier(models: CardModelPrediction[]): { tier: LeagueTier; models: CardModelPrediction[] }[] {
  return LEAGUE_TIERS.map((tier) => ({
    tier,
    models: models.filter((m) => m.league_tier === tier),
  })).filter((g) => g.models.length > 0)
}
