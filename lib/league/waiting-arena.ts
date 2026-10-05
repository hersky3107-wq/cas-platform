import { LEAGUE_JOB_SLOT_MINUTES } from './generation/policy'

/**
 * Remaining wait for a round already running. Uses the same 5-minute slot
 * as the queue ETA, scaled by seats that have not answered yet. Not a
 * measured duration.
 */
export function runningRemainingMinutes(answered: number, rosterSize: number): number | null {
  if (rosterSize <= 0) return null
  const left = Math.max(0, rosterSize - Math.max(0, answered))
  if (left === 0) return 0
  return Math.max(1, Math.ceil((left / rosterSize) * LEAGUE_JOB_SLOT_MINUTES))
}

/** That same remaining budget, split by how many seats this tier still owes. */
export function tierRemainingMinutes(
  tierUnanswered: number,
  totalUnanswered: number,
  roundRemaining: number | null,
): number | null {
  if (roundRemaining == null || roundRemaining <= 0) return null
  if (tierUnanswered <= 0 || totalUnanswered <= 0) return null
  return Math.max(1, Math.ceil(roundRemaining * (tierUnanswered / totalUnanswered)))
}

export function tickerTake(input: {
  name: string
  snippet: string | null | undefined
}): string | null {
  const snippet = input.snippet?.replace(/\s+/g, ' ').trim()
  if (!snippet) return null
  const short = snippet.length > 48 ? `${snippet.slice(0, 48).trim()}…` : snippet
  const name = input.name.trim()
  if (!name) return null
  return `${name}: ${short}`
}
