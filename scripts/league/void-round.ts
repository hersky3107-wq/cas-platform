/**
 * Admin-only void. Dry-run default; --apply writes.
 *
 *   npx tsx --env-file=.env.local --import ./scripts/stubs/register-server-only.mjs scripts/league/void-round.ts --round <uuid> --reason data_error
 *   npx tsx --env-file=.env.local --import ./scripts/stubs/register-server-only.mjs scripts/league/void-round.ts --round <uuid> --reason data_error --apply
 */
import { parseVoidRoundArgs, runVoidRound } from '@/lib/league/admin-void-round'

async function main() {
  const parsed = parseVoidRoundArgs(process.argv.slice(2))
  if ('error' in parsed) {
    console.error(parsed.error)
    process.exit(1)
  }
  const result = await runVoidRound(parsed)
  if (!result.ok) {
    console.error(result.error)
    process.exit(1)
  }
  if (result.dryRun) {
    console.log(
      JSON.stringify(
        {
          dryRun: true,
          wrote: false,
          plan: result.plan,
        },
        null,
        2,
      ),
    )
    return
  }
  console.log(
    JSON.stringify(
      {
        dryRun: false,
        wrote: true,
        refundedCredits: result.refundedCredits,
        plan: result.plan,
      },
      null,
      2,
    ),
  )
}

void main()
