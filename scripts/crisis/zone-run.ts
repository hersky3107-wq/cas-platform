/**
 * One live zone run. Does not retry.
 *
 *   npx tsx --require ./scripts/crisis/register-server-only.cjs --env-file=.env.local scripts/crisis/zone-run.ts --zone=south_asia --live
 */
import { existsSync } from 'node:fs'
import path from 'node:path'
import { ZONE_COST_CAP_USD } from '../../lib/crisis/engine/prices'
import { isZoneKey } from '../../lib/crisis/zones'

function arg(name: string): string | undefined {
  const hit = process.argv.find((item) => item.startsWith(`--${name}=`))
  return hit?.slice(name.length + 3)
}

async function main(): Promise<void> {
  if (!process.argv.includes('--live')) throw new Error('Pass --live. This script does not dry-run and does not retry.')
  const zoneKey = arg('zone') ?? 'south_asia'
  if (!isZoneKey(zoneKey)) throw new Error(`unknown zone ${zoneKey}`)
  const envPath = path.resolve(process.cwd(), '.env.local')
  if (!existsSync(envPath)) throw new Error('Copy cas-platform/.env.local into cas-platform-crisis first')

  const started = Date.now()
  const { supabaseAdmin } = await import('../../lib/supabase/server')
  const { loadZoneEngineCard } = await import('../../lib/crisis/engine/zone-load')
  const { runEngine } = await import('../../lib/crisis/engine/run')
  const { liveCaller } = await import('../../lib/crisis/engine/live-caller')
  const { loadCachedRun, persistRun } = await import('../../lib/crisis/engine/store')
  const card = await loadZoneEngineCard(supabaseAdmin, zoneKey, '30d')
  console.log(`zone=${zoneKey} members=${(card.members ?? []).map((row) => row.name).join(', ')} cap_usd=${ZONE_COST_CAP_USD}`)
  const record = await runEngine({
    card,
    caller: liveCaller(),
    mode: 'zone',
    costCapUsd: ZONE_COST_CAP_USD,
    force: true,
    cache: {
      async get(key) {
        return loadCachedRun(supabaseAdmin, key)
      },
      async put(saved) {
        try {
          saved.id = await persistRun(supabaseAdmin, saved, 'admin')
        } catch (error) {
          console.error(`persist_failed ${error instanceof Error ? error.message : error}`)
        }
      },
    },
  })
  const minutes = (Date.now() - started) / 60000
  const links = record.result?.cross_border ?? []
  console.log(`status=${record.status} cost_usd=${record.costUsd.toFixed(6)} minutes=${minutes.toFixed(2)} run_id=${record.id ?? 'none'}`)
  console.log(`cross_border=${links.length}`)
  for (const link of links) {
    console.log(`link ${link.from_region} -> ${link.to_region} | ${link.title} | ${link.link}`)
  }
  if (record.status === 'error') throw new Error(record.error ?? 'zone run failed')
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
