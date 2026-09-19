/**
 * Per-system binary votes for the league scope only.
 *
 * Hold in TAROT_MAJOR_PHASE / TAROT_MINOR_RANK_PHASE / RUNE_PHASE, and a
 * 택일 일진-vs-월건 split, is a 결번 (말을 아킴): the system abstains and
 * never inherits 육효. PRODUCT rule, not doctrine — the oracle 3-way axis
 * keeps `hold`.
 */
import { elementPairRelation } from '../engines/calendar/relations'
import type { FiveElement } from '../engines/calendar/types'
import type { FourPillars } from '../engines/calendar'
import type { RuneDrawn, TarotDrawnCard } from '../engines/draw'
import { TAROT_MAJOR_PHASE, TAROT_MINOR_RANK_PHASE, RUNE_PHASE } from '../axes/tables'
import type { PhaseAxis } from '../axes/types'
import { LEAGUE_RUNE_BALLOT_LABEL, LEAGUE_TAROT_BALLOT_LABEL, LEAGUE_VOTE_WEIGHTS } from './conventions'
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
  }
}

function elementSupport(actor: FiveElement, yongshen: FiveElement): 'support' | 'oppose' {
  const rel = elementPairRelation(actor, yongshen)
  if (rel === 'same' || rel === 'a_generates_b' || rel === 'b_generates_a') return 'support'
  return 'oppose'
}

/**
 * 택일, never 명리: 일진 지지 and 월건 지지 vs the category 용신 오행.
 * 생 (either direction) / 비화 → plus, 극 (either direction) → minus.
 *
 * Treating 설기 (용신 생 일진) as support is PRODUCT — classical 택일 would
 * often call that a leak. Disagreement between 일진 and 월건 is a 결번
 * (말을 아킴). It does not inherit 육효.
 *
 * yinYang on the category bucket is not consulted (that would be 십신).
 */
export function voteTaeil(
  pillars: FourPillars,
  yongshen: LeagueTaeilYongshen,
  axis: LeagueBallotAxis,
): LeagueSystemVote {
  const day = elementSupport(pillars.day.branch.element, yongshen.element)
  const month = elementSupport(pillars.month.branch.element, yongshen.element)
  if (day !== month) {
    return {
      system: 'taeil',
      camp: 'timing',
      weight: LEAGUE_VOTE_WEIGHTS.taeil,
      ...gyeolbeon(LEAGUE_UNREADABLE.taeil),
    }
  }
  return {
    system: 'taeil',
    camp: 'timing',
    weight: LEAGUE_VOTE_WEIGHTS.taeil,
    vote: mapPolarity(day === 'support' ? 'plus' : 'minus', axis),
    abstained: false,
    unreadableCode: null,
    source: day === 'support' ? 'taeil.day_and_month.support' : 'taeil.day_and_month.oppose',
  }
}
