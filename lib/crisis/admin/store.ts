import type { SupabaseClient } from '@supabase/supabase-js'
import { applyMissingMessage } from './queue'
import { assembleTodayRegions } from './today'
import type { AdminRegion, QueueInsert, QueueRow, RiskFlagRow, StoredRegion } from './types'

const FLAG_PAGE = 1000
const QUEUE_LIMIT = 200

function asQueueRow(row: Record<string, unknown>): QueueRow {
  return {
    id: String(row.id),
    region_id: row.region_id == null ? null : Number(row.region_id),
    scope: row.scope === 'all' ? 'all' : 'region',
    requested_by: row.requested_by == null ? null : String(row.requested_by),
    status:
      row.status === 'running' || row.status === 'done' || row.status === 'failed' ? row.status : 'queued',
    run_id: row.run_id == null ? null : String(row.run_id),
    error: typeof row.error === 'string' ? row.error : null,
    created_at: String(row.created_at ?? ''),
    started_at: typeof row.started_at === 'string' ? row.started_at : null,
    finished_at: typeof row.finished_at === 'string' ? row.finished_at : null,
  }
}

export async function loadQueue(client: SupabaseClient): Promise<QueueRow[]> {
  const { data, error } = await client
    .from('crisis_engine_requests')
    .select('id,region_id,scope,requested_by,status,run_id,error,created_at,started_at,finished_at')
    .order('created_at', { ascending: false })
    .limit(QUEUE_LIMIT)
  if (error) throw new Error(applyMissingMessage(error.message))
  return (data ?? []).map((row) => asQueueRow(row as Record<string, unknown>))
}

export async function insertQueueRows(client: SupabaseClient, rows: QueueInsert[]): Promise<QueueRow[]> {
  if (rows.length === 0) return []
  const { data, error } = await client
    .from('crisis_engine_requests')
    .insert(rows)
    .select('id,region_id,scope,requested_by,status,run_id,error,created_at,started_at,finished_at')
  if (error) throw new Error(applyMissingMessage(error.message))
  return (data ?? []).map((row) => asQueueRow(row as Record<string, unknown>))
}

export async function claimNextRequest(client: SupabaseClient): Promise<QueueRow | null> {
  const { data: running, error: runningError } = await client
    .from('crisis_engine_requests')
    .select('id')
    .eq('status', 'running')
    .limit(1)
  if (runningError) throw new Error(applyMissingMessage(runningError.message))
  if ((running ?? []).length > 0) return null

  const { data: queued, error: queuedError } = await client
    .from('crisis_engine_requests')
    .select('id,region_id,scope,requested_by,status,run_id,error,created_at,started_at,finished_at')
    .eq('status', 'queued')
    .order('created_at', { ascending: true })
    .limit(40)
  if (queuedError) throw new Error(applyMissingMessage(queuedError.message))
  const rows = (queued ?? []).map((row) => asQueueRow(row as Record<string, unknown>))
  const next = rows.find((row) => row.scope === 'region') ?? rows[0]
  if (!next) return null

  const startedAt = new Date().toISOString()
  const { data, error } = await client
    .from('crisis_engine_requests')
    .update({ status: 'running', started_at: startedAt, error: null })
    .eq('id', next.id)
    .eq('status', 'queued')
    .select('id,region_id,scope,requested_by,status,run_id,error,created_at,started_at,finished_at')
    .maybeSingle()
  if (error) throw new Error(applyMissingMessage(error.message))
  return data ? asQueueRow(data as Record<string, unknown>) : null
}

export async function finishRequest(
  client: SupabaseClient,
  id: string,
  patch: { status: 'done' | 'failed'; runId?: string | null; error?: string | null },
): Promise<void> {
  const { error } = await client
    .from('crisis_engine_requests')
    .update({
      status: patch.status,
      run_id: patch.runId ?? null,
      error: patch.error ?? null,
      finished_at: new Date().toISOString(),
    })
    .eq('id', id)
  if (error) throw new Error(applyMissingMessage(error.message))
}

async function pagedSelect<T>(
  load: (from: number, to: number) => Promise<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const rows: T[] = []
  for (let from = 0; ; from += FLAG_PAGE) {
    const { data, error } = await load(from, from + FLAG_PAGE - 1)
    if (error) throw new Error(error.message)
    const chunk = data ?? []
    rows.push(...chunk)
    if (chunk.length < FLAG_PAGE) break
  }
  return rows
}

export async function loadTodayRegions(client: SupabaseClient, now = new Date()): Promise<{ day: string; regions: AdminRegion[] }> {
  const todayUtc = now.toISOString().slice(0, 10)
  const { data: latest, error: latestError } = await client
    .from('crisis_region_flags')
    .select('flag_date')
    .eq('flag', 'risk_score')
    .order('flag_date', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (latestError) throw new Error(latestError.message)
  const day = typeof latest?.flag_date === 'string' ? latest.flag_date : todayUtc

  const flags = await pagedSelect(async (from, to) =>
    client
      .from('crisis_region_flags')
      .select('region_id,flag_date,value,detail')
      .eq('flag', 'risk_score')
      .eq('flag_date', day)
      .order('region_id', { ascending: true })
      .range(from, to),
  )
  const flagRows = flags as RiskFlagRow[]
  const ids = [...new Set(flagRows.map((row) => Number(row.region_id)))]
  const regions: StoredRegion[] = []
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200)
    const { data, error } = await client
      .from('crisis_regions')
      .select('id,name,iso3,level,parent_id,centroid')
      .in('id', chunk)
    if (error) throw new Error(error.message)
    regions.push(...((data ?? []) as StoredRegion[]))
  }

  const { data: countries, error: countryError } = await client
    .from('crisis_regions')
    .select('iso3,name')
    .eq('level', 0)
    .not('iso3', 'is', null)
    .limit(400)
  if (countryError) throw new Error(countryError.message)

  const lastRuns: Array<{ region_id: number; at: string | null }> = []
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200)
    const { data, error } = await client
      .from('crisis_engine_runs')
      .select('region_id,finished_at,created_at')
      .in('region_id', chunk)
      .order('created_at', { ascending: false })
      .limit(2000)
    if (error && !/crisis_engine_runs|schema cache|does not exist/i.test(error.message)) throw new Error(error.message)
    for (const row of data ?? []) {
      lastRuns.push({
        region_id: Number(row.region_id),
        at: typeof row.finished_at === 'string' ? row.finished_at : typeof row.created_at === 'string' ? row.created_at : null,
      })
    }
  }

  return {
    day,
    regions: assembleTodayRegions({
      flags: flagRows,
      regions,
      countries: (countries ?? [])
        .filter((row): row is { iso3: string; name: string } => typeof row.iso3 === 'string')
        .map((row) => ({ iso3: row.iso3, name: row.name ?? row.iso3 })),
      lastRuns,
    }),
  }
}

export async function loadFlagDetail(
  client: SupabaseClient,
  regionId: number,
  day: string,
): Promise<unknown> {
  const { data, error } = await client
    .from('crisis_region_flags')
    .select('detail')
    .eq('region_id', regionId)
    .eq('flag', 'risk_score')
    .eq('flag_date', day)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data?.detail ?? null
}
