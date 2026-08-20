/**
 * Layer-2 ballot tally, written into oracle_consensus at finalize.
 *
 * This counts READER ballots, which is a different question from the axis
 * layer's phase tally (that one counts SYSTEMS). Like the phase consensus,
 * it publishes counts rather than a verdict label — see the comment on
 * PhaseConsensus in axes/types.ts for why a headline is not available here
 * either.
 */
import { PHASE_AXES, type PhaseAxis } from '../axes/types'
import type { OracleVerdict } from '../schema'
import type { JsonObject } from './types'

export type BallotTally = {
  counts: Record<PhaseAxis, number>
  /** Null when nobody cast a readable ballot. */
  leader: PhaseAxis | null
  leaderCount: number
  /** Readers whose ballot was counted. */
  participantCount: number
  /** Readers on the roster who produced nothing (error / timeout / no ballot). */
  abstained: string[]
  /** True only when every counted ballot names the same axis, and there is more than one. */
  unanimous: boolean
}

function readPhase(ballot: OracleVerdict['ballot']): PhaseAxis | null {
  if (!ballot || typeof ballot !== 'object') return null
  const raw = (ballot as Record<string, unknown>).phase
  if (typeof raw !== 'string') return null
  return (PHASE_AXES as readonly string[]).includes(raw) ? (raw as PhaseAxis) : null
}

export function tallyBallots(verdicts: readonly OracleVerdict[]): BallotTally {
  const counts: Record<PhaseAxis, number> = { advance: 0, hold: 0, release: 0 }
  const abstained: string[] = []
  let participantCount = 0

  for (const verdict of verdicts) {
    const phase = verdict.status === 'done' ? readPhase(verdict.ballot) : null
    if (phase === null) {
      abstained.push(verdict.reader_slug)
      continue
    }
    counts[phase] += 1
    participantCount += 1
  }

  let leader: PhaseAxis | null = null
  let leaderCount = 0
  for (const axis of PHASE_AXES) {
    if (counts[axis] > leaderCount) {
      leader = axis
      leaderCount = counts[axis]
    }
  }

  return {
    counts,
    leader,
    leaderCount,
    participantCount,
    abstained,
    unanimous: participantCount > 1 && leaderCount === participantCount,
  }
}

export function ballotTallyJson(tally: BallotTally): JsonObject {
  return {
    counts: tally.counts,
    leader: tally.leader,
    leaderCount: tally.leaderCount,
    participantCount: tally.participantCount,
    abstained: tally.abstained,
    unanimous: tally.unanimous,
  }
}
