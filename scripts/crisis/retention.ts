/**
 * Retention report (default) / delete (--apply).
 * Signals older than 90 days. Forecast metrics superseded by a newer issued_at
 * and older than 30 days.
 *
 *   npx tsx --env-file=.env.local scripts/crisis/retention.ts
 *   npx tsx --env-file=.env.local scripts/crisis/retention.ts --apply
 */
import { existsSync } from 'node:fs'
import path from 'node:path'
import { supabaseAdmin } from '../../lib/supabase/server'

function requireEnvLocal(): void {
  const envPath = path.resolve(process.cwd(), '.env.local')
  if (!existsSync(envPath)) {
    throw new Error('Copy cas-platform/.env.local into cas-platform-crisis first')
  }
}

async function main(): Promise<void> {
  requireEnvLocal()
  const apply = process.argv.includes('--apply')
  const signalCutoff = new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString()
  const metricCutoff = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString()

  const { count: signalCount, error: signalError } = await supabaseAdmin
    .from('crisis_raw_signals')
    .select('id', { count: 'exact', head: true })
    .lt('fetched_at', signalCutoff)
  if (signalError) throw new Error(signalError.message)

  const { data, error } = await supabaseAdmin
    .from('crisis_region_metrics')
    .select('region_id, metric, valid_time, issued_at')
    .lt('issued_at', metricCutoff)
    .limit(20000)
  if (error) throw new Error(error.message)
  const latest = new Map<string, string>()
  for (const row of data ?? []) {
    const key = `${row.region_id}|${row.metric}|${row.valid_time}`
    const prev = latest.get(key)
    if (!prev || row.issued_at > prev) latest.set(key, row.issued_at)
  }
  const metricRows = (data ?? []).filter((row) => latest.get(`${row.region_id}|${row.metric}|${row.valid_time}`) !== row.issued_at)

  console.log(
    JSON.stringify(
      {
        dry_run: !apply,
        signals_older_than_90d: signalCount ?? 0,
        signal_cutoff: signalCutoff,
        metrics_superseded_older_than_30d: metricRows.length,
        metric_cutoff: metricCutoff,
        metric_sample: metricRows.slice(0, 10),
      },
      null,
      2,
    ),
  )

  if (!apply) {
    console.log('No deletes. Pass --apply to remove the reported rows.')
    return
  }

  if ((signalCount ?? 0) > 0) {
    const { error } = await supabaseAdmin.from('crisis_raw_signals').delete().lt('fetched_at', signalCutoff)
    if (error) throw new Error(`signal delete: ${error.message}`)
  }

  for (const row of metricRows) {
    const { error } = await supabaseAdmin
      .from('crisis_region_metrics')
      .delete()
      .eq('region_id', row.region_id)
      .eq('metric', row.metric)
      .eq('valid_time', row.valid_time)
      .eq('issued_at', row.issued_at)
    if (error) throw new Error(`metric delete: ${error.message}`)
  }
  console.log(`deleted signals=${signalCount ?? 0} metrics=${metricRows.length}`)
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
