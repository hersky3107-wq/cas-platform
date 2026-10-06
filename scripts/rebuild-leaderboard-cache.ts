/**
 * Rebuild the leaderboard board cache once (same pass the hourly cron and
 * grading batches run). Requires supabase/migrations/20261006000009_league_board_cache.sql.
 *
 *   npx tsx --env-file=.env.local --import ./scripts/stubs/register-server-only.mjs scripts/rebuild-leaderboard-cache.ts
 *
 * --dry            compute and print a summary, write nothing (no table needed)
 * --include-test   with --dry only: include test rounds, to inspect the math
 */
import { planRefresh } from '@/lib/league/boards/cache'
import { loadBoardSource, refreshLeaderboardCache } from '@/lib/league/boards/cache.server'

async function main() {
  const dry = process.argv.includes('--dry')
  const includeTest = process.argv.includes('--include-test')
  if (includeTest && !dry) throw new Error('--include-test is only allowed with --dry (the cache is public)')

  if (!dry) {
    const result = await refreshLeaderboardCache()
    console.log(JSON.stringify(result, null, 2))
    if (!result.ok) process.exitCode = 1
    return
  }

  const nowMs = Date.now()
  const source = await loadBoardSource({ includeTest })
  const plan = planRefresh(source, nowMs)
  const all = plan.entries.find((entry) => entry.signature === 'all|h=all|p=all')
  console.log(
    JSON.stringify(
      {
        includeTest,
        rounds: source.rounds.length,
        predictions: source.predictions.length,
        categories: plan.withData,
        signatures: plan.entries.length,
        rows: plan.entries.length * 11 + 1,
        overall: all?.boards.banner.overall ?? null,
        byCategory: all?.boards.banner.byCategory.map((row) => [row.key, row.rate.correct, row.rate.n, row.rate.pct]),
        topModels: all?.boards.models.official.slice(0, 5).map((row) => [row.modelId, row.rank, row.rate.correct, row.rate.n, row.rate.pct]),
        camp: all?.boards.groups.camp.map((row) => [row.key, row.rate.correct, row.rate.n, row.rate.rounds, row.rate.pct]),
        agreement: all?.boards.agreement.byMajorityShare.map((row) => [row.key, row.rate.correct, row.rate.n]),
        extras: all?.boards.extras.seats.map((seat) => [seat.key, seat.own.n, seat.rounds, seat.extra.correct, seat.ai.correct]),
        crow: all?.boards.extras.crow,
        streaks: all?.boards.fame.longestStreaks.slice(0, 3),
        loneWolves: all?.boards.fame.loneWolves.slice(0, 3).map((row) => [row.modelId, row.count]),
        bluff: all?.boards.fame.bluff.slice(0, 3).map((row) => [row.modelId, row.rank, row.hits, row.band.n]),
        highlights: all?.boards.highlights.map((card) => [card.id, card.company ?? '', card.sides.map((s) => `${s.key}:${s.rate.correct}/${s.rate.n}`).join(' ')]),
        payloadKb: all ? Math.round(JSON.stringify(all.boards).length / 1024) : 0,
      },
      null,
      2,
    ),
  )
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e)
  process.exitCode = 1
})
