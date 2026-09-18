/**
 * Layer-2 ballot tally, written into oracle_consensus at finalize.
 *
 * This counts SEER ballots, which is a different question from the axis
 * layer's phase tally (that one counts SYSTEMS). Like the phase consensus,
 * it publishes counts rather than a verdict label — see the comment on
 * PhaseConsensus in axes/types.ts for why a headline is not available here
 * either.
 *
 * Tallying is done HERE, in code, never by an AI. A seer casts one ballot
 * (direction / focus / five domain scores); this module counts directions,
 * counts focus votes, and averages domains. The result screen derives the
 * for-against split and the minority seats from these counts plus the
 * per-verdict rows.
 */
import { PHASE_AXES, type PhaseAxis } from '../axes/types'
import { matchChoiceOption, type QuestionClassification } from '../question-axis'
import type { OracleVerdict } from '../schema'
import type { JsonObject } from './types'

export const BALLOT_FOCI = ['work', 'money', 'love', 'social', 'energy'] as const
export type BallotFocus = (typeof BALLOT_FOCI)[number]

export type BallotTally = {
  counts: Record<PhaseAxis, number>
  /** Null when nobody cast a readable ballot. */
  leader: PhaseAxis | null
  leaderCount: number
  /** Seers whose ballot was counted. */
  participantCount: number
  /** Seers on the roster who produced nothing (error / timeout / no ballot). */
  abstained: string[]
  /** True only when every counted ballot names the same direction, and there is more than one. */
  unanimous: boolean
  /** Focus votes across counted ballots. */
  focusCounts: Record<BallotFocus, number>
  /** Mean domain score (one decimal) across ballots that carried valid domains; null when none did. */
  domainMeans: Record<BallotFocus, number | null>
  /** Seers whose counted direction differs from the leader. Empty when unanimous or leaderless. */
  minoritySlugs: string[]
  /** action (incl. none/defaulted) | prediction | choice. Compat stays action here. */
  questionKind: 'action' | 'prediction' | 'choice'
  options?: string[]
  optionCounts?: Record<string, number>
  optionLeader?: string | null
}

function readOption(ballot: OracleVerdict['ballot'], options: readonly string[]): string | null {
  if (!ballot || typeof ballot !== 'object') return null
  const raw = (ballot as Record<string, unknown>).option
  return typeof raw === 'string' ? matchChoiceOption(raw, options) : null
}

function readDirection(ballot: OracleVerdict['ballot']): PhaseAxis | null {
  if (!ballot || typeof ballot !== 'object') return null
  const record = ballot as Record<string, unknown>
  // 'phase' is the legacy stub key; live ballots write 'direction'.
  const raw = record.direction ?? record.phase
  if (typeof raw !== 'string') return null
  return (PHASE_AXES as readonly string[]).includes(raw) ? (raw as PhaseAxis) : null
}

function readFocus(ballot: OracleVerdict['ballot']): BallotFocus | null {
  if (!ballot || typeof ballot !== 'object') return null
  const raw = (ballot as Record<string, unknown>).focus
  if (typeof raw !== 'string') return null
  return (BALLOT_FOCI as readonly string[]).includes(raw) ? (raw as BallotFocus) : null
}

function readDomains(ballot: OracleVerdict['ballot']): Record<BallotFocus, number> | null {
  if (!ballot || typeof ballot !== 'object') return null
  const raw = (ballot as Record<string, unknown>).domains
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const record = raw as Record<string, unknown>
  const out = {} as Record<BallotFocus, number>
  for (const domain of BALLOT_FOCI) {
    const value = record[domain]
    if (typeof value !== 'number' || !Number.isFinite(value)) return null
    out[domain] = value
  }
  return out
}

function emptyFocusAndDomains() {
  const focusCounts: Record<BallotFocus, number> = { work: 0, money: 0, love: 0, social: 0, energy: 0 }
  const domainSums: Record<BallotFocus, number> = { work: 0, money: 0, love: 0, social: 0, energy: 0 }
  return { focusCounts, domainSums }
}

