export type LeagueDeepSource = {
  id: string
  label: string
  ok: boolean
  text: string
}

export type LeagueDeepSnapshot = {
  ok: boolean
  sources: LeagueDeepSource[]
}

export type LeagueDeepRole = {
  roleId: string
  roleLabel: string
  mandate: string
  provider: string
  subQuestion?: string
  isDoubledAngle?: boolean
  doubledGroupId?: string
  isRedTeam?: boolean
}

export type LeagueOpenMeetingPlan = {
  ok: boolean
  question: string
  roles: LeagueDeepRole[]
  rationale: string
  primaryAngleId: string
  searchNeeded: false
  error?: string
}

export type LeagueOpenAnalysis = {
  roleId: string
  roleLabel: string
  provider: string
  subQuestion: string
  isDoubledAngle: boolean
  ok: boolean
  analysis: string | null
  error?: string
}

export type LeagueDebateMeetingPlan = {
  ok: boolean
  question: string
  roles: LeagueDeepRole[]
  rationale: string
  error?: string
}

export type LeagueDeliberationTurn = {
  roleId: string
  roleLabel: string
  provider: string
  isRedTeam: boolean
  ok: boolean
  position: string | null
  concedes: string | null
  holds: string | null
  error?: string
}

export type LeagueRoundResult = {
  roundNumber: number
  turns: LeagueDeliberationTurn[]
  consensusScore: number
  agreedPoints: string[]
  contestedPoints: string[]
  summary: string
  ok: boolean
  error?: string
}

export type LeagueDeliberationStopReason = 'target_reached' | 'stalled' | 'max_rounds' | 'error'

export type LeagueDeliberation = {
  rounds: LeagueRoundResult[]
  finalScore: number
  roundsRun: number
  stoppedReason: LeagueDeliberationStopReason
  agreedPoints: string[]
  contestedPoints: string[]
  summary: string
  ok: boolean
  error?: string
}

export type LeagueVoteChoice = 'approve' | 'oppose' | 'conditional' | 'abstain'

export type LeagueVote = {
  provider: string
  ok: boolean
  choice: LeagueVoteChoice | null
  reason: string | null
  error?: string
}

export type LeagueVoteResult = {
  votes: LeagueVote[]
  approveCount: number
  conditionalCount: number
  opposeCount: number
  abstainCount: number
  summary: string
  ok: boolean
}

export type LeagueChairVerdict = {
  ok: boolean
  judgment: string | null
  keyIssues: string | null
  minorityReport: string | null
  consensusScore: number
  error?: string
}

export type LeaguePreReport = {
  ok: boolean
  report: string | null
  error?: string
}

export const LEAGUE_CONSENSUS_UNAVAILABLE = -1
export const LEAGUE_DELIBERATION_MIN_ROUNDS = 2
export const LEAGUE_DELIBERATION_MAX_ROUNDS = 2
export const LEAGUE_CONSENSUS_TARGET = 85
export const LEAGUE_STALL_DELTA = 4
