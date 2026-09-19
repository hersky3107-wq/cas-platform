/**
 * League divination calculation entry. Pure: no DB, no network, no LLM,
 * no Date.now() — firstViewIso is the only instant.
 */
import { fourPillars } from '../engines/calendar'
import { ichingDraw, runeDraw, tarotDraw } from '../engines/draw'
import { aggregateLeagueVotes } from './aggregator'
import { liuqinForCategory, taeilYongshenForCategory } from './category-tables'
import {
  LEAGUE_DIVINATION_VERSION,
  LEAGUE_RUNE_COUNT,
  LEAGUE_TAROT_PICKS,
  LEAGUE_TAROT_SPREAD,
  LEAGUE_VOTE_WEIGHTS,
} from './conventions'
import { computeAstroChartPack, computeNineStarChartPack } from './charts'
import { leagueDrawSeed, seoulClockFromFirstView } from './seed'
import { LEAGUE_UNREADABLE, presenceFromVote, presenceGyeolbeon } from './status'
import type { LeagueDivinationInput, LeagueDivinationResult, LeagueHourPin, LeagueSystemVote } from './types'
import { voteRuneFuture, voteTaeil, voteTarotOutcome } from './votes'
import { mapPolarity, voteIching, yongshenPolarity } from './yongshen'

export function computeLeagueDivination(input: LeagueDivinationInput): LeagueDivinationResult {
  const clock = seoulClockFromFirstView(input.firstViewIso)
  const hourPin: LeagueHourPin = {
    applied: clock.hourPinned,
    originalTime: clock.originalTime,
    usedTime: clock.time,
    reason: clock.hourPinned ? 'zi_start_fork_avoided' : null,
  }
  const pillars = fourPillars({ date: clock.date, time: clock.time, timezone: clock.tz })
  const relative = liuqinForCategory(input.categoryId)
  const taeilYongshen = taeilYongshenForCategory(input.categoryId)

  const iching = ichingDraw({
    seed: leagueDrawSeed(input.roundId, input.firstViewIso, 'iching'),
    dayStem: pillars.day.stem.hanja,
    monthElement: pillars.month.branch.element,
    dayElement: pillars.day.branch.element,
  })
  const tarot = tarotDraw({
    seed: leagueDrawSeed(input.roundId, input.firstViewIso, 'tarot'),
    spread: LEAGUE_TAROT_SPREAD,
    pickedPositions: [...LEAGUE_TAROT_PICKS],
  })
  const runes = runeDraw({
    seed: leagueDrawSeed(input.roundId, input.firstViewIso, 'runes'),
    count: LEAGUE_RUNE_COUNT,
  })

  const ichingBallot = voteIching(iching, relative, input.axis)
  const yongshen = yongshenPolarity(iching, relative)
  const yongshenVote = mapPolarity(yongshen.hit.polarity, input.axis)

  const ichingVote: LeagueSystemVote = {
    system: 'iching',
    camp: 'draw',
    weight: LEAGUE_VOTE_WEIGHTS.iching,
    vote: ichingBallot.vote,
    abstained: false,
    unreadableCode: null,
    source: ichingBallot.source,
  }
  const tarotVote = voteTarotOutcome(tarot.cards, input.axis)
  const runeVote = voteRuneFuture(runes.runes, input.axis)
  const taeilVote = voteTaeil(pillars, taeilYongshen, input.axis)

  const aggregate = aggregateLeagueVotes({
    axis: input.axis,
    iching: ichingVote,
    tarot: tarotVote,
    runes: runeVote,
    taeil: taeilVote,
    yongshenVote,
  })

  return {
    version: LEAGUE_DIVINATION_VERSION,
    axis: input.axis,
    categoryId: input.categoryId,
    votes: {
      iching: ichingVote,
      tarot: tarotVote,
      runes: runeVote,
      taeil: taeilVote,
    },
    aggregate,
    charts: {
      iching: {
        draw: iching,
        relative,
        yongshenSource: ichingBallot.pick.source,
        yongshenPosition: ichingBallot.pick.line.position,
      },
      tarot,
      runes,
      taeil: {
        label: '택일',
        pillars,
        yongshen: taeilYongshen,
        dayBranchElement: pillars.day.branch.element,
        monthBranchElement: pillars.month.branch.element,
        hourPin,
      },
      astro: computeAstroChartPack(clock),
      ninestar: computeNineStarChartPack(clock),
      presence: {
        iching: presenceFromVote(ichingVote),
        tarot: presenceFromVote(tarotVote),
        runes: presenceFromVote(runeVote),
        taeil: presenceFromVote(taeilVote),
        astro: presenceGyeolbeon(LEAGUE_UNREADABLE.astro),
        ninestar: presenceGyeolbeon(LEAGUE_UNREADABLE.ninestar),
      },
    },
    seoul: { date: clock.date, time: clock.time, tz: clock.tz, hourPin },
  }
}
