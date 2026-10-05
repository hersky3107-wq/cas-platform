/**
 * Class-based void of legacy same-day 24h 1d rounds. Dry-run default.
 *
 *   npx tsx --env-file=.env.local --import ./scripts/stubs/register-server-only.mjs scripts/league/void-legacy-24h.ts
 *   npx tsx --env-file=.env.local --import ./scripts/stubs/register-server-only.mjs scripts/league/void-legacy-24h.ts --apply
 */
import { parseLegacy24hVoidArgs, runLegacySameDay24hVoid } from '@/lib/league/admin-void-legacy-24h'

async function main() {
  const { apply } = parseLegacy24hVoidArgs(process.argv.slice(2))
  const result = await runLegacySameDay24hVoid(apply)
  if (!result.ok) {
    if (result.plan) {
      console.log(
        JSON.stringify(
          {
            dryRun: !apply,
            wrote: false,
            error: result.error,
            count: result.plan.count,
            expectedCount: result.plan.expectedCount,
            rounds: result.plan.rounds.map((r) => ({
              id: r.id,
              instrument: r.instrument,
              horizon: r.horizon,
              actual_outcome: r.actual_outcome,
              consensus_is_correct: r.consensus_is_correct,
            })),
            rule: result.plan.rule,
          },
          null,
          2,
        ),
      )
    } else {
      console.error(result.error)
    }
    process.exit(2)
  }
  const list = result.plan.rounds.map((r) => ({
    id: r.id,
    instrument: r.instrument,
    horizon: r.horizon,
    actual_outcome: r.actual_outcome,
    consensus_is_correct: r.consensus_is_correct,
  }))
  console.log(
    JSON.stringify(
      {
        dryRun: result.dryRun,
        wrote: !result.dryRun,
        count: result.plan.count,
        expectedCount: result.plan.expectedCount,
        countMatches: result.plan.countMatches,
        reason: result.plan.reason,
        rule: result.plan.rule,
        rounds: list,
        ...('refundedCredits' in result ? { refundedCredits: result.refundedCredits, voided: result.voided } : {}),
      },
      null,
      2,
    ),
  )
  if (!result.plan.countMatches) process.exit(2)
}

void main()