export function tallyBallots(
  verdicts: readonly OracleVerdict[],
  axis?: QuestionClassification,
): BallotTally {
  const questionKind = axis?.kind === 'prediction' ? 'prediction' : axis?.kind === 'choice' ? 'choice' : 'action'
  const { focusCounts, domainSums } = emptyFocusAndDomains()
  let domainVoters = 0
  const recordFocusAndDomains = (ballot: OracleVerdict['ballot']) => {
    const focus = readFocus(ballot)
    if (focus) focusCounts[focus] += 1
    const domains = readDomains(ballot)
    if (domains) {
      domainVoters += 1
      for (const domain of BALLOT_FOCI) domainSums[domain] += domains[domain]
    }
  }

  const domainMeans = {} as Record<BallotFocus, number | null>

  if (questionKind === 'choice' && axis && axis.options.length >= 2) {
    const optionCounts: Record<string, number> = Object.fromEntries(axis.options.map((option) => [option, 0]))
    const abstained: string[] = []
    const counted: Array<{ slug: string; option: string }> = []
    for (const verdict of verdicts) {
      const option = verdict.status === 'done' ? readOption(verdict.ballot, axis.options) : null
      if (!option) {
        abstained.push(verdict.reader_slug)
        continue
      }
      optionCounts[option] = (optionCounts[option] ?? 0) + 1
      counted.push({ slug: verdict.reader_slug, option })
      recordFocusAndDomains(verdict.ballot)
    }
    let optionLeader: string | null = null
    let leaderCount = 0
    for (const option of axis.options) {
      const n = optionCounts[option] ?? 0
      if (n > leaderCount) {
        optionLeader = option
        leaderCount = n
      }
    }
    for (const domain of BALLOT_FOCI) {
      domainMeans[domain] =
        domainVoters > 0 ? Math.round((domainSums[domain] / domainVoters) * 10) / 10 : null
    }
    const participantCount = counted.length
    return {
      counts: { advance: 0, hold: 0, release: 0 },
      leader: null,
      leaderCount,
      participantCount,
      abstained,
      unanimous: participantCount > 1 && leaderCount === participantCount,
      focusCounts,
      domainMeans,
      minoritySlugs:
        optionLeader === null
          ? []
          : counted.filter((row) => row.option !== optionLeader).map((row) => row.slug),
      questionKind,
      options: axis.options,
      optionCounts,
      optionLeader,
    }
  }

  const counts: Record<PhaseAxis, number> = { advance: 0, hold: 0, release: 0 }
  const abstained: string[] = []
  const counted: Array<{ slug: string; direction: PhaseAxis }> = []

  for (const verdict of verdicts) {
    const direction = verdict.status === 'done' ? readDirection(verdict.ballot) : null
    if (direction === null) {
      abstained.push(verdict.reader_slug)
      continue
    }
    counts[direction] += 1
    counted.push({ slug: verdict.reader_slug, direction })
    recordFocusAndDomains(verdict.ballot)
  }

  let leader: PhaseAxis | null = null
  let leaderCount = 0
  for (const phase of PHASE_AXES) {
    if (counts[phase] > leaderCount) {
      leader = phase
      leaderCount = counts[phase]
    }
  }

  for (const domain of BALLOT_FOCI) {
    domainMeans[domain] =
      domainVoters > 0 ? Math.round((domainSums[domain] / domainVoters) * 10) / 10 : null
  }

  const participantCount = counted.length
  return {
    counts,
    leader,
    leaderCount,
    participantCount,
    abstained,
    unanimous: participantCount > 1 && leaderCount === participantCount,
    focusCounts,
    domainMeans,
    minoritySlugs:
      leader === null ? [] : counted.filter((row) => row.direction !== leader).map((row) => row.slug),
    questionKind,
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
    focusCounts: tally.focusCounts,
    domainMeans: tally.domainMeans,
    minoritySlugs: tally.minoritySlugs,
    questionKind: tally.questionKind,
    ...(tally.options ? { options: tally.options } : {}),
    ...(tally.optionCounts ? { optionCounts: tally.optionCounts } : {}),
    ...(tally.optionLeader !== undefined ? { optionLeader: tally.optionLeader } : {}),
  }
}
