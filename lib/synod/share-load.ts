/**
 * SYNOD — shared load-assembly logic.
 *
 * These pure mappers turn raw DB rows (synod_turns / synod_rounds /
 * synod_session_results) into the plain objects consumed by:
 *   - the authenticated `load` action in app/api/synod/route.ts (resume), and
 *   - the public share page at app/share/[share_id]/page.tsx.
 *
 * Extracted from route.ts as a PURE refactor: the shapes produced here are
 * byte-for-byte identical to what the load action emitted inline. Do NOT change
 * field names/shapes without updating both callers.
 *
 * NOTE: the load turn shape (`SynodLoadTurn`) intentionally differs from
 * build-memory's `SynodTurn`: it carries the raw provider key in `ai` (not a
 * brand `aiName`) plus `ms`, and uses null instead of undefined. Callers that
 * want brand names map `ai` → BRAND themselves.
 *
 * All functions are PURE: no DB calls, no network, no logging, no mutation.
 */

import type { FacilitatorSummary } from '@/lib/synod/build-memory'

/** Loosely-typed DB row (the SYNOD supabase client is untyped). */
type Row = Record<string, unknown>

/** One debater turn as emitted by the load action / share page. */
export type SynodLoadTurn = {
  roundNumber: number
  /** Raw provider key (e.g. "openai"), NOT a brand label. */
  ai: string
  actionTag: string | null
  claim: string | null
  content: string
  isRedTeam: boolean
  ms: number | null
}

/** One facilitator round: the rebuilt summary plus its red-team flag. */
export type SynodLoadRound = {
  roundNumber: number
  summary: FacilitatorSummary
  challengeMissing: boolean
}

/** Final verdict payload. */
export type SynodResult = {
  verdict: string
  /** Raw minority-report entries as stored (shape not enforced here). */
  minorityReport: unknown[]
  finalScore: number
}

/**
 * Rebuild a FacilitatorSummary from synod_rounds' SEPARATE columns.
 *
 * synod_rounds intentionally stores the summary as separate columns (not one
 * JSONB) for later data-mining queries — this reconstructs the in-memory type.
 * Returns null when the row is missing the minimum required fields.
 */
export function coerceFacilitatorSummary(
  obj: Record<string, unknown>,
  roundNumber: number
): FacilitatorSummary | null {
  const consensusRaw = Array.isArray(obj.consensusPoints) ? obj.consensusPoints : null
  const issuesRaw = Array.isArray(obj.openIssues) ? obj.openIssues : null
  const score = Number(obj.roundConsensusScore)
  const directive = typeof obj.nextDirective === 'string' ? obj.nextDirective : ''
  if (!consensusRaw || !issuesRaw || !Number.isFinite(score)) return null

  const consensusPoints: FacilitatorSummary['consensusPoints'] = []
  for (const item of consensusRaw) {
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    if (typeof o.point !== 'string') continue
    const agreedBy = Array.isArray(o.agreedBy)
      ? o.agreedBy.filter((x): x is string => typeof x === 'string')
      : []
    consensusPoints.push({ point: o.point, agreedBy })
  }

  const openIssues: FacilitatorSummary['openIssues'] = []
  for (const item of issuesRaw) {
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    if (typeof o.issue !== 'string') continue
    const positions = Array.isArray(o.positions)
      ? o.positions
          .filter((p): p is Record<string, unknown> => !!p && typeof p === 'object')
          .map((p) => ({
            ai: typeof p.ai === 'string' ? p.ai : 'unknown',
            stance: typeof p.stance === 'string' ? p.stance : '',
          }))
      : []
    openIssues.push({ issue: o.issue, positions })
  }

  return {
    roundNumber,
    consensusPoints,
    openIssues,
    roundConsensusScore: Math.max(0, Math.min(100, Math.round(score))),
    nextDirective: directive,
  }
}

/** Map synod_turns rows → ordered debater turns (caller controls row order). */
export function mapSynodTurns(rows: readonly Row[] | null | undefined): SynodLoadTurn[] {
  return (rows ?? []).map((row) => ({
    roundNumber: Number(row.round_number),
    ai: String(row.ai_name),
    actionTag: typeof row.action_tag === 'string' ? row.action_tag : null,
    claim: typeof row.claim === 'string' ? row.claim : null,
    content: String(row.content ?? ''),
    isRedTeam: row.is_red_team === true,
    ms: typeof row.ms === 'number' ? row.ms : null,
  }))
}

/** Map synod_rounds rows → facilitator rounds, dropping any unrebuildable row. */
export function mapSynodRounds(rows: readonly Row[] | null | undefined): SynodLoadRound[] {
  return (rows ?? [])
    .map((row) => {
      const summary = coerceFacilitatorSummary(
        {
          consensusPoints: row.consensus_points,
          openIssues: row.open_issues,
          roundConsensusScore: row.round_consensus_score,
          nextDirective: row.next_directive,
        },
        Number(row.round_number)
      )
      if (!summary) return null
      return {
        roundNumber: summary.roundNumber,
        summary,
        challengeMissing: row.challenge_missing === true,
      }
    })
    .filter((x): x is SynodLoadRound => x !== null)
}

/** Map the single synod_session_results row → result, or null when absent. */
export function mapSynodResult(row: Row | null | undefined): SynodResult | null {
  return row
    ? {
        verdict: String(row.verdict ?? ''),
        minorityReport: Array.isArray(row.minority_report) ? row.minority_report : [],
        finalScore: typeof row.final_score === 'number' ? row.final_score : 0,
      }
    : null
}

/**
 * Assemble a full SYNOD session view from the three DB result sets. Callers run
 * the (unchanged) DB selects, then hand the raw `.data` here.
 */
export function assembleSynodSession(input: {
  turnsRows: readonly Row[] | null | undefined
  roundsRows: readonly Row[] | null | undefined
  resultRow: Row | null | undefined
}): {
  turns: SynodLoadTurn[]
  rounds: SynodLoadRound[]
  result: SynodResult | null
} {
  return {
    turns: mapSynodTurns(input.turnsRows),
    rounds: mapSynodRounds(input.roundsRows),
    result: mapSynodResult(input.resultRow),
  }
}
