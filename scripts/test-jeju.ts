/**
 * Manual smoke-test for the Jeju data connectors (lib/jeju/connectors.ts).
 *
 * Requires KPX_SERVICE_KEY in .env.local. Run from project root:
 *   $env:NODE_PATH=".\scripts\stubs"; npx tsx --env-file=.env.local scripts/test-jeju.ts
 *
 * (NODE_PATH points at the server-only stub so the module loads outside Next.js.
 *  --env-file is supported natively on Node 20.6+/24.)
 */

import { fetchJejuSource, listJejuSources } from '@/lib/jeju/connectors'

const PREVIEW_LENGTH = 500

async function main() {
  console.log('Registered Jeju sources:')
  for (const s of listJejuSources()) {
    console.log(`  - ${s.id} [${s.format}] (${s.modes.join(', ')}) — ${s.label}`)
  }

  console.log('\nGovernance-mode sources:')
  for (const s of listJejuSources('governance')) {
    console.log(`  - ${s.id}`)
  }

  const keyPresent = !!process.env.KPX_SERVICE_KEY
  console.log(`\nKPX_SERVICE_KEY present: ${keyPresent}`)

  console.log(`\n${'─'.repeat(60)}`)
  console.log('Fetching: kpx-jeju-power')
  console.log('─'.repeat(60))

  const result = await fetchJejuSource('kpx-jeju-power')
  console.log('ok:        ', result.ok)
  console.log('title:     ', result.title)
  console.log('sourceLabel:', result.sourceLabel)
  console.log('text.length:', result.text.length)
  console.log('truncated: ', result.truncated)
  if (!result.ok) {
    console.log('error:     ', result.error)
  } else {
    console.log(`\n--- first ${PREVIEW_LENGTH} chars ---`)
    console.log(result.text.slice(0, PREVIEW_LENGTH))
    console.log('--- end preview ---')
  }

  console.log(`\n${'─'.repeat(60)}`)
  console.log('Done.')
}

main().catch((err) => {
  console.error('Uncaught error (this should not happen):', err)
  process.exit(1)
})
