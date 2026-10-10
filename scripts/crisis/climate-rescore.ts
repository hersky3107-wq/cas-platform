/**
 * Refresh the 16-day forecast, backfill one climate batch, print heat/cold/drought flags, then write.
 * Does not touch the running crisis:sweep process.
 *
 *   npx tsx --require ./scripts/crisis/register-server-only.cjs --env-file=.env.local scripts/crisis/climate-rescore.ts
 */
import { spawnSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { CLIMATE_LICENSES } from '../../lib/crisis/climate/licenses'
import { CRISIS_SOURCES } from '../../lib/crisis/ingest/registry'
import { runSource } from '../../lib/crisis/ingest/run'
import { runLayer1Score } from '../../lib/crisis/score/job'
import type { RegionScore } from '../../lib/crisis/score/types'

const INGEST = ['openmeteo_forecast', 'openmeteo_climate', 'gdo_cdi']

function stages(rows: RegionScore[]): Record<number, number> {
  const counts: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
  for (const row of rows) counts[row.stage] = (counts[row.stage] ?? 0) + 1
  return counts
}

function printFlags(rows: RegionScore[]): void {
  const hits = rows.filter((row) => row.components.some((component) => component.key === 'heat' || component.key === 'cold' || component.key === 'drought'))
  console.log(`weather_flags=${hits.length}`)
  for (const row of hits) {
    for (const key of ['heat', 'cold', 'drought'] as const) {
      const hit = row.components.find((component) => component.key === key && component.value > 0)
      if (!hit) continue
      console.log(
        `${key} ${row.name} ${row.iso3 ?? ''} stage=${row.stage} value=${hit.value.toFixed(2)} ` +
          `wet=${hit.raw.wet_bulb_c ?? '-'} days=${hit.raw.consecutive_days ?? '-'} anomaly=${hit.raw.anomaly_c ?? '-'} ` +
          `chill=${hit.raw.wind_chill_c ?? '-'} factors=${Array.isArray(hit.raw.factors) ? hit.raw.factors.join('+') : '-'} ` +
          `rain=${hit.raw.rain_ratio ?? '-'}`,
      )
    }
  }
}

async function ensureTable(): Promise<void> {
  const token = process.env.SUPABASE_ACCESS_TOKEN?.trim()
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? ''
  const ref = url.match(/https:\/\/([^.]+)/)?.[1]
  if (!token || !ref) {
    console.log('climate table: no management token; ingest will skip if the table is missing')
    return
  }
  const query = readFileSync(path.resolve(process.cwd(), 'supabase/migrations/20261010120000_crisis_region_climate.sql'), 'utf8')
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  })
  if (res.ok) {
    console.log('climate table ready')
    return
  }
  const body = await res.text()
  const kind = token.startsWith('sbp_') ? 'personal access token' : token.split('.').length === 3 ? 'jwt' : 'other'
  console.log(`climate table: management API HTTP ${res.status} (${kind})`)
  if (res.status !== 401) console.log(body.slice(0, 180))
  const dbUrl = ['DATABASE_URL', 'SUPABASE_DB_URL', 'POSTGRES_URL', 'DIRECT_URL', 'POSTGRES_URL_NON_POOLING']
    .map((name) => process.env[name]?.trim())
    .find((value) => Boolean(value))
  if (!dbUrl) {
    console.log('climate table: no database url in env; ingest will skip if the table is missing')
    return
  }
  const applied = spawnSync('psql', [dbUrl, '-v', 'ON_ERROR_STOP=1', '-f', path.resolve(process.cwd(), 'supabase/migrations/20261010120000_crisis_region_climate.sql')], {
    encoding: 'utf8',
  })
  if (applied.status === 0) {
    console.log('climate table ready via psql')
    return
  }
  console.log(`climate table: psql failed (${applied.error?.code ?? 'exit ' + applied.status}); ingest will skip if the table is missing`)
}

async function main(): Promise<void> {
  const envPath = path.resolve(process.cwd(), '.env.local')
  if (!existsSync(envPath)) throw new Error('Copy cas-platform/.env.local into cas-platform-crisis first')
  for (const row of CLIMATE_LICENSES) {
    console.log(`license ${row.status} ${row.source} | ${row.license} | ${row.terms}`)
  }
  await ensureTable()
  const { supabaseAdmin } = await import('../../lib/supabase/server')
  for (const key of INGEST) {
    const source = CRISIS_SOURCES.find((row) => row.key === key)
    if (!source) throw new Error(`missing source ${key}`)
    const summary = await runSource(source, supabaseAdmin, { dryRun: false, force: true })
    console.log(`ingest ${key} status=${summary.status} in=${summary.rowsIn} written=${summary.rowsWritten} http=${summary.httpCalls} note=${summary.quotaNote ?? ''} error=${summary.error ?? ''}`)
  }
  const before = await runLayer1Score(supabaseAdmin, { dryRun: true, write: false, climate: false, log: () => {} })
  const after = await runLayer1Score(supabaseAdmin, { dryRun: true, write: false, climate: true, log: (message) => console.log(message) })
  console.log(`stages before ${JSON.stringify(stages(before.rows))}`)
  console.log(`stages after ${JSON.stringify(stages(after.rows))}`)
  printFlags(after.rows)
  const written = await runLayer1Score(supabaseAdmin, { dryRun: false, write: true, climate: true, log: (message) => console.log(message) })
  console.log(`wrote day=${written.day} scored=${written.scored} cards=${written.cards}`)
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error)
  process.exit(1)
})
