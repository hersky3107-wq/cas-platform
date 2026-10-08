/**
 * Local crisis ingest sweep. crisis-work is not deployed — do not add a Vercel cron.
 *
 *   npx tsx --env-file=.env.local scripts/crisis/sweep.ts --once --dry-run
 *   npx tsx --env-file=.env.local scripts/crisis/sweep.ts --once --only=usgs
 *   npm run crisis:sweep
 */
import { existsSync } from 'node:fs'
import path from 'node:path'
import { CRISIS_SOURCES, sourceByKey } from '../../lib/crisis/ingest/registry'
import { isDue, loadState, runSource } from '../../lib/crisis/ingest/run'
import { supabaseAdmin } from '../../lib/supabase/server'

const LOOP_MS = 60_000

function requireEnvLocal(): void {
  const envPath = path.resolve(process.cwd(), '.env.local')
  if (!existsSync(envPath)) {
    throw new Error('Copy cas-platform/.env.local into cas-platform-crisis first')
  }
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name)
}

function argValue(flag: string): string | null {
  const prefix = `${flag}=`
  const hit = process.argv.find((item) => item.startsWith(prefix))
  return hit ? hit.slice(prefix.length) : null
}

async function pass(opts: { dryRun: boolean; only: string | null }): Promise<void> {
  const now = new Date()
  const sources = opts.only
    ? [sourceByKey(opts.only)].filter((item): item is NonNullable<typeof item> => Boolean(item))
    : CRISIS_SOURCES
  if (opts.only && !sources.length) {
    throw new Error(`unknown source ${opts.only}`)
  }

  for (const source of sources) {
    if (!opts.only && !opts.dryRun) {
      const state = await loadState(supabaseAdmin, source.key)
      if (!isDue(state, now, false)) continue
    }
    const summary = await runSource(source, supabaseAdmin, {
      dryRun: opts.dryRun,
      force: Boolean(opts.only),
      now,
    })
    console.log(
      JSON.stringify({
        at: now.toISOString(),
        ...summary,
      }),
    )
  }
}

async function main(): Promise<void> {
  requireEnvLocal()
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required')
  }
  const dryRun = hasFlag('--dry-run')
  const once = hasFlag('--once')
  const only = argValue('--only')

  if (once) {
    await pass({ dryRun, only })
    return
  }

  console.log(`crisis sweep loop every ${LOOP_MS / 1000}s dryRun=${dryRun} only=${only ?? '*'}`)
  for (;;) {
    try {
      await pass({ dryRun, only })
    } catch (error) {
      console.error(error instanceof Error ? error.message : error)
    }
    await new Promise((resolve) => setTimeout(resolve, LOOP_MS))
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
