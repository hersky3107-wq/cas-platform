/**
 * Crisis engine queue worker. Separate process from crisis:sweep.
 *
 * Polls crisis_engine_requests every 30s and runs one region or one zone
 * at a time. Zone runs use ZONE_COST_CAP_USD ($1.20).
 *
 *   npm run crisis:worker
 */
import { existsSync } from 'node:fs'
import path from 'node:path'
import { ADMIN_EMAIL } from '../../lib/admin/require-admin'
import { engineCardFromStored } from '../../lib/crisis/admin/card'
import { enqueueZone } from '../../lib/crisis/admin/queue'
import { finishRequest, insertQueueRows, loadTodayRegions } from '../../lib/crisis/admin/store'
import type { QueueRow, QueueScope } from '../../lib/crisis/admin/types'
import { DEFAULT_HORIZON } from '../../lib/crisis/admin/types'
import { DEFAULT_COST_CAP_USD, ZONE_COST_CAP_USD } from '../../lib/crisis/engine/prices'
import { CRISIS_DEEP_CREDITS, CRISIS_GLOBAL_CREDITS, CRISIS_ZONE_CREDITS } from '../../lib/crisis/credits'
import { CRISIS_ZONES, isZoneKey } from '../../lib/crisis/zones'
import { loadZoneEngineCard } from '../../lib/crisis/engine/zone-load'

const POLL_MS = 30_000
const APPLY = 'Paste docs/crisis/APPLY_ZONES.md before using zone queue rows.'
const FORCE_MARKERS = new Set(['force:fresh', 'force:true'])
const QUEUE_COLUMNS = 'id,region_id,scope,zone_key,requested_by,status,run_id,error,created_at,started_at,finished_at'

function requireEnvLocal(): void {
  const envPath = path.resolve(process.cwd(), '.env.local')
  if (!existsSync(envPath)) throw new Error('Copy cas-platform/.env.local into cas-platform-crisis first')
}

function asScope(value: unknown): QueueScope {
  if (value === 'all' || value === 'zone') return value
  return 'region'
}

function asQueueRow(row: Record<string, unknown>): QueueRow {
  return {
    id: String(row.id),
    region_id: row.region_id == null ? null : Number(row.region_id),
    scope: asScope(row.scope),
    zone_key: typeof row.zone_key === 'string' ? row.zone_key : null,
    requested_by: row.requested_by == null ? null : String(row.requested_by),
    status: row.status === 'running' || row.status === 'done' || row.status === 'failed' ? row.status : 'queued',
    run_id: row.run_id == null ? null : String(row.run_id),
    error: typeof row.error === 'string' ? row.error : null,
    created_at: String(row.created_at ?? ''),
    started_at: typeof row.started_at === 'string' ? row.started_at : null,
    finished_at: typeof row.finished_at === 'string' ? row.finished_at : null,
  }
}

function wantsForceFresh(error: string | null): boolean {
  return Boolean(error && FORCE_MARKERS.has(error.trim().toLowerCase()))
}

async function isAdminUserId(userId: string | null): Promise<boolean> {
  if (!userId) return false
  const { supabaseAdmin } = await import('../../lib/supabase/server')
  const { data, error } = await supabaseAdmin.auth.admin.getUserById(userId)
  if (error || !data.user?.email) return false
  return data.user.email.toLowerCase() === ADMIN_EMAIL.toLowerCase()
}

