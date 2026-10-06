/**
 * Builds the divination chart (사주 / 구성기학) for one round's divination row
 * without re-running the seat or the reading. Dry-run by default: prints the
 * subject, chart, reader lines and the tile line in every locale, and writes
 * nothing (subject cache included). --apply stores the chart on the row and
 * the subject in league_divination_subject_cache.
 *
 *   npx tsx --env-file=.env.local --import ./scripts/stubs/register-server-only.mjs scripts/league/divination-chart-backfill.ts --round <id>
 *   npx tsx --env-file=.env.local --import ./scripts/stubs/register-server-only.mjs scripts/league/divination-chart-backfill.ts --round <id> --apply
 */
import { buildDivinationChart, divinationChartPromptLines } from '@/lib/league/extra/divination-chart'
import { divinationChartLine } from '@/lib/league/extra/divination-chart-copy'
import { parseDivinationChart } from '@/lib/league/extra/divination-chart-types'
import { supabaseSubjectCacheStore } from '@/lib/league/extra/divination-live.server'
import { resolveSubjectBirth, type SubjectCacheStore } from '@/lib/league/extra/divination-wikidata'
import { LEAGUE_LOCALES } from '@/lib/league/i18n/locales'
import { supabaseAdmin } from '@/lib/supabase/server'

function argValue(name: string): string | null {
  const at = process.argv.indexOf(name)
  return at >= 0 ? (process.argv[at + 1] ?? null) : null
}

async function main() {
  const roundId = argValue('--round')
  if (!roundId) throw new Error('--round <id> is required')
  const apply = process.argv.includes('--apply') && !process.argv.includes('--dry-run')

  const { data: round, error } = await supabaseAdmin
    .from('prediction_rounds')
    .select('id, proposition_text, category, instrument, subject_label, resolves_at, opened_at, created_at')
    .eq('id', roundId)
    .maybeSingle()
  if (error || !round) throw new Error(`round ${roundId}: ${error?.message ?? 'not found'}`)

  const { data: row, error: rowError } = await supabaseAdmin
    .from('model_predictions')
    .select('model_id, predicted_direction, divination_chart')
    .eq('round_id', roundId)
    .eq('model_id', 'divination')
    .maybeSingle()
  if (rowError) throw new Error(`divination row: ${rowError.message}`)

  const readOnly: SubjectCacheStore = { get: (key) => supabaseSubjectCacheStore.get(key), put: async () => {} }
  const store = apply ? supabaseSubjectCacheStore : readOnly
  const chart = await buildDivinationChart(round, {
    resolveSubject: (name, category) => resolveSubjectBirth(name, category, { store }),
  })
  const stored = chart ? parseDivinationChart(JSON.parse(JSON.stringify(chart))) : null

  console.log(
    JSON.stringify(
      {
        mode: apply ? 'apply' : 'dry-run',
        round: {
          id: round.id,
          category: round.category,
          subject: round.subject_label,
          proposition: round.proposition_text,
          resolvesAt: round.resolves_at,
        },
        divinationRow: row ? { direction: row.predicted_direction, hasChart: row.divination_chart != null } : null,
        chart,
        roundTripsThroughStorage: chart ? JSON.stringify(stored) === JSON.stringify(chart) : null,
        readerLines: chart ? divinationChartPromptLines(chart) : [],
        tileLine: Object.fromEntries(LEAGUE_LOCALES.map((locale) => [locale, divinationChartLine(locale, stored)])),
      },
      null,
      2,
    ),
  )

  if (!chart) {
    console.log('No chart for this round (category, subject or Wikidata). Nothing to write.')
    return
  }
  if (!row) {
    console.log('Round has no divination row. Nothing to write.')
    return
  }
  if (!apply) {
    console.log('No write. Pass --apply to store the chart on the divination row.')
    return
  }
  const { error: updateError } = await supabaseAdmin
    .from('model_predictions')
    .update({ divination_chart: chart })
    .eq('round_id', roundId)
    .eq('model_id', 'divination')
  if (updateError) throw new Error(`update divination_chart: ${updateError.message}`)
  console.log('Stored divination_chart on the divination row.')
}

const isMain = process.argv[1]?.replace(/\\/g, '/').endsWith('scripts/league/divination-chart-backfill.ts')
if (isMain) {
  main().catch((err) => {
    console.error(err instanceof Error ? (err.stack ?? err.message) : String(err))
    process.exit(1)
  })
}
