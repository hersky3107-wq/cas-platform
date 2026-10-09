/**
 * Layer-1 regional risk score. Reads existing tables; writes crisis_region_flags on --apply.
 * Dry-run still reads the database and prints the top 30 explanations. No LLM. No Open-Meteo/GloFAS calls.
 *
 *   npx tsx --env-file=.env.local scripts/crisis/score.ts
 *   npx tsx --env-file=.env.local scripts/crisis/score.ts --apply
 *
 * The sweep does not write scores unless CRISIS_SCORE_WRITE_ENABLED is set.
 * --apply on this script is the explicit write.
 */
import { existsSync } from 'node:fs'
import path from 'node:path'
import { runLayer1Score } from '../../lib/crisis/score/job'

function wants(flag: string): boolean {
  return process.argv.includes(flag)
}

async function main(): Promise<void> {
  const envPath = path.resolve(process.cwd(), '.env.local')
  if (!existsSync(envPath)) throw new Error('Copy cas-platform/.env.local into cas-platform-crisis first')
  const { supabaseAdmin } = await import('../../lib/supabase/server')
  const apply = wants('--apply')
  const result = await runLayer1Score(supabaseAdmin, { dryRun: !apply, write: apply })
  console.log(`scored=${result.scored} cards=${result.cards} neighbors=${result.neighborSource} day=${result.day}`)
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
