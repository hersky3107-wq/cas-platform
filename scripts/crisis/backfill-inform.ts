/**
 * Load INFORM country scores once.
 *
 *   npx tsx --env-file=.env.local scripts/crisis/backfill-inform.ts --dry-run
 *   npx tsx --env-file=.env.local scripts/crisis/backfill-inform.ts
 */
import { existsSync } from 'node:fs'
import path from 'node:path'
import { informSource } from '../../lib/crisis/ingest/sources/inform'
import { runSource } from '../../lib/crisis/ingest/run'
import { supabaseAdmin } from '../../lib/supabase/server'

function requireEnvLocal(): void {
  const envPath = path.resolve(process.cwd(), '.env.local')
  if (!existsSync(envPath)) {
    throw new Error('Copy cas-platform/.env.local into cas-platform-crisis first')
  }
}

async function main(): Promise<void> {
  requireEnvLocal()
  const dryRun = process.argv.includes('--dry-run')
  const summary = await runSource(informSource, supabaseAdmin, { dryRun, force: true })
  console.log(JSON.stringify(summary, null, 2))
  if (summary.status === 'error') process.exit(1)
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
