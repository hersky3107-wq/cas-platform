/**
 * Read-only session view for the polling loop.
 *
 * Never mutates anything and takes no credits port — polling a session,
 * including a finished one, costs zero credits. That is structural here, not
 * a rule someone has to remember: this module has no way to charge.
 *
 * `model` is stripped from readings and verdicts (server-only, per the
 * column comments in the migration). `ai_payload` is omitted because it is
 * prompt-internal. A recursively sanitized projection of `result` is exposed
 * as `calculation` so the owner can see the engine chart without profile PII.
 */
import type {
  OracleJobProgress,
  OracleJobSession,
  OracleNextAction,
  OracleSessionStatus,
} from '../schema'
import { progressCounts } from './progress'
import { publicComputation } from './public-computation'
import type { JsonObject, RunnerStore } from './types'

export type PublicReading = {
  system: string
  brand: string
  narrative: string | null
  summary: JsonObject | null
  status: string | null
  latencyMs: number | null
}

export type PublicVerdict = {
  readerSlug: string
  brand: string
  verdictLine: string | null
  ballot: JsonObject | null
  dissent: string | null
  fullText: string | null
  status: string | null
  latencyMs: number | null
}

export type PublicConsensus = {
  systemAgreement: JsonObject | null
  ballotTally: JsonObject | null
  domainStats: JsonObject | null
  unanimous: boolean | null
  deficiencyVector: JsonObject | null
  agreements: string[]
  divergences: string[]
  conclusion: string | null
  confidenceNote: string | null
  computedAt: string
}

function publicSynthesis(domainStats: JsonObject | null): {
  agreements: string[]
  divergences: string[]
  conclusion: string | null
  confidenceNote: string | null
} {
  const raw =
    domainStats && typeof domainStats.synthesis === 'object' && domainStats.synthesis !== null
      ? domainStats.synthesis as JsonObject
      : null
  return {
    agreements: Array.isArray(raw?.agreements)
      ? raw.agreements.filter((value): value is string => typeof value === 'string')
      : [],
    divergences: Array.isArray(raw?.divergences)
      ? raw.divergences.filter((value): value is string => typeof value === 'string')
      : [],
    conclusion: typeof raw?.conclusion === 'string' ? raw.conclusion : null,
    confidenceNote: typeof raw?.confidence_note === 'string' ? raw.confidence_note : null,
  }
}

export type OracleSessionView = {
  sessionId: string
  kind: string
  status: OracleSessionStatus
  nextAction: OracleNextAction | null
  progress: OracleJobProgress
  counts: { done: number; pending: number; failed: number; total: number }
  systems: string[]
  readerRoster: string[]
  locale: string | null
  createdAt: string
  completedAt: string | null
  /** True while a worker holds the lease; the client should keep polling. */
  working: boolean
  computations: Array<{
    system: string
    engineVersion: string | null
    axes: JsonObject | null
    calculation: JsonObject | null
    unreadable: boolean
  }>
  readings: PublicReading[]
  verdicts: PublicVerdict[]
  consensus: PublicConsensus | null
}

export async function readOracleSession(
  session: OracleJobSession,
  store: RunnerStore,
  now: Date = new Date(),
): Promise<OracleSessionView> {
  const [computations, readings, verdicts, consensus] = await Promise.all([
    store.listComputations(session.id),
    store.listReadings(session.id),
    store.listVerdicts(session.id),
    store.getConsensus(session.id),
  ])

  return {
    sessionId: session.id,
    kind: session.kind,
    status: session.status,
    nextAction: session.next_action,
    progress: session.progress,
    counts: progressCounts(session.progress),
    systems: session.systems,
    readerRoster: session.reader_roster,
    locale: session.locale,
    createdAt: session.created_at,
    completedAt: session.completed_at,
    working: session.lease_until !== null && new Date(session.lease_until).getTime() > now.getTime(),
    computations: computations.map(publicComputation),
    readings: readings.map((row) => ({
      system: row.system,
      brand: row.brand,
      narrative: row.narrative,
      summary: row.summary,
      status: row.status,
      latencyMs: row.latency_ms,
    })),
    verdicts: verdicts.map((row) => ({
      readerSlug: row.reader_slug,
      brand: row.brand,
      verdictLine: row.verdict_line,
      ballot: row.ballot,
      dissent: row.dissent,
      fullText: row.full_text,
      status: row.status,
      latencyMs: row.latency_ms,
    })),
    consensus: consensus
      ? {
          systemAgreement: consensus.system_agreement,
          ballotTally: consensus.ballot_tally,
          domainStats: consensus.domain_stats,
          unanimous: consensus.unanimous,
          deficiencyVector: consensus.deficiency_vector,
          ...publicSynthesis(consensus.domain_stats),
          computedAt: consensus.computed_at,
        }
      : null,
  }
}
