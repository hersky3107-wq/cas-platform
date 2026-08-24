/**
 * Read-only: report prediction_rationale_translations health.
 *  - total row count
 *  - count grouped by locale
 *  - the distinct round_ids present (resolved via model_predictions)
 *
 * Run: npx tsx --env-file=.env.local --import ./scripts/stubs/register-server-only.mjs scripts/audit-translation-cache.ts
 */
import { supabaseAdmin } from '../lib/supabase/server'

async function main() {
  const { count: total, error: countErr } = await supabaseAdmin
    .from('prediction_rationale_translations')
    .select('prediction_id', { count: 'exact', head: true })
  console.log(
    `prediction_rationale_translations total rows: ${total ?? 0}` +
      (countErr ? `  [count error: ${countErr.message}]` : '')
  )

  const { data, error } = await supabaseAdmin
    .from('prediction_rationale_translations')
    .select('prediction_id, locale')
  if (error) {
    console.log(`SELECT prediction_id, locale FAILED: ${error.message}`)
    console.log('=> the table is not reachable via PostgREST (schema cache / migration).')
    return
  }

  const rows = data ?? []
  const byLocale = new Map<string, number>()
  for (const r of rows) {
    const loc = String(r.locale)
    byLocale.set(loc, (byLocale.get(loc) ?? 0) + 1)
  }
  console.log('count(*) grouped by locale:')
  if (byLocale.size === 0) console.log('  (none)')
  for (const [loc, n] of [...byLocale.entries()].sort()) console.log(`  ${loc}: ${n}`)

  const ids = Array.from(new Set(rows.map((r) => String(r.prediction_id))))
  if (ids.length === 0) {
    console.log('distinct round_ids present: (none — table is empty)')
    return
  }
  const { data: preds, error: pErr } = await supabaseAdmin
    .from('model_predictions')
    .select('id, round_id')
    .in('id', ids)
  if (pErr) throw new Error(`round_id resolve failed (${pErr.message})`)
  const roundIds = Array.from(new Set((preds ?? []).map((p) => String(p.round_id))))
  console.log(`distinct round_ids present (${roundIds.length}):`)
  for (const rid of roundIds.sort()) console.log(`  ${rid}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
