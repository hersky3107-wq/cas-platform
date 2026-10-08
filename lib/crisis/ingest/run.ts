import type { SupabaseClient } from '@supabase/supabase-js'
import { nextBudgetCursor } from './budget'
import { missingEnv, redactSecrets } from './fetch'
import type { CrisisSource, IngestContext, IngestStateRow, IngestStatus } from './types'
import { insertAdvisoryHistory, upsertAdvisories, upsertDaily, upsertForecasts, upsertMetrics, upsertSignals } from './upsert'

const inflight = new Set<string>()

export interface RunOptions {
  dryRun?: boolean
  force?: boolean
  now?: Date
  log?: (message: string) => void
}

export interface RunSummary {
  source: string
  status: IngestStatus
  rowsIn: number
  rowsWritten: number
  httpCalls: number
  billedCalls: number
  quotaNote: string | null
  error: string | null
  skipped: boolean
}

export async function loadState(client: SupabaseClient, key: string): Promise<IngestStateRow | null> {
  const { data, error } = await client.from('crisis_ingest_state').select('*').eq('source', key).maybeSingle()
  if (error) throw new Error(`crisis_ingest_state: ${error.message}`)
  return (data as IngestStateRow | null) ?? null
}

export function isDue(state: IngestStateRow | null, now: Date, force: boolean): boolean {
  if (force) return true
  if (!state?.next_due_at) return true
  return new Date(state.next_due_at).getTime() <= now.getTime()
}

export async function runSource(
  source: CrisisSource,
  client: SupabaseClient,
  options: RunOptions = {},
): Promise<RunSummary> {
  const now = options.now ?? new Date()
  const dryRun = Boolean(options.dryRun)
  const log = options.log ?? ((message: string) => console.log(message))
  const empty: RunSummary = {
    source: source.key,
    status: 'skipped',
    rowsIn: 0,
    rowsWritten: 0,
    httpCalls: 0,
    billedCalls: 0,
    quotaNote: null,
    error: null,
    skipped: true,
  }

  if (inflight.has(source.key)) {
    return { ...empty, error: 'already running in this process' }
  }

  const missing = source.requiredEnv?.length ? missingEnv(source.requiredEnv, process.env) : null
  if (missing) {
    const summary: RunSummary = { ...empty, status: 'skipped', error: missing, quotaNote: missing }
    if (!dryRun) await finishRun(client, source, summary, now, null)
    else log(`[${source.key}] skipped: ${missing}`)
    return summary
  }

  inflight.add(source.key)
  const started = new Date()
  let runId: number | null = null
  try {
    const state = dryRun ? null : await loadState(client, source.key)
    if (!dryRun && !isDue(state, now, Boolean(options.force))) {
      return { ...empty, error: 'not due', quotaNote: `next_due_at=${state?.next_due_at}` }
    }

    if (!dryRun) {
      const { data, error } = await client
        .from('crisis_ingest_runs')
        .insert({ source: source.key, started_at: started.toISOString(), status: 'ok', rows_in: 0, rows_written: 0, http_calls: 0 })
        .select('id')
        .single()
      if (error) throw new Error(`crisis_ingest_runs insert: ${error.message}`)
      runId = Number(data.id)
    }

    const ctx: IngestContext = { now, dryRun, env: process.env, log, client }
    const result = await source.fetch(ctx)
    const signals = result.signals ?? []
    const metrics = result.metrics ?? []
    const forecasts = result.forecasts ?? []
    const daily = result.daily ?? []
    const advisories = result.advisories ?? []
    const advisoryHistory = result.advisoryHistory ?? []
    const rowsIn = result.reportedRows
      ?? signals.length + metrics.length + forecasts.length + daily.length + advisories.length + advisoryHistory.length
    let rowsWritten = 0

    if (!dryRun) {
      if (signals.length) rowsWritten += await upsertSignals(client, signals)
      if (metrics.length) rowsWritten += await upsertMetrics(client, metrics)
      if (forecasts.length) rowsWritten += await upsertForecasts(client, forecasts)
      if (daily.length) rowsWritten += await upsertDaily(client, daily)
      if (advisories.length) rowsWritten += await upsertAdvisories(client, advisories)
      if (advisoryHistory.length) rowsWritten += await insertAdvisoryHistory(client, advisoryHistory)
    }

    let status: IngestStatus = 'ok'
    if (result.skipped) status = 'skipped'
    else if (result.error) status = rowsWritten > 0 || rowsIn > 0 ? 'partial' : 'error'
    else if ((result.unmatched?.length ?? 0) > 0) status = 'partial'
    else if (result.quotaNote && /budget|cap|stop/i.test(result.quotaNote) && rowsIn > 0) status = 'partial'

    const summary: RunSummary = {
      source: source.key,
      status,
      rowsIn,
      rowsWritten: dryRun ? 0 : rowsWritten,
      httpCalls: result.httpCalls,
      billedCalls: result.billedCalls ?? 0,
      quotaNote: result.quotaNote ?? (result.unmatched?.length ? `${result.unmatched.length} unmatched` : null),
      error: result.error ? redactSecrets(result.error) : result.skipped ?? null,
      skipped: status === 'skipped',
    }

    if (dryRun) {
      log(
        `[${source.key}] dry-run status=${status} in=${rowsIn} http=${summary.httpCalls} billed=${summary.billedCalls}` +
          (summary.quotaNote ? ` note=${summary.quotaNote}` : '') +
          (summary.error ? ` error=${summary.error}` : ''),
      )
      return summary
    }

    const budget = nextBudgetCursor(state?.cursor ?? null, now, summary.billedCalls)
    const cursor = { ...(state?.cursor ?? {}), ...budget, ...(result.cursor ?? {}) }
    await finishRun(client, source, summary, now, cursor, runId, started)
    return summary
  } catch (error) {
    const message = redactSecrets(error instanceof Error ? error.message : String(error))
    const summary: RunSummary = { ...empty, status: 'error', error: message, skipped: false }
    if (!dryRun) await finishRun(client, source, summary, now, null, runId, started)
    else log(`[${source.key}] error: ${message}`)
    return summary
  } finally {
    inflight.delete(source.key)
  }
}

async function finishRun(
  client: SupabaseClient,
  source: CrisisSource,
  summary: RunSummary,
  now: Date,
  cursor: Record<string, unknown> | null,
  runId?: number | null,
  started?: Date,
): Promise<void> {
  const finished = new Date()
  if (runId != null) {
    await client
      .from('crisis_ingest_runs')
      .update({
        finished_at: finished.toISOString(),
        status: summary.status,
        rows_in: summary.rowsIn,
        rows_written: summary.rowsWritten,
        http_calls: summary.httpCalls,
        quota_note: summary.quotaNote,
        error: summary.error,
      })
      .eq('id', runId)
  } else {
    await client.from('crisis_ingest_runs').insert({
      source: source.key,
      started_at: (started ?? now).toISOString(),
      finished_at: finished.toISOString(),
      status: summary.status,
      rows_in: summary.rowsIn,
      rows_written: summary.rowsWritten,
      http_calls: summary.httpCalls,
      quota_note: summary.quotaNote,
      error: summary.error,
    })
  }

  const nextDue = new Date(now.getTime() + source.scheduleMinutes * 60_000).toISOString()
  const statePatch: Record<string, unknown> = {
    source: source.key,
    next_due_at: nextDue,
  }
  if (cursor) statePatch.cursor = cursor
  if (summary.status === 'ok' || summary.status === 'partial') {
    statePatch.last_success_at = now.toISOString()
  }
  await client.from('crisis_ingest_state').upsert(statePatch, { onConflict: 'source' })
}

