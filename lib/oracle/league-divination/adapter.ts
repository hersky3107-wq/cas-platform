/**
 * League divination adapter — the surface the league track will call.
 *
 * Input is closed (no market data). Output verdict is the code ballot;
 * the single reader only writes 4–5 lines of rationale.
 *
 * Cache: public.oracle_league_divination_cache keyed by round_id.
 */
import type { LeagueDivinationAdapterInput, LeagueDivinationAdapterOutput, LeagueAdapterSystemEntry } from './adapter-types'
import { compactReaderPack, codeVerdictToOutput } from './compact-pack'
import { computeLeagueDivination } from './compute'
import { runLeagueReader, type LeagueReaderCall } from './reader'
import type { LeagueDivinationCache } from './cache'
import { presenceFromVote, type LeagueSystemPresence } from './status'
import type { LeagueDivinationResult, LeagueSystemVote } from './types'

export type LeagueDivinationAdapterDeps = {
  cache: LeagueDivinationCache
  reader?: LeagueReaderCall
}

function entryFromPresence(
  id: LeagueAdapterSystemEntry['id'],
  presence: LeagueSystemPresence,
  weight: 3 | 2 | null,
  source: string | null,
  chart: Record<string, unknown>,
): LeagueAdapterSystemEntry {
  return {
    id,
    ballot: presence.ballot,
    weight: presence.status === '결번' ? null : weight,
    status: presence.status,
    statusLabel: presence.statusLabel,
    reason: presence.reason,
    unreadableCode: presence.unreadableCode,
    source,
    chart,
  }
}

function voteBallot(vote: LeagueSystemVote): LeagueAdapterSystemEntry {
  return entryFromPresence(vote.system, presenceFromVote(vote), vote.weight, vote.source, { source: vote.source })
}

export function systemsFromCompute(result: LeagueDivinationResult): LeagueAdapterSystemEntry[] {
  const tarotOutcome = result.charts.tarot.cards.find((card) => card.positionLabel === 'Outcome')
  const runeFuture = result.charts.runes.runes.find((rune) => rune.positionLabel === 'Future')
  return [
    {
      ...voteBallot(result.votes.iching),
      chart: {
        primary: result.charts.iching.draw.primary.hanja,
        resulting: result.charts.iching.draw.resulting.hanja,
        relative: result.charts.iching.relative,
        yongshenPosition: result.charts.iching.yongshenPosition,
        yongshenSource: result.charts.iching.yongshenSource,
        ...result.charts.presence.iching,
      },
    },
    {
      ...voteBallot(result.votes.tarot),
      chart: {
        outcome: tarotOutcome?.name ?? null,
        reversed: tarotOutcome?.reversed ?? null,
        spread: result.charts.tarot.spread,
        ...result.charts.presence.tarot,
      },
    },
    {
      ...voteBallot(result.votes.runes),
      chart: {
        future: runeFuture?.name ?? null,
        reversed: runeFuture?.reversed ?? null,
        count: result.charts.runes.count,
        ...result.charts.presence.runes,
      },
    },
    {
      ...voteBallot(result.votes.taeil),
      chart: {
        label: result.charts.taeil.label,
        dayGanzhi: result.charts.taeil.pillars.day.ganzhi,
        monthGanzhi: result.charts.taeil.pillars.month.ganzhi,
        yongshen: result.charts.taeil.yongshen,
        hourPin: result.charts.taeil.hourPin,
        monthModifier: result.votes.taeil.monthModifier,
        appliedWeight: result.votes.taeil.appliedWeight,
        ...result.charts.presence.taeil,
      },
    },
    entryFromPresence(
      'astro',
      result.charts.presence.astro,
      null,
      result.charts.astro.reason,
      {
        ...result.charts.presence.astro,
        sunSign: result.charts.astro.chart.bodies.Sun.sign,
        moonSign: result.charts.astro.chart.bodies.Moon.sign,
        location: result.charts.astro.location,
      },
    ),
    entryFromPresence(
      'ninestar',
      result.charts.presence.ninestar,
      null,
      result.charts.ninestar.reason,
      {
        ...result.charts.presence.ninestar,
        year: result.charts.ninestar.result.year,
        month: result.charts.ninestar.result.month,
        day: result.charts.ninestar.result.day,
      },
    ),
  ]
}

async function produce(
  input: LeagueDivinationAdapterInput,
  deps: LeagueDivinationAdapterDeps,
): Promise<LeagueDivinationAdapterOutput> {
  const computed = computeLeagueDivination({
    roundId: input.roundId,
    firstViewIso: input.firstViewedAt,
    categoryId: input.category,
    axis: input.propositionType === 'pick_one' ? 'pick_one' : 'direction',
  })
  const pack = compactReaderPack(computed, {
    proposition: input.proposition,
    subjectName: input.subjectName,
  })
  const reader = await runLeagueReader(pack, deps.reader)
  const mapped = codeVerdictToOutput(computed.aggregate.vote, input.propositionType === 'pick_one')
  return {
    verdict: mapped.verdict,
    pick: mapped.pick,
    rationale: reader.rationale,
    confidence: computed.aggregate.confidence,
    costUsd: reader.costUsd,
    costIsEstimated: reader.costIsEstimated,
    votedCount: computed.aggregate.votedCount,
    ichingAlone: computed.aggregate.ichingAlone,
    systems: systemsFromCompute(computed),
  }
}

export async function readLeagueDivination(
  input: LeagueDivinationAdapterInput,
  deps: LeagueDivinationAdapterDeps,
): Promise<LeagueDivinationAdapterOutput> {
  const cached = await deps.cache.get(input.roundId)
  if (cached) return cached
  const fresh = await produce(input, deps)
  return deps.cache.putIfAbsent(input.roundId, input.firstViewedAt, fresh)
}
