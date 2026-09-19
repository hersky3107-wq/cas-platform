/**
 * 결번 / 말을 아킴 — same shape as oracle: a system that produced no
 * direction is a blank seat, not a silent copy of another ballot.
 */
import type { LeagueBinaryVote, LeagueSystemVote } from './types'

export const LEAGUE_GYEOLBEON = '결번' as const
export const LEAGUE_ABSTAIN_LABEL = '말을 아낌' as const
export const LEAGUE_VOTED_LABEL = '표를 냄' as const

export const LEAGUE_UNREADABLE = {
  tarot: 'tarot.hold_no_direction',
  runes: 'runes.hold_no_direction',
  taeil: 'taeil.day_month_split_no_direction',
  astro: 'horary_judgment_not_implemented',
  ninestar: 'five_yellow_and_auspicious_direction_not_implemented',
} as const

export const LEAGUE_ABSTAIN_REASON_KO: Record<string, string> = {
  [LEAGUE_UNREADABLE.tarot]: '결과 패 표가 방향을 주지 않았다',
  [LEAGUE_UNREADABLE.runes]: '미래 룬 표가 방향을 주지 않았다',
  [LEAGUE_UNREADABLE.taeil]: '일진과 월건이 갈려 방향을 주지 않았다',
  [LEAGUE_UNREADABLE.astro]: '호라리 판단이 없어 방향을 주지 않았다',
  [LEAGUE_UNREADABLE.ninestar]: '오황살·길방이 없어 방향을 주지 않았다',
}

export type LeagueSystemPresence = {
  ballot: LeagueBinaryVote | null
  status: 'voted' | typeof LEAGUE_GYEOLBEON
  statusLabel: typeof LEAGUE_VOTED_LABEL | typeof LEAGUE_ABSTAIN_LABEL
  reason: string | null
  unreadableCode: string | null
}

export function presenceVoted(ballot: LeagueBinaryVote): LeagueSystemPresence {
  return {
    ballot,
    status: 'voted',
    statusLabel: LEAGUE_VOTED_LABEL,
    reason: null,
    unreadableCode: null,
  }
}

export function presenceGyeolbeon(unreadableCode: string): LeagueSystemPresence {
  return {
    ballot: null,
    status: LEAGUE_GYEOLBEON,
    statusLabel: LEAGUE_ABSTAIN_LABEL,
    reason: LEAGUE_ABSTAIN_REASON_KO[unreadableCode] ?? '표가 방향을 주지 않았다',
    unreadableCode,
  }
}

export function presenceFromVote(vote: LeagueSystemVote): LeagueSystemPresence {
  if (vote.vote === null) return presenceGyeolbeon(vote.unreadableCode ?? vote.source)
  return presenceVoted(vote.vote)
}

export function hasBallot(
  vote: LeagueSystemVote,
): vote is LeagueSystemVote & { vote: LeagueBinaryVote } {
  return vote.vote !== null
}
