/**
 * Mark every prediction_round created before a cutoff as is_test.
 * Dry-run default. Public track record starts at launch.
 *
 *   npx tsx --env-file=.env.local --import ./scripts/stubs/register-server-only.mjs scripts/league/mark-prelaunch-test.ts
 *   npx tsx --env-file=.env.local --import ./scripts/stubs/register-server-only.mjs scripts/league/mark-prelaunch-test.ts --apply
 *   npx tsx --env-file=.env.local --import ./scripts/stubs/register-server-only.mjs scripts/league/mark-prelaunch-test.ts --cutoff 2026-10-06T00:00:00.000Z --apply
 */
import { supabaseAdmin } from '@/lib/supabase/server'
import { parseMarkPrelaunchArgs } from '@/lib/league/mark-prelaunch-args'

export { parseMarkPrelaunchArgs }

export async function runMarkPrelaunchTest(argv: string[] = process.argv.slice(2)): Promise<void> {
  const { apply, cutoff } = parseMarkPrelaunchArgs(argv)
  const { count, error } = await supabaseAdmin
    .from('prediction_rounds')
    .select('id', { count: 'exact', head: true })
    .lt('created_at', cutoff)
    .eq('is_test', false)
  if (error) throw new Error(error.message)
  const pending = count ?? 0
  console.log(`mark-prelaunch-test: ${apply ? 'APPLY' : 'dry-run'} cutoff=${cutoff} pending=${pending}`)
  if (!apply) {
    console.log('done  dry-run')
    return
  }
  const { data, error: updateError } = await supabaseAdmin
    .from('prediction_rounds')
    .update({ is_test: true })
    .lt('created_at', cutoff)
    .eq('is_test', false)
    .select('id')
  if (updateError) throw new Error(updateError.message)
  console.log(`done  wrote=${data?.length ?? 0}`)
}

const isMain = process.argv[1]?.replace(/\\/g, '/').endsWith('scripts/league/mark-prelaunch-test.ts')
if (isMain) {
  runMarkPrelaunchTest().catch((err) => {
    console.error(err instanceof Error ? err.message : 'mark-prelaunch-test failed')
    process.exit(1)
  })
}
