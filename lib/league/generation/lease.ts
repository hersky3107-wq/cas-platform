/**
 * Shared PostgREST predicates for the oracle-style lease claim.
 * Used by league_generation_jobs AND league_deep_runs — one filter, two tables.
 */

/** `lease_until IS NULL OR lease_until < now` (oracle store verbatim). */
export function freeLeaseFilter(nowIso: string): string {
  return `lease_until.is.null,lease_until.lt.${nowIso}`
}

/**
 * `busy_until IS NULL OR busy_until < now`. Deep rows still carry the 280s
 * HTTP lock from pre-runner hops. The sweeper must not claim a row whose
 * HTTP hop is still inside that window, or it would race a live request.
 */
export function freeBusyFilter(nowIso: string): string {
  return `busy_until.is.null,busy_until.lt.${nowIso}`
}
