'use client'

import { useMemo, useState } from 'react'
import {
  LEAGUE_TIERS,
  type CardModelPrediction,
  type LeagueTier,
  type TierSplit,
} from '@/lib/league/card-types'
import {
  droppedCountForTier,
  rosterIdsForTier,
  streamingTierFill,
} from '@/lib/league/generation-board'
import type { LeagueUiPack } from '@/lib/league/i18n/dictionary'
import type { LeagueLocale } from '@/lib/league/i18n/locales'
import { isRationaleTranslationPending, lookupTranslatedRationale } from '@/lib/league/rationale-display'
import type { SideLabels } from '@/lib/league/side-labels'
import { ModelTile } from './ModelTile'

const DIVISION_DOT: Record<LeagueTier, string> = {
  premier: 'bg-rose-500',
  challenger: 'bg-sky-500',
  world: 'bg-emerald-500',
  scout: 'bg-violet-500',
  extra: 'bg-amber-500',
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
 *
 * While `streaming`, all five tiers mount immediately with skeleton slots
 * sized from `rosterIdsForTier`. Arriving tiles drop into their own tier
 * in arrival order; dropped seats become a compact 미응답 placeholder.
 * Static / finished cards omit `streaming` so frozen render fixtures stay
 * byte-identical.
 */
export function DivisionBoard({
  models,
  tierSplit,
  t,
  labels,
  roundGraded = false,
  translations = null,
  rationaleInFlight = false,
  locale = 'en',
  showOriginal = false,
  actualMagnitudePct = null,
  streaming = false,
  droppedModelIds = [],
}: {
  models: CardModelPrediction[]
  tierSplit: TierSplit
  t: LeagueUiPack
  /** The round's side-label resolver. Omitted only by legacy price-round callers. */
  labels?: SideLabels
  roundGraded?: boolean
  translations?: Record<string, string> | null
  rationaleInFlight?: boolean
  locale?: LeagueLocale
  showOriginal?: boolean
  /** Round-level actual percent change, once graded. Forwarded to each tile's compare line. */
  actualMagnitudePct?: number | null
  /** Live generation: mount every tier now and fill concurrently. */
  streaming?: boolean
  droppedModelIds?: readonly string[]
}) {
  const groups = useMemo(
    () => (streaming ? groupByTierStreaming(models) : groupByTier(models)),
    [models, streaming]
  )
  const [open, setOpen] = useState<Record<LeagueTier, boolean>>({
    premier: true,
    challenger: false,
    world: false,
    scout: false,
    extra: true,
  })

  if (!streaming && models.length === 0) {
    return <p className="px-4 py-6 text-center text-xs text-league-fg-muted">{t.modelList.empty}</p>
  }

  return (
    <div className="flex flex-col">
      <OverallStrip groups={groups} tierSplit={tierSplit} t={t} labels={labels} />
      {groups.map((group) => {
        const expanded = streaming ? true : open[group.tier]
        const fill = streaming
          ? streamingTierFill(
              rosterIdsForTier(group.tier).length,
              group.models.length,
              droppedCountForTier(group.tier, droppedModelIds)
            )
          : null
        return (
          <section
            key={group.tier}
            className="border-t border-league-border/50"
            data-tier={streaming ? group.tier : undefined}
          >
            <button
              type="button"
              onClick={() => {
                if (streaming) return
                setOpen((prev) => ({ ...prev, [group.tier]: !prev[group.tier] }))
              }}
              aria-expanded={expanded}
              className="flex w-full items-center gap-2 px-3 py-2 text-left md:cursor-default md:px-4"
            >
              <span className={`h-2 w-2 shrink-0 rounded-full ${DIVISION_DOT[group.tier]}`} aria-hidden />
              <span className="min-w-0 flex-1 truncate text-[11px] font-bold uppercase tracking-wide text-league-fg">
                {t.bracket.division[group.tier]}
              </span>
              <span className="shrink-0 font-mono text-[11px] font-semibold tabular-nums text-league-fg-muted">
                {t.bracket.compactTally(tierSplit[group.tier], labels?.glyphs)}
              </span>
              {streaming ? null : (
                <span className="text-[10px] text-league-fg-muted md:hidden" aria-hidden>
                  {expanded ? '▾' : '▸'}
                </span>
              )}
            </button>
            <ul
              className={`${expanded ? 'grid' : 'hidden'} grid-cols-1 gap-1.5 px-2 pb-2 md:grid md:grid-cols-3 md:gap-2 md:px-3 md:pb-3 lg:grid-cols-4 xl:grid-cols-5`}
            >
              {group.models.map((model) => {
                const translatedRationale = lookupTranslatedRationale(model, translations)
                return (
                  <ModelTile
                    key={model.model_id}
                    model={model}
                    t={t}
                    labels={labels}
                    roundGraded={roundGraded}
                    translatedRationale={translatedRationale}
                    rationalePending={isRationaleTranslationPending({
                      locale,
                      original: model.reasoning_snippet,
                      translated: translatedRationale,
                      inFlight: rationaleInFlight,
                    })}
                    showOriginal={showOriginal}
                    actualMagnitudePct={actualMagnitudePct}
                  />
                )
              })}
              {fill
                ? Array.from({ length: fill.noResponse }, (_, i) => (
                    <NoResponseSeat key={`${group.tier}-drop-${i}`} label={t.modelList.noResponse} />
                  ))
                : null}
              {fill
                ? Array.from({ length: fill.skeletons }, (_, i) => (
                    <SeatSkeleton key={`${group.tier}-sk-${i}`} />
                  ))
                : null}
            </ul>
          </section>
        )
      })}
    </div>
  )
}

function SeatSkeleton() {
  return (
    <li
      className="league-gen-skeleton h-[52px] rounded-lg border border-league-border/40 md:h-[58px]"
      data-testid="seat-skeleton"
      aria-hidden
    />
  )
}

function NoResponseSeat({ label }: { label: string }) {
  return (
    <li
      className="flex h-[36px] items-center justify-center rounded-lg border border-dashed border-league-border/50 bg-league-bg-elevated/60 md:h-[40px]"
      data-testid="seat-no-response"
    >
      <span className="text-[10px] font-medium tracking-wide text-league-fg-muted">{label}</span>
    </li>
  )
}

function OverallStrip({
  groups,
  tierSplit,
  t,
  labels,
}: {
  groups: { tier: LeagueTier }[]
  tierSplit: TierSplit
  t: LeagueUiPack
  labels?: SideLabels
}) {
  return (
    <div className="px-3 py-2 md:px-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {groups.map((group) => (
          <span key={group.tier} className="inline-flex items-center gap-1.5 font-mono text-[10px] tabular-nums text-league-fg-muted">
            <span className={`h-1.5 w-1.5 rounded-full ${DIVISION_DOT[group.tier]}`} aria-hidden />
            <span className="font-sans font-bold uppercase tracking-wide">{t.bracket.division[group.tier]}</span>
            <span>{t.bracket.compactTally(tierSplit[group.tier], labels?.glyphs)}</span>
          </span>
        ))}
      </div>
      <p className="mt-1.5 text-[10px] leading-snug text-league-fg-muted">{t.headline.correlatedNote}</p>
    </div>
  )
}

function groupByTier(models: CardModelPrediction[]): { tier: LeagueTier; models: CardModelPrediction[] }[] {
  return LEAGUE_TIERS.map((tier) => ({
    tier,
    models: models.filter((m) => m.league_tier === tier),
  })).filter((g) => g.models.length > 0)
}

function groupByTierStreaming(models: CardModelPrediction[]): { tier: LeagueTier; models: CardModelPrediction[] }[] {
  return LEAGUE_TIERS.map((tier) => ({
    tier,
    models: models.filter((m) => m.league_tier === tier),
  }))
}
