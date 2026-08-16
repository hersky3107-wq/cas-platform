/**
 * READ-ONLY check for the league PREDICTION CARD UI pass: looks for an
 * existing AAPL round (e.g. from a prior cron/admin-generate test) and, if
 * found, prints its assembled CardData. Does NOT call the orchestrator, does
 * NOT create a round, does NOT call any AI provider — pure DB read.
 *
 * Run:
 *   npx tsx scripts/league-card-preview.ts
 */
import { supabaseAdmin } from '../lib/supabase/server'
import { buildCardData } from '../lib/league/card-aggregate'
import { consensusHeadline, directionBadgeLabel } from '../lib/league/compliance'
import { LEAGUE_UI } from '../lib/league/i18n/dictionary'
import { isCategoryAllowed } from '../lib/league/jurisdiction/resolve'

const ROUND_COLUMNS =
  'id, proposition_text, category, color_bucket, instrument, horizon, resolution_rule, resolves_at, opened_at, actual_outcome, resolved_at'
const PREDICTION_COLUMNS =
  'model_id, brand, camp, league_tier, predicted_direction, predicted_value, reasoning_snippet, is_correct, cost_usd, predicted_at'

async function main() {
  const { data: rounds, error } = await supabaseAdmin
    .from('prediction_rounds')
    .select('id, instrument, opened_at')
    .order('opened_at', { ascending: false })
    .limit(10)

  if (error) {
    console.error('Query failed:', error.message)
    process.exit(1)
  }

  console.log(`Found ${rounds?.length ?? 0} round(s) total (most recent 10 shown):`)
  for (const r of rounds ?? []) {
    console.log(`  ${r.id}  ${r.instrument}  opened ${r.opened_at}`)
  }

  const aapl = (rounds ?? []).find((r) => r.instrument === 'AAPL')
  if (!aapl) {
    console.log('\nNo existing AAPL round found. Not generating one from this script (that would call paid AI providers).')
    return
  }

  const { data: roundRow } = await supabaseAdmin
    .from('prediction_rounds')
    .select(ROUND_COLUMNS)
    .eq('id', aapl.id)
    .single()
  const { data: predictionRows } = await supabaseAdmin
    .from('model_predictions')
    .select(PREDICTION_COLUMNS)
    .eq('round_id', aapl.id)
    .order('predicted_at', { ascending: true })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const card = buildCardData(roundRow as any, (predictionRows ?? []) as any)
  console.log('\n=== CardData for', aapl.id, '===')
  console.log(JSON.stringify(card, null, 2))

  // --- Layer A demo: same CardData, two locales. Predictions are NOT
  // recomputed — only the chrome strings (headline/badges/disclaimer) change. ---
  console.log('\n=== Layer A (i18n) — same predictions, chrome in EN vs KO ===')
  for (const locale of ['en', 'ko'] as const) {
    const t = LEAGUE_UI[locale]
    console.log(`\n[${locale}]`)
    console.log('  headline:  ', consensusHeadline(card.consensus, t))
    console.log('  disclaimer:', t.disclaimer.short)
    for (const model of card.models) {
      console.log(`  ${model.brand.padEnd(12)} ${directionBadgeLabel(model.direction, t)}`)
    }
  }

  // --- Layer B demo: same category, two jurisdictions. Visibility only —
  // content/tone above is untouched by this. ---
  console.log('\n=== Layer B (country gating) — category:', card.round.category, '===')
  const jurisdictions: { label: string; declaredCountry: string; ipCountry: string }[] = [
    { label: 'KR (declared+IP both South Korea)', declaredCountry: 'KR', ipCountry: 'KR' },
    { label: 'CN (declared+IP both China mainland)', declaredCountry: 'CN', ipCountry: 'CN' },
  ]
  for (const j of jurisdictions) {
    const allowed = isCategoryAllowed(card.round.category, j)
    console.log(`  ${j.label}: ${allowed ? 'SHOWN' : 'HIDDEN'}`)
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
