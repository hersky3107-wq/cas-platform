/**
 * Inventory-blind Stage 1 director print for gold 1d, gold 3m, BTC 1d, AAPL 1d.
 * One Gemini Flash call per case. Does NOT pass packet inventory.
 *
 * Run: npx tsx --env-file=.env.local --import ./scripts/stubs/register-server-only.mjs scripts/print-gold-director-stage1.ts
 */
import { buildCatalogRankedRoundInput } from '../lib/league/catalog'
import { runDirectorStage1 } from '../lib/league/research'
import { buildStage1Prompt } from '../lib/league/research-director'
import type { UiHorizon } from '../lib/league/horizon'

const CASES: { label: string; instrument: string; horizon: UiHorizon }[] = [
  { label: 'gold 1d', instrument: 'XAU/USD', horizon: '1d' },
  { label: 'gold 3m', instrument: 'XAU/USD', horizon: '3m' },
  { label: 'BTC 1d', instrument: 'BTC/USD', horizon: '1d' },
  { label: 'AAPL 1d', instrument: 'AAPL', horizon: '1d' },
]

async function main() {
  console.log('===== STAGE 1 SYSTEM PROMPT =====')
  console.log(buildStage1Prompt())

  for (const c of CASES) {
    const seed = buildCatalogRankedRoundInput(c.instrument, c.horizon, new Date())
    if (!seed) throw new Error(`${c.instrument} is not in the public catalog`)
    const round = {
      proposition_text: seed.proposition_text,
      instrument: seed.instrument,
      category: seed.category,
      horizon: seed.horizon,
      resolution_rule: seed.resolution_rule,
      resolves_at: seed.resolves_at,
    }
    console.log(`\n\n========== ${c.label.toUpperCase()} =====`)
    console.log(JSON.stringify(round, null, 2))
    const result = await runDirectorStage1(round)
    console.log(`model=${result.model} costUsd=${result.costUsd}`)
    if (result.error) console.log('error:', result.error)
    console.log('----- RAW -----')
    console.log(result.rawText || '(empty)')
    console.log('----- PARSED NEEDS -----')
    console.log(JSON.stringify(result.needs, null, 2))
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
