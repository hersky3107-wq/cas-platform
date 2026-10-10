import type { SupabaseClient } from '@supabase/supabase-js'
import { enqueueRegion } from '../admin/queue'
import { insertQueueRows, loadTodayRegions } from '../admin/store'
import type { AdminRegion, QueueRow } from '../admin/types'
import type { EngineResult } from '../engine/schema'
import { loadRun } from '../engine/store'
import {
  freeLayerFromDetail,
  lockBriefCard,
  unlockBriefCard,
  type FragilityGroup,
  type FreeTriggerFact,
  type LockedBriefCard,
  type UnlockedBriefCard,
} from './card'
import { isPublicRun } from './policy'
import { summarizeEngineProgress, type ProgressGroup } from './progress'

const APPLY_UNLOCKS = 'Paste docs/crisis/APPLY_PUBLIC.md before unlocking a briefing.'

export interface PublicMapRegion extends AdminRegion {
  fragility: string[]
  fragilityGroups: FragilityGroup[]
  peopleNorm: number | null
  peopleCount: number | null
  urban: Array<{ name: string; pop: number }>
  triggerFacts: FreeTriggerFact[]
}

export async function loadPublicMap(
  client: SupabaseClient,
  now = new Date(),
): Promise<{ day: string; regions: PublicMapRegion[] }> {
  const today = await loadTodayRegions(client, now)
  const ids = today.regions.map((row) => row.regionId)
  const details = new Map<number, unknown>()
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200)
    const { data, error } = await client
      .from('crisis_region_flags')
      .select('region_id,detail')
      .eq('flag', 'risk_score')
      .eq('flag_date', today.day)
      .in('region_id', chunk)
    if (error) throw new Error(error.message)
    for (const row of data ?? []) details.set(Number(row.region_id), row.detail)
  }
  const peopleById = new Map<number, { value: number; issued: string }>()
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200)
    const { data, error } = await client
      .from('crisis_region_metrics')
      .select('region_id,value,issued_at')
      .eq('metric', 'urban_pop')
      .in('region_id', chunk)
    if (error && !/crisis_region_metrics|schema cache|does not exist/i.test(error.message)) throw new Error(error.message)
    for (const row of data ?? []) {
      const id = Number(row.region_id)
      const value = typeof row.value === 'number' ? row.value : null
      if (value == null || value <= 0) continue
      const issued = typeof row.issued_at === 'string' ? row.issued_at : ''
      const prev = peopleById.get(id)
      if (!prev || issued >= prev.issued) peopleById.set(id, { value, issued })
    }
  }

  return {
    day: today.day,
    regions: today.regions.map((row) => {
      const free = freeLayerFromDetail(details.get(row.regionId))
      return {
        ...row,
        ...free,
        peopleCount: free.peopleCount ?? peopleById.get(row.regionId)?.value ?? null,
      }
    }),
  }
}

export async function loadDeepProgress(
  client: SupabaseClient,
  request: QueueRow,
  now = new Date(),
): Promise<{
  requestId: string
  requestStatus: QueueRow['status']
  createdAt: string
  startedAt: string | null
  runId: string | null
  waitingForWorker: boolean
  elapsedSec: number
  groups: ProgressGroup[]
}> {
  let steps: Array<{ role: string }> = []
  if (request.run_id) {
    const { data, error } = await client
      .from('crisis_engine_steps')
      .select('role')
      .eq('run_id', request.run_id)
      .order('id', { ascending: true })
    if (error && !/crisis_engine_steps|schema cache|does not exist/i.test(error.message)) throw new Error(error.message)
    steps = (data ?? []).map((row) => ({ role: String(row.role) }))
  }
  const status =
    request.status === 'queued' || request.status === 'running' || request.status === 'done' || request.status === 'failed'
      ? request.status
      : 'queued'
  const summary = summarizeEngineProgress({
    requestStatus: status,
    createdAt: request.created_at,
    now,
    steps,
  })
  return {
    requestId: request.id,
    requestStatus: request.status,
    createdAt: request.created_at,
    startedAt: request.started_at,
    runId: request.run_id,
    ...summary,
  }
}

