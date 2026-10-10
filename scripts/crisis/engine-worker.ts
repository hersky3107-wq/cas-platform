/**
 * Crisis engine queue worker. Separate process from crisis:sweep.
 *
 * Polls crisis_engine_requests every 30s and runs one region at a time
 * under the existing cost cap (DEFAULT_COST_CAP_USD).
 *
 *   npm run crisis:worker
 */
import { existsSync } from 'node:fs'
import path from 'node:path'
import { engineCardFromStored } from '../../lib/crisis/admin/card'
import { expandAllToRegions } from '../../lib/crisis/admin/queue'
import { claimNextRequest, finishRequest, insertQueueRows, loadFlagDetail, loadTodayRegions } from '../../lib/crisis/admin/store'
import { parseFlagDetail } from '../../lib/crisis/admin/today'
import { DEFAULT_HORIZON } from '../../lib/crisis/admin/types'
import { DEFAULT_COST_CAP_USD } from '../../lib/crisis/engine/prices'

const POLL_MS = 30_000
const APPLY = 'Paste docs/crisis/APPLY_ENGINE_REQUESTS.md before using the engine queue.'

function requireEnvLocal(): void {
  const envPath = path.resolve(process.cwd(), '.env.local')
  if (!existsSync(envPath)) throw new Error('Copy cas-platform/.env.local into cas-platform-crisis first')
}

async function runOneRegion(opts: {
  regionId: number
  day: string
}): Promise<string> {
  const { supabaseAdmin } = await import('../../lib/supabase/server')
  const { runEngine } = await import('../../lib/crisis/engine/run')
  const { liveCaller } = await import('../../lib/crisis/engine/live-caller')
  const { loadCoverage } = await import('../../lib/crisis/engine/coverage-load')
  const { loadCachedRun, persistRun } = await import('../../lib/crisis/engine/store')
  const scored = await loadTodayRegions(supabaseAdmin)
  const region = scored.regions.find((row) => row.regionId === opts.regionId)
  if (!region) throw new Error(`no scored region ${opts.regionId} for ${opts.day}`)
  const detail = parseFlagDetail(await loadFlagDetail(supabaseAdmin, opts.regionId, scored.day))
  const card = engineCardFromStored(region, detail, DEFAULT_HORIZON)
  const coverage = await loadCoverage(supabaseAdmin, card, new Date())
  const record = await runEngine({
    card,
    caller: liveCaller(),
    mode: 'region',
    costCapUsd: DEFAULT_COST_CAP_USD,
    coverage,
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
  return record.id
}

async function tick(): Promise<void> {
  const { supabaseAdmin } = await import('../../lib/supabase/server')
  const claimed = await claimNextRequest(supabaseAdmin)
  if (!claimed) return

  try {
    if (claimed.scope === 'all') {
      const scored = await loadTodayRegions(supabaseAdmin)
      const ids = scored.regions.filter((row) => row.stage >= 3).map((row) => row.regionId)
      const { count } = await supabaseAdmin
        .from('crisis_engine_requests')
        .select('id', { count: 'exact', head: true })
        .eq('scope', 'region')
        .eq('requested_by', claimed.requested_by)
        .gte('created_at', claimed.created_at)
      if ((count ?? 0) === 0) {
        await insertQueueRows(
          supabaseAdmin,
          expandAllToRegions(
            { region_id: null, scope: 'all', requested_by: claimed.requested_by, status: 'queued' },
            ids,
          ),
        )
      }
      await finishRequest(supabaseAdmin, claimed.id, { status: 'done', error: ids.length ? null : 'no regions at stage >= 3' })
      console.log(JSON.stringify({ at: new Date().toISOString(), request: claimed.id, scope: 'all', regions: ids.length }))
      return
    }
    const scored = await loadTodayRegions(supabaseAdmin)
    if (claimed.region_id == null) throw new Error('region request is missing region_id')
    const runId = await runOneRegion({ regionId: claimed.region_id, day: scored.day })
    await finishRequest(supabaseAdmin, claimed.id, { status: 'done', runId })
    console.log(JSON.stringify({ at: new Date().toISOString(), request: claimed.id, region: claimed.region_id, run_id: runId, status: 'done' }))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await finishRequest(supabaseAdmin, claimed.id, { status: 'failed', error: message })
    if (claimed.requested_by) {
      const { refundUserRequest } = await import('../../lib/crisis/public/refund')
      const outcome = await refundUserRequest(supabaseAdmin, claimed.id, claimed.requested_by, claimed.region_id)
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
  console.log(`crisis engine worker poll=${POLL_MS / 1000}s cap_usd=${DEFAULT_COST_CAP_USD} (${APPLY})`)
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
