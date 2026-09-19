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
import type { LeagueDivinationResult, LeagueSystemVote } from './types'

export type LeagueDivinationAdapterDeps = {
  cache: LeagueDivinationCache
  reader?: LeagueReaderCall
}

function voteBallot(vote: LeagueSystemVote): LeagueAdapterSystemEntry {
  return {
    id: vote.system,
    ballot: vote.vote,
    weight: vote.weight,
    collapsedFromHold: vote.collapsedFromHold,
    source: vote.source,
    chart: { source: vote.source },
  }
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
      },
    },
    {
      ...voteBallot(result.votes.tarot),
      chart: {
        outcome: tarotOutcome?.name ?? null,
        reversed: tarotOutcome?.reversed ?? null,
        spread: result.charts.tarot.spread,
      },
    },
    {
      ...voteBallot(result.votes.runes),
      chart: {
        future: runeFuture?.name ?? null,
        reversed: runeFuture?.reversed ?? null,
        count: result.charts.runes.count,
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
      },
    },
    {
      id: 'astro',
      ballot: null,
      weight: null,
      collapsedFromHold: false,
      source: result.charts.astro.reason,
      chart: {
        reason: result.charts.astro.reason,
        sunSign: result.charts.astro.chart.bodies.Sun.sign,
        moonSign: result.charts.astro.chart.bodies.Moon.sign,
        location: result.charts.astro.location,
      },
    },
    {
      id: 'ninestar',
      ballot: null,
      weight: null,
      collapsedFromHold: false,
      source: result.charts.ninestar.reason,
      chart: {
        reason: result.charts.ninestar.reason,
        year: result.charts.ninestar.result.year,
        month: result.charts.ninestar.result.month,
        day: result.charts.ninestar.result.day,
      },
    },
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