export async function loadPublishedRuns(
  client: SupabaseClient,
  now = new Date(),
): Promise<
  Array<{
    id: string
    region_id: number
    cost_usd: number | null
    result: EngineResult | null
    search_urls: string[]
    published_hypothesis_ids: unknown
    created_at: string
  }>
> {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString()
  const { data, error } = await client
    .from('crisis_engine_runs')
    .select('id,region_id,cost_usd,result,published_hypothesis_ids,created_at,finished_at')
    .eq('status', 'done')
    .gte('created_at', start)
    .order('created_at', { ascending: false })
    .limit(80)
  if (error) throw new Error(error.message)
  return (data ?? [])
    .filter((row) => isPublicRun(row.published_hypothesis_ids) && row.region_id != null)
    .map((row) => {
      const result = row.result as (EngineResult & { search_urls?: string[] }) | null
      return {
        id: String(row.id),
        region_id: Number(row.region_id),
        cost_usd: row.cost_usd == null ? null : Number(row.cost_usd),
        result,
        search_urls: result?.search_urls ?? [],
        published_hypothesis_ids: row.published_hypothesis_ids,
        created_at: String(row.created_at),
      }
    })
}

export async function findFreshRun(
  client: SupabaseClient,
  regionId: number,
  now: Date,
): Promise<{ id: string; at: string } | null> {
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString()
  const { data, error } = await client
    .from('crisis_engine_runs')
    .select('id,created_at,finished_at,published_hypothesis_ids,status')
    .eq('region_id', regionId)
    .eq('status', 'done')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(8)
  if (error) throw new Error(error.message)
  const published = (data ?? []).find((row) => isPublicRun(row.published_hypothesis_ids))
  const hit = published ?? data?.[0]
  if (!hit) return null
  return { id: String(hit.id), at: String(hit.finished_at ?? hit.created_at) }
}

export async function loadOwnRequest(
  client: SupabaseClient,
  userId: string,
  regionId: number,
): Promise<QueueRow | null> {
  const { data, error } = await client
    .from('crisis_engine_requests')
    .select('id,region_id,scope,requested_by,status,run_id,error,created_at,started_at,finished_at')
    .eq('requested_by', userId)
    .eq('region_id', regionId)
    .eq('scope', 'region')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) return null
  return {
    id: String(data.id),
    region_id: data.region_id == null ? null : Number(data.region_id),
    scope: 'region',
    requested_by: userId,
    status:
      data.status === 'running' || data.status === 'done' || data.status === 'failed' ? data.status : 'queued',
    run_id: data.run_id == null ? null : String(data.run_id),
    error: typeof data.error === 'string' ? data.error : null,
    created_at: String(data.created_at ?? ''),
    started_at: typeof data.started_at === 'string' ? data.started_at : null,
    finished_at: typeof data.finished_at === 'string' ? data.finished_at : null,
  }
}

export async function queueDeepRequest(client: SupabaseClient, regionId: number, userId: string): Promise<QueueRow> {
  const [row] = await insertQueueRows(client, [enqueueRegion(regionId, userId)])
  return row
}

export async function hasUnlock(
  client: SupabaseClient,
  opts: { userId: string; kind: 'brief' | 'deep'; runId?: string; regionId?: number },
): Promise<boolean> {
  let q = client.from('crisis_unlocks').select('id').eq('user_id', opts.userId).eq('kind', opts.kind).limit(1)
  if (opts.runId) q = q.eq('run_id', opts.runId)
  if (opts.regionId != null) q = q.eq('region_id', opts.regionId)
  const { data, error } = await q.maybeSingle()
  if (error) {
    if (/crisis_unlocks|schema cache|does not exist/i.test(error.message)) throw new Error(`${error.message}. ${APPLY_UNLOCKS}`)
    throw new Error(error.message)
  }
  return Boolean(data)
}

