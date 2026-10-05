/**
 * Queue-time simulation. No provider calls.
 *
 *   npx tsx scripts/league/load-sim.ts 100
 *
 * Prints the ETA the card would show for each queued position when the
 * running slots are already full.
 */

import { queueWaitEstimate } from '../../lib/league/generation/policy'

const jobs = Math.max(1, Math.floor(Number(process.argv[2] ?? 100)))
const maxRunning = Math.max(1, Math.floor(Number(process.argv[3] ?? 3)))
const running = maxRunning

const rows = Array.from({ length: jobs }, (_, index) =>
  queueWaitEstimate({ queuedAhead: index, running, maxRunning }),
)

const first = rows[0]!
const middle = rows[Math.floor((jobs - 1) / 2)]!
const last = rows[jobs - 1]!

console.log(
  JSON.stringify(
    {
      jobs,
      maxRunning,
      running,
      providers: 'mocked',
      first: { position: first.position, etaMinutes: first.etaMinutes },
      middle: { position: middle.position, etaMinutes: middle.etaMinutes },
      last: { position: last.position, etaMinutes: last.etaMinutes },
    },
    null,
    2,
  ),
)