async function claimNextRequestWithForce(): Promise<(QueueRow & { forceFresh: boolean; refundCredits: number | null }) | null> {
  const { supabaseAdmin } = await import('../../lib/supabase/server')
  const { data: running, error: runningError } = await supabaseAdmin
    .from('crisis_engine_requests')
    .select('id')
    .eq('status', 'running')
    .limit(1)
  if (runningError) throw new Error(runningError.message)
  if ((running ?? []).length > 0) return null

  const { data: queued, error: queuedError } = await supabaseAdmin
    .from('crisis_engine_requests')
    .select(QUEUE_COLUMNS)
    .eq('status', 'queued')
    .order('created_at', { ascending: true })
    .limit(40)
  if (queuedError) throw new Error(`${queuedError.message}. ${APPLY}`)
  const rows = (queued ?? []).map((row) => asQueueRow(row as Record<string, unknown>))
  const next = rows.find((row) => row.scope === 'region') ?? rows.find((row) => row.scope === 'zone') ?? rows[0]
  if (!next) return null

  const globalBatch = next.error === 'batch:global'
  const forceFresh = wantsForceFresh(next.error) || (await isAdminUserId(next.requested_by))
  const refundCredits = globalBatch || !next.requested_by
    ? null
    : next.scope === 'zone'
      ? CRISIS_ZONE_CREDITS
      : next.scope === 'all'
        ? CRISIS_GLOBAL_CREDITS
        : CRISIS_DEEP_CREDITS
  const startedAt = new Date().toISOString()
  const { data, error } = await supabaseAdmin
    .from('crisis_engine_requests')
    .update({ status: 'running', started_at: startedAt, error: null })
    .eq('id', next.id)
    .eq('status', 'queued')
    .select(QUEUE_COLUMNS)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) return null
  return { ...asQueueRow(data as Record<string, unknown>), forceFresh, refundCredits }
}

async function runOneRegion(opts: {
  regionId: number
  forceFresh: boolean
  regionName: string
}): Promise<{ runId: string; costUsd: number; headlineCount: number; cacheHit: boolean }> {
  console.log(`engine run start region=${opts.regionName} (${opts.regionId}) ${opts.forceFresh ? 'fresh' : 'cache'}`)
  const { supabaseAdmin } = await import('../../lib/supabase/server')
  const { runEngine } = await import('../../lib/crisis/engine/run')
  const { liveCaller } = await import('../../lib/crisis/engine/live-caller')
  const { loadCoverage } = await import('../../lib/crisis/engine/coverage-load')
  const { loadCachedRun, persistRun } = await import('../../lib/crisis/engine/store')
  const scored = await loadTodayRegions(supabaseAdmin)
  const region = scored.regions.find((row) => row.regionId === opts.regionId)
  if (!region) throw new Error(`no scored region ${opts.regionId}`)
  const detail = parseFlagDetail(await loadFlagDetail(supabaseAdmin, opts.regionId, scored.day))
  const card = engineCardFromStored(region, detail, DEFAULT_HORIZON)
  const coverage = await loadCoverage(supabaseAdmin, card, new Date())
  const record = await runEngine({
    card,
    caller: liveCaller(),
    mode: 'region',
    costCapUsd: DEFAULT_COST_CAP_USD,
    coverage,
    force: opts.forceFresh,
    cache: {
      async get(key) {
        return loadCachedRun(supabaseAdmin, key)
      },
      async put(saved) {
        saved.id = await persistRun(supabaseAdmin, saved, 'admin')
      },
    },
  })
  if (!record.id) throw new Error('engine run did not persist an id')
  if (record.status === 'error') throw new Error(record.error ?? 'engine run failed')
  const headlineCount = record.result?.headlines?.length ?? 0
  console.log(`engine run done run_id=${record.id} cost_usd=${record.costUsd.toFixed(6)} headlines=${headlineCount}`)
  return { runId: record.id, costUsd: record.costUsd, headlineCount, cacheHit: record.cacheHit }
}

async function loadZoneCard(zoneKey: string) {
  if (!isZoneKey(zoneKey)) throw new Error(`unknown zone ${zoneKey}`)
  const { supabaseAdmin } = await import('../../lib/supabase/server')
  const card = await loadZoneEngineCard(supabaseAdmin, zoneKey, DEFAULT_HORIZON)
  return { card }
}

async function runOneZone(opts: {
  zoneKey: string
  forceFresh: boolean
}): Promise<{ runId: string; costUsd: number; headlineCount: number; cacheHit: boolean }> {
  const loaded = await loadZoneCard(opts.zoneKey)
  console.log(`engine run start zone=${loaded.card.name} (${opts.zoneKey}) ${opts.forceFresh ? 'fresh' : 'cache'}`)
  const { supabaseAdmin } = await import('../../lib/supabase/server')
  const { runEngine } = await import('../../lib/crisis/engine/run')
  const { liveCaller } = await import('../../lib/crisis/engine/live-caller')
  const { loadCachedRun, persistRun } = await import('../../lib/crisis/engine/store')
  const record = await runEngine({
    card: loaded.card,
    caller: liveCaller(),
    mode: 'zone',
    costCapUsd: ZONE_COST_CAP_USD,
    force: opts.forceFresh,
    cache: {
      async get(key) {
        return loadCachedRun(supabaseAdmin, key)
      },
      async put(saved) {
        saved.id = await persistRun(supabaseAdmin, saved, 'admin')
      },
    },
  })
  if (!record.id) throw new Error('engine run did not persist an id')
  if (record.status === 'error') throw new Error(record.error ?? 'engine run failed')
  const headlineCount = record.result?.headlines?.length ?? 0
  console.log(`engine run done run_id=${record.id} cost_usd=${record.costUsd.toFixed(6)} headlines=${headlineCount}`)
  return { runId: record.id, costUsd: record.costUsd, headlineCount, cacheHit: record.cacheHit }
}

