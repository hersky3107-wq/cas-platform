import { createHash } from 'node:crypto'
import type { EngineRunRecord } from './run'
import type { Hypothesis } from './schema'

export interface LedgerInsert {
  created_at: string
  region_ids: number[]
  stage: number
  confidence: 'low' | 'medium' | 'high'
  novelty: 'only_us' | 'also_seen_elsewhere'
  title: string
  body: string
  evidence_signal_ids: number[]
  evidence_snapshot: Record<string, unknown>
  ai_roster: unknown
}

export interface LedgerRow extends LedgerInsert {
  id: number
  prev_hash: string | null
  content_hash: string
}

/**
 * Same field order as crisis_hypotheses_before_insert.
 * The database trigger overwrites content_hash. This helper is the test double
 * and a preview. Postgres renders timestamptz and jsonb with its own text,
 * so a live row's hash is the trigger's, not this string.
 */
export function ledgerPayload(row: {
  prev_hash: string | null
  created_at: string
  region_ids: number[]
  stage: number
  confidence: string
  title: string
  body: string
  evidence_snapshot: unknown
}): string {
  return (
    (row.prev_hash ?? '') +
    row.created_at +
    `{${row.region_ids.join(',')}}` +
    String(row.stage) +
    row.confidence +
    row.title +
    row.body +
    JSON.stringify(row.evidence_snapshot)
  )
}

export function ledgerContentHash(row: Parameters<typeof ledgerPayload>[0]): string {
  return createHash('sha256').update(ledgerPayload(row)).digest('hex')
}

export function hypothesisBody(hypothesis: Hypothesis): string {
  const steps = hypothesis.what_to_do.map((line) => `- ${line}`).join('\n')
  const links = hypothesis.official_links.map((link) => `${link.label}: ${link.url}`).join('\n')
  return `${hypothesis.why_humans_miss}\n\nWhat to do:\n${steps}\n\nOfficial sources:\n${links}`
}

export function buildLedgerInserts(run: EngineRunRecord, indices: number[], createdAt: string): LedgerInsert[] {
  if (!run.result) throw new Error('run has no result to publish')
  if (run.status !== 'done' || run.dryRun) throw new Error('only a finished live run can be published')
  const all = [...run.result.headlines, ...run.result.missed_by_others]
  return indices.map((index) => {
    const hypothesis = all[index]
    if (!hypothesis) throw new Error(`hypothesis index ${index} is not on this run`)
    return {
      created_at: createdAt,
      region_ids: [run.regionId],
      stage: hypothesis.stage,
      confidence: hypothesis.confidence,
      novelty: hypothesis.novelty,
      title: hypothesis.title,
      body: hypothesisBody(hypothesis),
      evidence_signal_ids: [],
      evidence_snapshot: {
        card: run.card,
        search_urls: run.searchUrls,
        roster: run.roster,
        hypothesis,
      },
      ai_roster: run.roster,
    }
  })
}

export interface LedgerClient {
  latest(): Promise<LedgerRow | null>
  insert(row: LedgerInsert): Promise<LedgerRow>
}

/** Append-only. The caller must be the service role. Never invoked by runEngine. */
export async function publishHypotheses(client: LedgerClient, run: EngineRunRecord, indices: number[], now = new Date()): Promise<LedgerRow[]> {
  const inserts = buildLedgerInserts(run, indices, now.toISOString())
  const written: LedgerRow[] = []
  for (const insert of inserts) {
    written.push(await client.insert(insert))
  }
  return written
}

/** In-memory ledger that copies the trigger: lock is implied by sequential awaits, prev_hash chains, content_hash is overwritten. */
export function memoryLedger(): LedgerClient & { rows: LedgerRow[] } {
  const rows: LedgerRow[] = []
  return {
    rows,
    async latest() {
      return rows.at(-1) ?? null
    },
    async insert(row) {
      const prev = rows.at(-1)?.content_hash ?? null
      const stored: LedgerRow = {
        ...row,
        id: rows.length + 1,
        prev_hash: prev,
        content_hash: ledgerContentHash({ ...row, prev_hash: prev }),
      }
      rows.push(stored)
      return stored
    },
  }
}
