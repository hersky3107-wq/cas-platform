'use client'

import { useEffect, useState } from 'react'
import { CountryFlag } from '@/components/league/CountryFlag'
import type { CardModelPrediction, LeagueTier } from '@/lib/league/card-types'
import { LEAGUE_TIERS } from '@/lib/league/card-types'
import { lookupExtraSeat } from '@/lib/league/extra/seats'
import { rosterIdsForTier } from '@/lib/league/generation-board'
import type { LeagueUiPack } from '@/lib/league/i18n/dictionary'
import { leagueSurfaceCopy } from '@/lib/league/i18n/surface-copy'
import type { LeagueLocale } from '@/lib/league/i18n/locales'
import { lookupRosterEntry } from '@/lib/league/roster'
import type { SideLabels } from '@/lib/league/side-labels'
import { runningRemainingMinutes, tickerTake, tierRemainingMinutes } from '@/lib/league/waiting-arena'

const TIER_DOT: Record<LeagueTier, string> = {
  premier: 'bg-rose-500',
  challenger: 'bg-sky-500',
  world: 'bg-emerald-500',
  scout: 'bg-violet-500',
  extra: 'bg-amber-500',
}

export function WaitingArena({
  queued,
  answered,
  rosterSize,
  queuePosition,
  etaMinutes,
  models,
  labels,
  t,
  locale,
  startedAtMs,
}: {
  queued: boolean
  answered: number
  rosterSize: number
  queuePosition?: number
  etaMinutes?: number
  models: readonly CardModelPrediction[]
  labels?: SideLabels
  t: LeagueUiPack
  locale: LeagueLocale
  /** Test hook. Live cards omit it and count from mount. */
  startedAtMs?: number
}) {
  const copy = leagueSurfaceCopy(locale)
  const [factIndex, setFactIndex] = useState(0)
  const [elapsedMin, setElapsedMin] = useState(0)
  const [reduced, setReduced] = useState(false)
  const mountedAt = startedAtMs ?? null

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const apply = () => setReduced(media.matches)
    apply()
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [])

  useEffect(() => {
    if (reduced) return
    const id = window.setInterval(() => {
      setFactIndex((n) => (n + 1) % copy.arena.facts.length)
    }, 6000)
    return () => window.clearInterval(id)
  }, [reduced, copy.arena.facts.length])

  useEffect(() => {
    if (queued) return
    const origin = mountedAt ?? Date.now()
    const tick = () => setElapsedMin(Math.max(0, Math.floor((Date.now() - origin) / 60_000)))
    tick()
    const id = window.setInterval(tick, 15_000)
    return () => window.clearInterval(id)
  }, [queued, mountedAt])

  const remaining = queued ? null : runningRemainingMinutes(answered, rosterSize)
  const unansweredByTier = Object.fromEntries(
    LEAGUE_TIERS.map((tier) => {
      const ids = rosterIdsForTier(tier)
      const arrived = models.filter((model) => model.league_tier === tier).length
      return [tier, Math.max(0, ids.length - arrived)]
    }),
  ) as Record<LeagueTier, number>
  const totalUnanswered = LEAGUE_TIERS.reduce((sum, tier) => sum + unansweredByTier[tier], 0)
  const takes = models
    .map((model) => {
      const seat = lookupRosterEntry(model.model_id)
      const name = seat?.product_alias || lookupExtraSeat(model.model_id)?.brand || model.brand
      return { at: model.predicted_at, line: tickerTake({ name, snippet: model.reasoning_snippet }) }
    })
    .filter((row): row is { at: string; line: string } => Boolean(row.line))
    .sort((a, b) => a.at.localeCompare(b.at))
  const latest = takes[takes.length - 1]?.line ?? null

  const split = countSplit(models, labels)
  const splitTotal = split.a + split.b + split.other
  const wordA = labels ? labels.badge('up') : t.direction.tally.up
  const wordB = labels ? labels.badge('down') : t.direction.tally.down

  return (
    <div data-testid="waiting-arena" data-reduced-motion={reduced ? 'true' : 'false'}>
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-sm font-bold text-league-fg">{copy.arena.title}</p>
        <p className="font-mono text-[11px] font-semibold tabular-nums text-league-fg-muted">
          {t.hub.generationProgress(answered, rosterSize)}
        </p>
      </div>
      {queued && queuePosition && etaMinutes != null ? (
        <p className="mt-1 text-sm font-semibold text-league-fg" data-testid="arena-queue">
          {t.hub.queueLine(queuePosition, etaMinutes)}
        </p>
      ) : null}
      {queued ? <p className="mt-0.5 text-[11px] text-league-fg-muted">{t.hub.generationQueued}</p> : null}
      {!queued ? (
        <p className="mt-1 text-[11px] font-medium tabular-nums text-league-fg-muted" data-testid="arena-clock">
          <span>{copy.arena.elapsed(elapsedMin)}</span>
          {remaining != null && remaining > 0 ? <span> · {copy.arena.remaining(remaining)}</span> : null}
        </p>
      ) : null}
      <div className="mt-2 flex flex-col gap-1.5">
        {LEAGUE_TIERS.map((tier) => (
          <TierRow
            key={tier}
            tier={tier}
            models={models}
            label={t.bracket.division[tier]}
            thinking={copy.arena.thinking}
            remainingLabel={
              queued
                ? null
                : (() => {
                    const minutes = tierRemainingMinutes(unansweredByTier[tier], totalUnanswered, remaining)
                    return minutes == null ? null : copy.arena.tierRemaining(minutes)
                  })()
            }
          />
        ))}
      </div>
      <p className="mt-2 h-8 truncate text-[11px] font-medium leading-8 text-league-fg" data-testid="arena-ticker">
        {latest ?? copy.arena.facts[factIndex]}
      </p>
      <div className="mt-1.5 h-8" data-testid="arena-split">
        {splitTotal === 0 ? (
          <p className="text-[11px] text-league-fg-muted">{copy.arena.noVotes}</p>
        ) : (
          <>
            <div className="flex h-2 overflow-hidden rounded-full bg-league-bg">
              <span className="h-full bg-emerald-500 transition-[width] duration-500 ease-out motion-reduce:transition-none" style={{ width: `${(split.a / splitTotal) * 100}%` }} />
              <span className="h-full bg-rose-500 transition-[width] duration-500 ease-out motion-reduce:transition-none" style={{ width: `${(split.b / splitTotal) * 100}%` }} />
              <span className="h-full bg-slate-400 transition-[width] duration-500 ease-out motion-reduce:transition-none" style={{ width: `${(split.other / splitTotal) * 100}%` }} />
            </div>
            <p className="mt-1 text-[10px] font-semibold tabular-nums text-league-fg-muted">
              {wordA} {split.a} · {wordB} {split.b}
            </p>
          </>
        )}
      </div>
      <p className="mt-1.5 h-8 text-[11px] leading-snug text-league-fg-muted" data-testid="arena-fact">
        {copy.arena.facts[factIndex]}
      </p>
    </div>
  )
}

