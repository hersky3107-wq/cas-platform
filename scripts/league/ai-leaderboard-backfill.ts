/**
 * Backfill LMArena leaderboard snapshots into league_ai_leaderboard.
 *
 * Default is dry-run: prints the plan and makes NO network call.
 * Only --apply downloads parquet files with rate limiting, cache, and upserts rows.
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
  const plan = planAiLeaderboardIngest(now, 'full')
  if (!apply) {
    log(
      `LMArena leaderboard backfill: dry-run. Would download ${plan.months} months (${plan.sinceDate}…${plan.untilDate}) for arenas ${plan.arenas.join(', ')} from ${plan.dataset}. Planned parquet files:\n  ${plan.plannedFiles.join('\n  ')}\nArtificial Analysis: ${plan.artificialAnalysis}. ${plan.attribution}. No request sent.`,
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
    `LMArena leaderboard backfill: APPLY arenas=${report.arenas.join(',') || '(none)'} upserted=${report.upserted} skipped=${report.skipped} cacheHits=${report.cacheHits} downloads=${report.downloads} unmapped_orgs=${report.unmappedOrganizations.join('|') || '(none)'}`,
  )
}

const isMain = process.argv[1]?.replace(/\\/g, '/').endsWith('scripts/league/ai-leaderboard-backfill.ts')
if (isMain) {
  runAiLeaderboardBackfill().catch((err) => {
    console.error(err instanceof Error ? err.stack ?? err.message : String(err))
    process.exit(1)
  })
}
