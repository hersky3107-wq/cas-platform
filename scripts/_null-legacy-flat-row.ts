/**
 * One-off: null the single legacy 'flat' row (k-exaone-2.0 @ f3752ddd) so the
 * widened direction CHECK can be VALIDATED, then confirm counts + constraint state.
 *
 *   npx tsx --env-file=.env.local scripts/_null-legacy-flat-row.ts
 */
import { directionBadgeLabel } from '../lib/league/compliance'
import { roundHitRecord } from '../lib/league/round-hit'
import { LEAGUE_UI } from '../lib/league/i18n/dictionary'

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
  if (!res.ok) throw new Error(`Management API ${res.status}: ${body.slice(0, 600)}`)
  return JSON.parse(body)
}

type Row = {
  id: string
  model_id: string
  round_id: string
  predicted_direction: string | null
  predicted_magnitude_pct: number | null
  is_correct: boolean | null
  reasoning_snippet: string | null
}

function toDirection(raw: string | null): 'up' | 'down' | 'flat' | null {
  return raw === 'up' || raw === 'down' || raw === 'flat' ? raw : null
}

async function main() {
  console.log('=== (1) Legacy flat row ===')
  const rows = (await runQuery(`
    select id, model_id, round_id, predicted_direction, predicted_magnitude_pct, is_correct, reasoning_snippet
    from public.model_predictions
    where model_id = 'k-exaone-2.0'
      and round_id::text like 'f3752ddd%'
    limit 5;
  `)) as Row[]
  if (rows.length !== 1) throw new Error(`expected exactly 1 row, got ${rows.length}: ${JSON.stringify(rows)}`)
  const row = rows[0]!
  console.log(JSON.stringify(row, null, 2))

  console.log('\n=== (2) Hit denominator + exclusion check ===')
  const roundModels = (await runQuery(`
    select model_id, predicted_direction, is_correct
    from public.model_predictions
    where round_id = '${row.round_id}'
    order by model_id;
  `)) as Array<{ model_id: string; predicted_direction: string | null; is_correct: boolean | null }>

  const hit = roundHitRecord(roundModels)
  const ungraded = roundModels.length - hit.graded
  console.log(`round_id: ${row.round_id}`)
  console.log(`total models: ${roundModels.length}`)
  console.log(`roundHitRecord: ${hit.correct}/${hit.graded} (correct/graded)`)
  console.log(`ungraded (total - graded): ${ungraded}`)
  console.log(`target row is_correct: ${row.is_correct}`)
  console.log(`target row in hit denominator: ${row.is_correct !== null}`)
  if (row.is_correct !== null) throw new Error('expected is_correct null on legacy flat row')
  if (hit.graded !== 38 || hit.correct !== 34) {
    throw new Error(`expected 34/38 hit record, got ${hit.correct}/${hit.graded}`)
  }
  if (ungraded !== 2) throw new Error(`expected 2 ungraded, got ${ungraded}`)

  console.log('\n=== (3) Null predicted_direction on that row only ===')
  const updated = (await runQuery(`
    update public.model_predictions
    set predicted_direction = null
    where id = '${row.id}'
      and model_id = 'k-exaone-2.0'
      and round_id = '${row.round_id}'
      and predicted_direction = 'flat'
    returning id, model_id, round_id, predicted_direction, predicted_magnitude_pct, is_correct, reasoning_snippet;
  `)) as Row[]
  if (updated.length !== 1) throw new Error(`update returned ${updated.length} rows`)
  console.log(JSON.stringify(updated[0], null, 2))

  console.log('\n=== (4) predicted_direction GROUP BY (after) ===')
  console.log(
    JSON.stringify(
      await runQuery(`
        select coalesce(predicted_direction, '(null)') as dir, count(*)::int as n
        from public.model_predictions
        group by 1
        order by 2 desc;
      `),
      null,
      2
    )
  )

  console.log('\n=== (5) VALIDATE direction CHECK ===')
  await runQuery(`
    alter table public.model_predictions
    validate constraint model_predictions_direction_chk;
  `)
  console.log('VALIDATE CONSTRAINT succeeded')
  console.log(
    JSON.stringify(
      await runQuery(`
        select conname, pg_get_constraintdef(oid) as def, convalidated
        from pg_constraint
        where conrelid = 'public.model_predictions'::regclass
          and conname = 'model_predictions_direction_chk';
      `),
      null,
      2
    )
  )

  console.log('\n=== (6) Tile + card copy (aggregate logic, post-null) ===')
  const ko = LEAGUE_UI.ko
  const en = LEAGUE_UI.en
  const dirBefore = toDirection('flat')
  const dirAfter = toDirection(updated[0]!.predicted_direction)
  console.log(`toDirection('flat') → ${dirBefore} → badge: ${directionBadgeLabel(dirBefore, ko)} / ${directionBadgeLabel(dirBefore, en)}`)
  console.log(`toDirection(null) → ${dirAfter} → badge: ${directionBadgeLabel(dirAfter, ko)} / ${directionBadgeLabel(dirAfter, en)}`)

  const hitAfter = roundHitRecord(roundModels.map((m) => (m.model_id === 'k-exaone-2.0' ? { ...m, predicted_direction: null } : m)))
  const ungradedAfter = roundModels.length - hitAfter.graded
  console.log(`hit record unchanged: ${hitAfter.correct}/${hitAfter.graded}`)
  console.log(`verdict ungradedNote(ko): ${ko.verdict.ungradedNote(ungradedAfter)}`)
  console.log(`verdict ungradedNote(en): ${en.verdict.ungradedNote(ungradedAfter)}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