async function tick(): Promise<void> {
  const { supabaseAdmin } = await import('../../lib/supabase/server')
  const claimed = await claimNextRequestWithForce()
  if (!claimed) return

  try {
    if (claimed.scope === 'all') {
      const { count } = await supabaseAdmin
        .from('crisis_engine_requests')
        .select('id', { count: 'exact', head: true })
        .eq('scope', 'zone')
        .eq('requested_by', claimed.requested_by)
        .gte('created_at', claimed.created_at)
      if ((count ?? 0) === 0) {
        await insertQueueRows(
          supabaseAdmin,
          CRISIS_ZONES.map((zone) => ({
            ...enqueueZone(zone.key, claimed.requested_by),
            error: claimed.forceFresh ? 'force:fresh' : claimed.requested_by ? 'batch:global' : null,
          })),
        )
      }
      await finishRequest(supabaseAdmin, claimed.id, { status: 'done' })
      console.log(JSON.stringify({ at: new Date().toISOString(), request: claimed.id, scope: 'all', zones: CRISIS_ZONES.length }))
      return
    }
    if (claimed.scope === 'zone') {
      if (!claimed.zone_key) throw new Error('zone request is missing zone_key')
      const outcome = await runOneZone({ zoneKey: claimed.zone_key, forceFresh: claimed.forceFresh })
      await finishRequest(supabaseAdmin, claimed.id, { status: 'done', runId: outcome.runId })
      console.log(JSON.stringify({ at: new Date().toISOString(), request: claimed.id, zone: claimed.zone_key, run_id: outcome.runId, status: 'done' }))
      return
    }
    if (claimed.region_id == null) throw new Error('region request is missing region_id')
    const scored = await loadTodayRegions(supabaseAdmin)
    const region = scored.regions.find((row) => row.regionId === claimed.region_id)
    const outcome = await runOneRegion({
      regionId: claimed.region_id,
      forceFresh: claimed.forceFresh,
      regionName: region?.name ?? String(claimed.region_id),
    })
    await finishRequest(supabaseAdmin, claimed.id, { status: 'done', runId: outcome.runId })
    console.log(JSON.stringify({ at: new Date().toISOString(), request: claimed.id, region: claimed.region_id, run_id: outcome.runId, status: 'done' }))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await finishRequest(supabaseAdmin, claimed.id, { status: 'failed', error: message })
    if (claimed.requested_by && claimed.refundCredits) {
      const { refundUserRequest } = await import('../../lib/crisis/public/refund')
      const outcome = await refundUserRequest(
        supabaseAdmin,
        claimed.id,
        claimed.requested_by,
        claimed.region_id,
        claimed.refundCredits,
      )
      console.log(JSON.stringify({ at: new Date().toISOString(), request: claimed.id, refunded: outcome.refunded, reason: outcome.reason }))
    }
    console.error(JSON.stringify({ at: new Date().toISOString(), request: claimed.id, status: 'failed', error: message }))
  }
}

async function main(): Promise<void> {
  requireEnvLocal()
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required')
  }
  const once = process.argv.includes('--once')
  console.log(`crisis engine worker poll=${POLL_MS / 1000}s region_cap_usd=${DEFAULT_COST_CAP_USD} zone_cap_usd=${ZONE_COST_CAP_USD} (${APPLY})`)
  if (once) {
    await tick()
    return
  }
  for (;;) {
    try {
      await tick()
    } catch (error) {
      console.error(error instanceof Error ? error.message : error)
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS))
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
