/**
 * Manual smoke-test for the Jeju 매스컴 (media watch) module (lib/jeju/mediawatch.ts).
 *
 * Runs runJejuMediaWatch({ mode: 'governance' }) — casts the wide net across the
 * Jeju policy umbrellas, then synthesizes a structured briefing. Times the run
 * and dumps the result. Makes real Perplexity + Anthropic calls.
 *
 * Run from project root:
 *   $env:NODE_PATH=".\scripts\stubs"; npx tsx --env-file=.env.local scripts/test-mediawatch.ts
 */

import { runJejuMediaWatch } from '@/lib/jeju/mediawatch'

function sep(char = '─') {
  return char.repeat(70)
}

async function main() {
  console.log(sep('═'))
  console.log('Jeju 매스컴 (media watch) — smoke test  [mode: governance]')
  console.log(sep('═'))

  const start = Date.now()
  let mw: Awaited<ReturnType<typeof runJejuMediaWatch>>

  try {
    mw = await runJejuMediaWatch({ mode: 'governance' })
  } catch (err: unknown) {
    const elapsed = ((Date.now() - start) / 1000).toFixed(1)
    console.error(`\nFATAL (uncaught) after ${elapsed}s:`, err)
    process.exit(1)
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1)

  console.log(`\n${sep('█')}`)
  console.log('RESULT')
  console.log(`overall ok: ${mw.ok}  |  mode: ${mw.mode}  |  date: ${mw.date}  |  ⏱  ${elapsed}초`)
  console.log(sep('█'))
  if (mw.error) console.log(`\n⚠️  error: ${mw.error}`)

  // ── Searches: how many ran + each umbrella/query/ok + source count ─────────
  const okCount = mw.searches.filter((s) => s.ok).length
  console.log(`\n[검색] ${mw.searches.length}개 실행 (성공 ${okCount} / 실패 ${mw.searches.length - okCount})`)
  for (const s of mw.searches) {
    const flag = s.ok ? '✓' : '✗'
    console.log(`\n  [${flag}] ${s.label}  (sources: ${s.sources.length})`)
    console.log(`       query: ${s.query}`)
    if (!s.ok) {
      console.log(`       error: ${s.error ?? '(미상)'}`)
    } else if (s.sources.length > 0) {
      for (const url of s.sources.slice(0, 5)) console.log(`       • ${url}`)
    }
  }

  // ── Synthesis sections ─────────────────────────────────────────────────────
  console.log(`\n\n${sep('═')}`)
  console.log('요약 (summary)')
  console.log(sep('═'))
  console.log(mw.summary ?? '(없음)')

  console.log(`\n${sep('═')}`)
  console.log('핵심 이슈 (coreIssues)')
  console.log(sep('═'))
  console.log(mw.coreIssues ?? '(없음)')

  console.log(`\n${sep('═')}`)
  console.log('주변 이슈 (minorIssues)')
  console.log(sep('═'))
  console.log(mw.minorIssues ?? '(없음)')

  console.log(`\n${sep('═')}`)
  console.log('전국 vs 제주 지역 언론 논조 대비 (nationalVsLocal)')
  console.log(sep('═'))
  console.log(mw.nationalVsLocal ?? '(없음)')

  console.log(`\n${sep('═')}`)
  console.log(`Done. (${elapsed}초)`)
}

main().catch((err) => {
  console.error('Uncaught error:', err)
  process.exit(1)
})
