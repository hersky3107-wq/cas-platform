/**
 * Backfill LMArena leaderboard snapshots into league_ai_leaderboard.
 *
 * Default is dry-run: prints the plan and makes NO network call.
 * Only --apply hits Hugging Face datasets-server and upserts rows.
 *
 *   npx tsx --env-file=.env.local --import ./scripts/stubs/register-server-only.mjs scripts/league/ai-leaderboard-backfill.ts
 *   npx tsx --env-file=.env.local --import ./scripts/stubs/register-server-only.mjs scripts/league/ai-leaderboard-backfill.ts --apply
 */

import {
  ingestAiLeaderboard,
  planAiLeaderboardIngest,
  type AiLeaderboardIo,
} from '@/lib/league/ai-ranking/ingest'

export function parseAiLeaderboardBackfillArgs(argv: string[]): { apply: boolean } {
  let apply = false
  for (const arg of argv) {
    if (arg === '--apply') apply = true
    if (arg === '--dry-run') apply = false
  }
  return { apply }
}

export async function runAiLeaderboardBackfill(
  argv: string[] = process.argv.slice(2),
  io: AiLeaderboardIo = {},
): Promise<void> {
  const { apply } = parseAiLeaderboardBackfillArgs(argv)
  const log = io.log ?? ((message: string) => console.log(message))
  const now = io.now?.() ?? new Date()
  const plan = planAiLeaderboardIngest(now)
  if (!apply) {
    log(
      `LMArena leaderboard backfill: dry-run. Would fetch ${plan.months} months (${plan.sinceDate}…${plan.untilDate}) for arenas ${plan.arenas.join(', ')} (whichever exist) from ${plan.dataset}. Artificial Analysis: ${plan.artificialAnalysis}. ${plan.attribution}. No request sent.`,
    )
    return
  }

  const report = await ingestAiLeaderboard({
    arenas: plan.arenas,
    split: 'full',
    sinceDate: plan.sinceDate,
    io,
  })
  log(
    `LMArena leaderboard backfill: APPLY arenas=${report.arenas.join(',') || '(none)'} upserted=${report.upserted} skipped=${report.skipped} unmapped_orgs=${report.unmappedOrganizations.join('|') || '(none)'}`,
  )
}

const isMain = process.argv[1]?.replace(/\\/g, '/').endsWith('scripts/league/ai-leaderboard-backfill.ts')
if (isMain) {
  runAiLeaderboardBackfill().catch((err) => {
    console.error(err instanceof Error ? err.message : 'ai leaderboard backfill failed')
    process.exit(1)
  })
}