function TierRow({
  tier,
  models,
  label,
  thinking,
  remainingLabel,
}: {
  tier: LeagueTier
  models: readonly CardModelPrediction[]
  label: string
  thinking: string
  remainingLabel: string | null
}) {
  const arrived = new Set(models.filter((model) => model.league_tier === tier).map((model) => model.model_id))
  const ids = rosterIdsForTier(tier)
  const done = ids.filter((id) => arrived.has(id)).length
  return (
    <div className="flex h-8 items-center gap-2" data-testid={`arena-tier-${tier}`}>
      <span className={`h-2 w-2 shrink-0 rounded-full ${TIER_DOT[tier]}`} aria-hidden />
      <span className="w-16 shrink-0 truncate text-[10px] font-bold uppercase tracking-wide text-league-fg sm:w-24">{label}</span>
      {remainingLabel ? (
        <span className="shrink-0 text-[10px] font-semibold tabular-nums text-league-fg-muted" data-testid="arena-tier-remaining">
          {remainingLabel}
        </span>
      ) : null}
      <TierRing done={done} total={ids.length} />
      <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
        {ids.map((id) => {
          const lit = arrived.has(id)
          const extra = lookupExtraSeat(id)
          const roster = lookupRosterEntry(id)
          if (extra) {
            return (
              <span
                key={id}
                title={lit ? undefined : thinking}
                className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[12px] ${lit ? 'bg-league-accent-soft' : 'league-gen-pulse opacity-40'}`}
                data-lit={lit ? 'true' : 'false'}
              >
                {extra.badge}
              </span>
            )
          }
          if (lit && roster) {
            return (
              <span key={id} data-lit="true" className="shrink-0">
                <CountryFlag brand={roster.brand} camp={roster.camp} />
              </span>
            )
          }
          return (
            <span
              key={id}
              data-lit="false"
              title={thinking}
              className="league-gen-pulse inline-block h-4 w-4 shrink-0 rounded-full bg-league-border/70"
            />
          )
        })}
      </div>
    </div>
  )
}

function TierRing({ done, total }: { done: number; total: number }) {
  const pct = total > 0 ? done / total : 0
  const r = 8
  const c = 2 * Math.PI * r
  return (
    <svg viewBox="0 0 20 20" className="h-5 w-5 shrink-0" aria-hidden data-testid="tier-ring">
      <circle cx="10" cy="10" r={r} fill="none" className="stroke-league-border" strokeWidth="2.5" />
      <circle
        cx="10"
        cy="10"
        r={r}
        fill="none"
        className="stroke-league-accent motion-reduce:transition-none"
        strokeWidth="2.5"
        strokeDasharray={`${c * pct} ${c}`}
        strokeLinecap="round"
        transform="rotate(-90 10 10)"
      />
    </svg>
  )
}

function countSplit(models: readonly CardModelPrediction[], labels?: SideLabels): { a: number; b: number; other: number } {
  let a = 0
  let b = 0
  let other = 0
  for (const model of models) {
    const slot = labels
      ? labels.slot(model.direction)
      : model.direction === 'up'
        ? 'a'
        : model.direction === 'down'
          ? 'b'
          : 'none'
    if (slot === 'a') a += 1
    else if (slot === 'b') b += 1
    else if (model.direction) other += 1
  }
  return { a, b, other }
}