export async function recordUnlock(
  client: SupabaseClient,
  opts: { userId: string; kind: 'brief' | 'deep'; runId?: string | null; regionId?: number | null },
): Promise<void> {
  const { error } = await client.from('crisis_unlocks').insert({
    user_id: opts.userId,
    kind: opts.kind,
    run_id: opts.runId ?? null,
    region_id: opts.regionId ?? null,
  })
  if (error && !/duplicate|unique/i.test(error.message)) {
    if (/crisis_unlocks|schema cache|does not exist/i.test(error.message)) throw new Error(`${error.message}. ${APPLY_UNLOCKS}`)
    throw new Error(error.message)
  }
}

export async function briefCardsForUser(
  client: SupabaseClient,
  userId: string,
  now = new Date(),
): Promise<Array<LockedBriefCard | UnlockedBriefCard>> {
  const [runs, today, unlockRows] = await Promise.all([
    loadPublishedRuns(client, now),
    loadTodayRegions(client, now),
    client.from('crisis_unlocks').select('run_id').eq('user_id', userId).eq('kind', 'brief'),
  ])
  if (unlockRows.error && !/crisis_unlocks|schema cache|does not exist/i.test(unlockRows.error.message)) {
    throw new Error(unlockRows.error.message)
  }
  const unlockedIds = new Set((unlockRows.data ?? []).map((row) => String(row.run_id)))
  const byId = new Map(today.regions.map((row) => [row.regionId, row]))
  const out: Array<LockedBriefCard | UnlockedBriefCard> = []
  for (const run of runs) {
    const region = byId.get(run.region_id)
    const name = region?.name ?? `region ${run.region_id}`
    const country = region?.country ?? ''
    const unlocked = unlockedIds.has(run.id)
    if (!unlocked || !run.result) {
      out.push(
        lockBriefCard({
          runId: run.id,
          regionId: run.region_id,
          regionName: name,
          country,
          result: run.result,
          stage: region?.stage,
        }),
      )
      continue
    }
    out.push(
      unlockBriefCard({
        runId: run.id,
        regionId: run.region_id,
        regionName: name,
        country,
        iso3: region?.iso3 ?? null,
        result: run.result,
        searchUrls: run.search_urls,
        costUsd: run.cost_usd ?? 0,
      }),
    )
  }
  return out
}

export async function unlockBriefForUser(
  client: SupabaseClient,
  userId: string,
  runId: string,
): Promise<UnlockedBriefCard> {
  const run = await loadRun(client, runId)
  if (!run?.result) throw new Error('run not found')
  const { data: extra } = await client
    .from('crisis_engine_runs')
    .select('published_hypothesis_ids,region_id')
    .eq('id', runId)
    .maybeSingle()
  if (!isPublicRun(extra?.published_hypothesis_ids)) throw new Error('card is not public')
  const today = await loadTodayRegions(client)
  const region = today.regions.find((row) => row.regionId === run.regionId)
  await recordUnlock(client, { userId, kind: 'brief', runId, regionId: run.regionId })
  return unlockBriefCard({
    runId,
    regionId: run.regionId,
    regionName: region?.name ?? run.card?.name ?? `region ${run.regionId}`,
    country: region?.country ?? run.card?.country ?? '',
    iso3: region?.iso3 ?? run.card?.iso3 ?? null,
    result: run.result,
    searchUrls: run.searchUrls,
    costUsd: run.costUsd,
  })
}

export async function cardFromRunId(client: SupabaseClient, runId: string): Promise<UnlockedBriefCard | null> {
  const run = await loadRun(client, runId)
  if (!run?.result) return null
  return unlockBriefCard({
    runId,
    regionId: run.regionId,
    regionName: run.card?.name ?? `region ${run.regionId}`,
    country: run.card?.country ?? '',
    iso3: run.card?.iso3 ?? null,
    result: run.result,
    searchUrls: run.searchUrls,
    costUsd: run.costUsd,
  })
}
