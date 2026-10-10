/**
 * Check published predictions against GDACS, ReliefWeb, USGS, and web search.
 *
 *   npm run crisis:outcomes
 *   npm run crisis:outcomes -- --dry-run
 */
import { runOutcomeCheck } from '../../lib/crisis/outcomes/scheduled'

function hasFlag(name: string): boolean {
  return process.argv.includes(name)
}

async function main(): Promise<void> {
  const now = new Date()
  const summary = await runOutcomeCheck({ now, dryRun: hasFlag('--dry-run'), force: true })
  console.log(JSON.stringify({ at: now.toISOString(), ...summary }))
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
