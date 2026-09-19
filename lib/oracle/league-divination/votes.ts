/**
 * Per-system binary votes for the league scope only.
 *
 * Hold in TAROT_MAJOR_PHASE / TAROT_MINOR_RANK_PHASE / RUNE_PHASE is a
 * 결번 (말을 아킴). 택일 abstains only when 일진 itself is neutral toward
 * the category 용신; 월건 no longer vetoes. PRODUCT, not doctrine — the
 * oracle 3-way axis keeps `hold`.
 */
import { elementPairRelation } from '../engines/calendar/relations'
import type { FiveElement } from '../engines/calendar/types'
import type { FourPillars } from '../engines/calendar'
import type { RuneDrawn, TarotDrawnCard } from '../engines/draw'
import { TAROT_MAJOR_PHASE, TAROT_MINOR_RANK_PHASE, RUNE_PHASE } from '../axes/tables'
import type { PhaseAxis } from '../axes/types'
import { LEAGUE_RUNE_BALLOT_LABEL, LEAGUE_TAROT_BALLOT_LABEL, LEAGUE_VOTE_WEIGHTS, TAEIL_MONTH_OPPOSE_FACTOR } from './conventions'
import { LEAGUE_UNREADABLE } from './status'
import type { LeagueBallotAxis, LeaguePolarity, LeagueSystemVote, LeagueTaeilYongshen } from './types'
import { mapPolarity } from './yongshen'

function flipPhase(axis: PhaseAxis): PhaseAxis {
  if (axis === 'advance') return 'release'
  if (axis === 'release') return 'advance'
  return 'hold'
}

function polarityFromPhase(axis: PhaseAxis): LeaguePolarity | 'hold' {
  if (axis === 'advance') return 'plus'
  if (axis === 'release') return 'minus'
  return 'hold'
}

function gyeolbeon(unreadableCode: string): Omit<LeagueSystemVote, 'system' | 'camp' | 'weight'> {
  return {
    vote: null,
    abstained: true,
    unreadableCode,
    source: unreadableCode,
    appliedWeight: 0,
    monthModifier: null,
  }
}

function tarotBasePhase(card: TarotDrawnCard): PhaseAxis {
  const phase = card.arcana === 'major' ? TAROT_MAJOR_PHASE[card.name] : TAROT_MINOR_RANK_PHASE[card.number]
  if (!phase) throw new Error(`league-divination: no tarot phase for "${card.name}"`)
  return phase
}

/**
 * Outcome card only. Reversal flips advance↔release the way the rune
 * projector does. The axes tarot projector does NOT flip phase on reversal;
 * applying it here is a PRODUCT league-binary rule.
 */
export function voteTarotOutcome(
  cards: readonly TarotDrawnCard[],
  axis: LeagueBallotAxis,
): LeagueSystemVote {
  const card = cards.find((item) => item.positionLabel === LEAGUE_TAROT_BALLOT_LABEL)
  if (!card) throw new Error('league-divination: tarot Outcome card missing')
  const table = tarotBasePhase(card)
  const phase = card.reversed ? flipPhase(table) : table
  const polarity = polarityFromPhase(phase)
  if (polarity === 'hold') {
    return {
      system: 'tarot',
      camp: 'draw',
      weight: LEAGUE_VOTE_WEIGHTS.tarot,
      ...gyeolbeon(LEAGUE_UNREADABLE.tarot),
    }
  }
  return {
    system: 'tarot',
    camp: 'draw',
    weight: LEAGUE_VOTE_WEIGHTS.tarot,
    vote: mapPolarity(polarity, axis),
    abstained: false,
    unreadableCode: null,
    source: card.reversed ? 'tarot.outcome.reversed' : 'tarot.outcome.upright',
    appliedWeight: LEAGUE_VOTE_WEIGHTS.tarot,
    monthModifier: null,
  }
}

export function voteRuneFuture(
  runes: readonly RuneDrawn[],
  axis: LeagueBallotAxis,
): LeagueSystemVote {
  const stave = runes.find((item) => item.positionLabel === LEAGUE_RUNE_BALLOT_LABEL)
  if (!stave) throw new Error('league-divination: rune Future stave missing')
  const table = RUNE_PHASE[stave.name]
  if (!table) throw new Error(`league-divination: no rune phase for "${stave.name}"`)
  const phase = stave.reversed ? flipPhase(table) : table
  const polarity = polarityFromPhase(phase)
  if (polarity === 'hold') {
    return {
      system: 'runes',
      camp: 'draw',
      weight: LEAGUE_VOTE_WEIGHTS.runes,
      ...gyeolbeon(LEAGUE_UNREADABLE.runes),
    }
  }
  return {
    system: 'runes',
    camp: 'draw',
    weight: LEAGUE_VOTE_WEIGHTS.runes,
    vote: mapPolarity(polarity, axis),
    abstained: false,
    unreadableCode: null,
    source: stave.reversed ? 'runes.future.reversed' : 'runes.future.upright',
    appliedWeight: LEAGUE_VOTE_WEIGHTS.runes,
    monthModifier: null,
  }
}

export type TaeilElementPolarity = 'support' | 'oppose' | 'neutral'

/**
 * 일진/월건 vs 용신. 생 (either direction) / 비화 → support, 극 (either
 * direction) → oppose. 오행 상생상극 always yields one of those five
 * relations — `neutral` is the leftover path and should not fire.
 */
export function taeilElementPolarity(actor: FiveElement, yongshen: FiveElement): TaeilElementPolarity {
  const rel = elementPairRelation(actor, yongshen)
  if (rel === 'same' || rel === 'a_generates_b' || rel === 'b_generates_a') return 'support'
  if (rel === 'a_overcomes_b' || rel === 'b_overcomes_a') return 'oppose'
  return 'neutral'
}

/**
 * 택일, never 명리: 일진 지지 vs the category 용신 오행 decides the ballot.
 * 월건 is context — it agrees or opposes 일진 and scales applied weight.
 * It does not veto 일진 into 결번.
 *
 * Treating 설기 (용신 생 일진) as support is PRODUCT — classical 택일 would
 * often call that a leak. 택일 abstains only when 일진 itself is neutral
 * toward the 용신 (neither 생/비화 nor 극).
 *
 * yinYang on the category bucket is not consulted (that would be 십신).
 */
export function voteTaeil(
  pillars: FourPillars,
  yongshen: LeagueTaeilYongshen,
  axis: LeagueBallotAxis,
): LeagueSystemVote {
  const day = taeilElementPolarity(pillars.day.branch.element, yongshen.element)
  if (day === 'neutral') {
    return {
      system: 'taeil',
      camp: 'timing',
      weight: LEAGUE_VOTE_WEIGHTS.taeil,
      ...gyeolbeon(LEAGUE_UNREADABLE.taeil),
    }
  }
  const month = taeilElementPolarity(pillars.month.branch.element, yongshen.element)
  const monthModifier: 'agree' | 'oppose' = month === 'neutral' || month === day ? 'agree' : 'oppose'
  const appliedWeight =
    monthModifier === 'oppose'
      ? LEAGUE_VOTE_WEIGHTS.taeil * TAEIL_MONTH_OPPOSE_FACTOR
      : LEAGUE_VOTE_WEIGHTS.taeil
  return {
    system: 'taeil',
    camp: 'timing',
    weight: LEAGUE_VOTE_WEIGHTS.taeil,
    vote: mapPolarity(day === 'support' ? 'plus' : 'minus', axis),
    abstained: false,
    unreadableCode: null,
    source: day === 'support' ? 'taeil.day.support' : 'taeil.day.oppose',
    appliedWeight,
    monthModifier,
  }
}
