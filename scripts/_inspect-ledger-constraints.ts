/**
 * One-off inspection for the side-token migration (2026-08-29): dump the live
 * CHECK constraints on the two ledger tables and count predicted_direction
 * values, so the CHECK can be widened safely (a 'flat' row in history would
 * make a flat-less CHECK fail to validate).
 *
 *   npx tsx --env-file=.env.local scripts/_inspect-ledger-constraints.ts
 */
async function runQuery(sql: string): Promise<unknown> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const token = process.env.SUPABASE_ACCESS_TOKEN
  if (!url || !token) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_ACCESS_TOKEN')
  const ref = new URL(url).hostname.split('.')[0]
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  })
  const body = await res.text()
  if (!res.ok) throw new Error(`Management API ${res.status}: ${body.slice(0, 400)}`)
  return JSON.parse(body)
}

async function main() {
  console.log('=== CHECK constraints (pg_constraint) ===')
  console.log(
    JSON.stringify(
      await runQuery(`
        select conrelid::regclass::text as table, conname, pg_get_constraintdef(oid) as def
        from pg_constraint
        where conrelid in ('public.model_predictions'::regclass, 'public.prediction_rounds'::regclass)
          and contype = 'c'
        order by 1, 2;
      `),
      null,
      2
    )
  )

  console.log('=== predicted_direction value counts ===')
  console.log(
    JSON.stringify(
      await runQuery(
        `select coalesce(predicted_direction, '(null)') as dir, count(*)::int as n from public.model_predictions group by 1 order by 2 desc;`
      ),
      null,
      2
    )
  )

  console.log('=== existing kind/subject/qualifier columns? ===')
  console.log(
    JSON.stringify(
      await runQuery(`
        select table_name, column_name, data_type, column_default
        from information_schema.columns
        where table_schema = 'public'
          and ((table_name = 'prediction_rounds' and column_name in ('proposition_kind', 'subject_label'))
            or (table_name = 'model_predictions' and column_name = 'predicted_qualifier_text'));
      `),
      null,
      2
    )
  )
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
