/**
 * Manual smoke-test for the Jeju governance briefing engine (LITE mode).
 *
 * Runs generateJejuLiteBriefing() TWICE:
 *   1. No question  → general "오늘의 제주 거버넌스 브리핑" (senior-official path)
 *   2. With a question → working-level forecast (양배추 가격 동향)
 *
 * Requires KPX_SERVICE_KEY / KAMIS_CERT_* and ANTHROPIC_API_KEY in .env.local.
 * Makes 2 Claude calls (minimal cost). Run from project root:
 *   $env:NODE_PATH=".\scripts\stubs"; npx tsx --env-file=.env.local scripts/test-brief.ts
 *
 * (NODE_PATH points at the server-only stub so the module loads outside Next.js.)
 */

import { generateJejuLiteBriefing, type JejuBriefingResult } from '@/lib/jeju/brief'

function printResult(title: string, res: JejuBriefingResult) {
  console.log(`\n${'═'.repeat(70)}`)
  console.log(title)
  console.log('═'.repeat(70))
  console.log('effective question:', res.question)
  console.log('provider:         ', res.provider)
  console.log('ok:               ', res.ok)

  console.log('\nsources (transparent collection):')
  for (const s of res.snapshot.sources) {
    const status = s.ok ? 'OK ' : 'ERR'
    const detail = s.ok ? `${s.text.length} chars` : (s.error ?? 'unknown error')
    console.log(`  [${status}] ${s.id.padEnd(20)} — ${detail}`)
  }

  console.log('\n--- briefing ---')
  console.log(res.ok ? res.briefing : `(no briefing) error: ${res.error}`)
  console.log('--- end briefing ---')
}

async function main() {
  console.log('Jeju LITE briefing — running two tiers through one pipeline...')

  const daily = await generateJejuLiteBriefing()
  printResult('TEST 1 — Daily briefing (no question / senior-official path)', daily)

  const forecast = await generateJejuLiteBriefing({
    question: '양배추 가격 동향과 향후 2주 전망을 분석해줘',
  })
  printResult('TEST 2 — Working-level forecast (specific question)', forecast)

  console.log(`\n${'═'.repeat(70)}`)
  console.log('Done.')
}

main().catch((err) => {
  console.error('Uncaught error (this should not happen):', err)
  process.exit(1)
})
