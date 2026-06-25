/**
 * Throwaway probe — verifies all governance sources fetch+render via gatherJejuSnapshot.
 *
 * Runs lib/jeju/brief.ts beat-1 collection only (no DEEP pipeline, no AI calls).
 *
 * Run:
 *   $env:NODE_PATH=".\scripts\stubs"; npx tsx --env-file=.env.local scripts/probe-snapshot.ts
 */

import { gatherJejuSnapshot } from '@/lib/jeju/brief'

const TEXT_PREVIEW = 400

const EXPECTED_IDS = [
  'kpx-jeju-power',
  'kamis-jeju-products',
  'kma-jeju-weather',
  'kma-jeju-midterm',
  'kpx-jeju-smp',
  'kma-jeju-warning',
  'keco-jeju-evcharger',
  'jeju-citrus-production',
  'jeju-cargo-throughput',
] as const

function sep(char = '─') {
  return char.repeat(70)
}

function preview(text: string): string {
  const t = text.trim()
  if (t.length <= TEXT_PREVIEW) return t
  return `${t.slice(0, TEXT_PREVIEW)}\n... [${t.length - TEXT_PREVIEW} more chars]`
}

async function main(): Promise<void> {
  console.log(sep('═'))
  console.log('Jeju governance snapshot probe (gatherJejuSnapshot)')
  console.log(`Expected sources: ${EXPECTED_IDS.join(', ')}`)
  console.log(sep('═'))

  const start = Date.now()
  let snapshot: Awaited<ReturnType<typeof gatherJejuSnapshot>>

  try {
    snapshot = await gatherJejuSnapshot()
  } catch (err: unknown) {
    const elapsed = ((Date.now() - start) / 1000).toFixed(1)
    console.error(`\nFATAL (uncaught) after ${elapsed}s:`, err)
    process.exit(1)
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1)

  console.log(`\nsnapshot.ok: ${snapshot.ok}  |  sources: ${snapshot.sources.length}  |  ⏱  ${elapsed}초`)
  console.log(sep('─'))

  for (const id of EXPECTED_IDS) {
    const s = snapshot.sources.find((src) => src.id === id)
    console.log(`\n[${id}]`)
    if (!s) {
      console.log('  ok: false')
      console.log('  error: (missing from snapshot — not registered in GOVERNANCE_SOURCE_IDS?)')
      continue
    }
    console.log(`  ok: ${s.ok}`)
    if (s.ok) {
      console.log(`  text (${s.text.length} chars, first ${TEXT_PREVIEW}):`)
      console.log(preview(s.text))
    } else {
      console.log(`  error: ${s.error ?? '(none)'}`)
    }
  }

  // Any extra sources returned beyond the expected six.
  const extras = snapshot.sources.filter((s) => !EXPECTED_IDS.includes(s.id as (typeof EXPECTED_IDS)[number]))
  if (extras.length > 0) {
    console.log(`\n${sep('─')}`)
    console.log('Extra sources (not in expected list):')
    for (const s of extras) {
      console.log(`  • ${s.id}  ok=${s.ok}`)
    }
  }

  const okCount = snapshot.sources.filter((s) => s.ok).length
  console.log(`\n${sep('═')}`)
  console.log(`Done. ${okCount}/${snapshot.sources.length} sources ok (${elapsed}초)`)
}

main().catch((err) => {
  console.error('Uncaught error:', err)
  process.exit(1)
})
