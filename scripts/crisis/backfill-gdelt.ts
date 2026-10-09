/**
 * Backfill GDELT 1.0 daily exports into region, dyad, and country days.
 *
 * Probed 2026-10-09: http://data.gdeltproject.org/events/YYYYMMDD.export.CSV.zip
 * 20261007 and 20260711 returned HTTP 200 (about 7.5 MB and 4 MB). 20261008 returned 404.
 * Daily files are used as-is. 15-minute files are not sampled and counts are not scaled.
 *
 *   npx tsx --env-file=.env.local scripts/crisis/backfill-gdelt.ts --dry-run
 *   npx tsx --env-file=.env.local scripts/crisis/backfill-gdelt.ts --days=90
 */
import { unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { existsSync } from 'node:fs'
import { assignLatLonBatch } from '../../lib/crisis/ingest/assign'
import { politeFetch } from '../../lib/crisis/ingest/fetch'
import { loadCountryIdByIso3 } from '../../lib/crisis/ingest/regions'
import {
  gdeltAggToDaily,
  gdeltPoints,
  gdeltRegionAggs,
  mergeGdeltStats,
  parseGdeltExportTsv,
  unzipGdeltExport,
} from '../../lib/crisis/ingest/sources/gdelt'
import {
  aggregateGdeltRelations,
  backfillDayList,
  gdeltV1ExportUrl,
  mergeStoredRelations,
  pendingBackfillDays,
} from '../../lib/crisis/ingest/sources/gdelt-relations'
import { upsertCountryDaily, upsertDaily, upsertDyadDaily } from '../../lib/crisis/ingest/upsert'
import { asRecord, finite } from '../../lib/crisis/score/math'

const SOURCE = 'gdelt_backfill'

function flagValue(name: string): string | null {
  const hit = process.argv.find((arg) => arg.startsWith(`${name}=`))
  return hit ? hit.slice(name.length + 1) : null
}

function ymd(date: Date): string {
  const y = date.getUTCFullYear()
  const m = String(date.getUTCMonth() + 1).padStart(2, '0')
  const d = String(date.getUTCDate()).padStart(2, '0')
  return `${y}${m}${d}`
}

async function main(): Promise<void> {
  const envPath = path.resolve(process.cwd(), '.env.local')
  if (!existsSync(envPath)) throw new Error('Copy cas-platform/.env.local into cas-platform-crisis first')
  const dryRun = process.argv.includes('--dry-run')
  const requested = dryRun ? 2 : Number(flagValue('--days') ?? '90')
  if (!Number.isFinite(requested) || requested < 1) throw new Error('--days must be a positive number')
  const { supabaseAdmin } = await import('../../lib/supabase/server')
  const yesterday = new Date()
  yesterday.setUTCDate(yesterday.getUTCDate() - 1)
  const planned = backfillDayList(ymd(yesterday), dryRun ? Math.max(requested, 7) : requested)
  let completed: string[] = []
  if (!dryRun) {
    const { data } = await supabaseAdmin.from('crisis_ingest_state').select('cursor').eq('source', SOURCE).maybeSingle()
    const cursor = asRecord(data?.cursor)
    completed = Array.isArray(cursor?.completed) ? cursor.completed.filter((day): day is string => typeof day === 'string') : []
  }
  const queue = dryRun ? [...planned].reverse() : pendingBackfillDays(planned, completed)
  const countryIds = await loadCountryIdByIso3(supabaseAdmin).catch(() => new Map<string, number>())
  let bytes = 0
  let done = 0
  const started = Date.now()
  const target = dryRun ? requested : queue.length
  console.log(`gdelt backfill ${dryRun ? 'dry-run' : 'apply'} target_days=${target} queued=${queue.length} already=${completed.length}`)
  for (const day of queue) {
    if (dryRun && done >= requested) break
    const url = gdeltV1ExportUrl(day)
    const res = await politeFetch(url, { sourceKey: SOURCE, minIntervalMs: 2000, timeoutMs: 120_000, as: 'bytes' })
    if (res.status === 404) {
      console.log(`skip missing ${day}`)
      continue
    }
    if (!res.ok || !(res.data instanceof ArrayBuffer)) {
      console.log(`retry failed ${day} ${res.error ?? res.status}`)
      continue
    }
    const file = path.join(tmpdir(), `gdelt-${day}.export.CSV.zip`)
    const buf = Buffer.from(res.data)
    bytes += buf.byteLength
    await writeFile(file, buf)
    try {
      const events = parseGdeltExportTsv(await unzipGdeltExport(res.data))
      const points = gdeltPoints(events)
      const assigned = await assignLatLonBatch(supabaseAdmin, points).catch(() => new Map())
      const rolled = gdeltRegionAggs(events, assigned, points, countryIds, `${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6, 8)}`)
      const relations = aggregateGdeltRelations(events, `${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6, 8)}`)
      done += 1
      const elapsed = Date.now() - started
      const eta = done > 0 ? Math.round((elapsed / done) * Math.max(0, target - done) / 1000) : 0
      console.log(
        `${day} events=${events.length} regions=${rolled.aggs.length} dyads=${relations.dyads.length} countries=${relations.countries.length} mb=${(bytes / 1_000_000).toFixed(1)} eta_s=${eta}`,
      )
      if (dryRun) continue
      const prevByKey = new Map<string, Record<string, unknown>>()
      const regionIds = [...new Set(rolled.aggs.map((row) => row.region_id))]
      const days = [...new Set(rolled.aggs.map((row) => row.day))]
      for (let i = 0; i < regionIds.length; i += 200) {
        const { data, error } = await supabaseAdmin
          .from('crisis_region_daily')
          .select('region_id, day, stats')
          .eq('source', 'gdelt')
          .in('day', days)
          .in('region_id', regionIds.slice(i, i + 200))
        if (error) throw new Error(error.message)
        for (const row of data ?? []) prevByKey.set(`${row.region_id}|${row.day}`, asRecord(row.stats) ?? {})
      }
      const daily = rolled.aggs.map((agg) => {
        const prev = prevByKey.get(`${agg.region_id}|${agg.day}`)
        return gdeltAggToDaily(mergeGdeltStats(prev, agg), finite(prev?.mean_30d))
      })
      if (daily.length) await upsertDaily(supabaseAdmin, daily)
      const stored = await mergeStoredRelations(supabaseAdmin, relations.dyads, relations.countries)
      if (stored.missing) throw new Error('Paste docs/crisis/APPLY_DYADS.md before backfill --days')
      const dyadWrite = await upsertDyadDaily(supabaseAdmin, stored.dyads.map((row) => ({ ...row, stats: { ...row.stats } })))
      const countryWrite = await upsertCountryDaily(supabaseAdmin, stored.countries.map((row) => ({ ...row, stats: { ...row.stats } })))
      if (dyadWrite.skipped || countryWrite.skipped) throw new Error(dyadWrite.skipped ?? countryWrite.skipped ?? 'tables missing')
      completed.push(day)
      await supabaseAdmin.from('crisis_ingest_state').upsert({
        source: SOURCE,
        last_success_at: new Date().toISOString(),
        cursor: { completed, last_day: day },
        next_due_at: null,
      }, { onConflict: 'source' })
    } finally {
      await unlink(file).catch(() => undefined)
    }
  }
  console.log(`done days=${done} mb=${(bytes / 1_000_000).toFixed(1)} seconds=${Math.round((Date.now() - started) / 1000)}`)
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
