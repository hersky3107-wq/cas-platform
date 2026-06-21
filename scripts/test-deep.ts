/**
 * Manual smoke-test for the Jeju DEEP orchestrator (lib/jeju/deep.ts, piece 1).
 *
 * Proves the convened lineup CHANGES per question — the core of the AX vision.
 * Calls summarizeAvailableData() once, then planJejuMeeting() for three very
 * different questions and prints each lineup + rationale.
 *
 * Requires the data-source keys + ANTHROPIC_API_KEY in .env.local. Makes 3
 * orchestrator (Claude) calls — cheap. Run from project root:
 *   $env:NODE_PATH=".\scripts\stubs"; npx tsx --env-file=.env.local scripts/test-deep.ts
 */

import {
  planJejuMeeting,
  summarizeAvailableData,
  runJejuDeepThroughAnalysis,
  runJejuDeepThroughSearch,
  type JejuMeetingPlan,
} from '@/lib/jeju/deep'

const QUESTIONS = [
  '제주 잉여 재생에너지를 전기차 충전 인프라로 흡수하는 방안의 타당성은?',
  '여름 성수기 관광객 급증에 대비한 교통·환경 대책은?',
  '월동무 과잉생산으로 인한 가격 폭락 위험과 대응 방안은?',
]

function printPlan(plan: JejuMeetingPlan) {
  console.log('ok:          ', plan.ok)
  console.log('searchNeeded:', plan.searchNeeded)
  if (!plan.ok) {
    console.log('error:       ', plan.error)
    return
  }
  console.log(`convened ${plan.roles.length} roles:`)
  for (const role of plan.roles) {
    const flag = role.isRedTeam ? '  [RED TEAM]' : ''
    console.log(`  • ${role.roleLabel}  →  ${role.provider}${flag}`)
    console.log(`      ${role.mandate}`)
  }
  console.log(`\nrationale: ${plan.rationale}`)
}

async function main() {
  console.log('Jeju DEEP — meeting orchestrator smoke test\n')

  console.log(`${'─'.repeat(70)}`)
  console.log('Available data (orchestrator context):')
  console.log('─'.repeat(70))
  const dataSummary = await summarizeAvailableData()
  console.log(dataSummary)

  for (let i = 0; i < QUESTIONS.length; i++) {
    const q = QUESTIONS[i]!
    console.log(`\n${'═'.repeat(70)}`)
    console.log(`QUESTION ${i + 1}: ${q}`)
    console.log('═'.repeat(70))
    const plan = await planJejuMeeting({ question: q, availableDataSummary: dataSummary })
    printPlan(plan)
  }

  // ── PIECE 2: full run through first-pass expert analyses ──────────────────
  const deepQuestion = '제주 잉여 재생에너지를 전기차 충전 인프라로 흡수하는 방안의 타당성은?'
  console.log(`\n\n${'█'.repeat(70)}`)
  console.log('FULL DEEP RUN (orchestrate → expert first-pass analyses)')
  console.log(`Q: ${deepQuestion}`)
  console.log('█'.repeat(70))

  const deep = await runJejuDeepThroughAnalysis({ question: deepQuestion })
  console.log('\noverall ok:  ', deep.ok)
  console.log('plan ok:     ', deep.plan.ok, '| roles:', deep.plan.roles.length, '| searchNeeded:', deep.plan.searchNeeded)
  console.log('context size:', deep.context.length, 'chars')
  if (deep.error) console.log('error:       ', deep.error)

  for (const a of deep.analyses) {
    console.log(`\n${'─'.repeat(70)}`)
    const flag = a.isRedTeam ? '  [RED TEAM]' : ''
    console.log(`${a.roleLabel}  →  ${a.provider}${flag}   (ok: ${a.ok})`)
    console.log('─'.repeat(70))
    if (!a.ok) {
      console.log('error:', a.error)
      continue
    }
    console.log('analysis:')
    console.log(a.analysis)
    if (a.searchRequests.length) {
      console.log('\nsearch requests:')
      for (const sr of a.searchRequests) {
        console.log(`  🔍 "${sr.query}"`)
        console.log(`      이유: ${sr.reason}`)
      }
    } else {
      console.log('\nsearch requests: (없음)')
    }
  }

  // ── PIECE 2.5: full run through Perplexity search execution ───────────────
  console.log(`\n\n${'█'.repeat(70)}`)
  console.log('FULL DEEP RUN + SEARCH (merge requests → execute via Perplexity)')
  console.log(`Q: ${deepQuestion}`)
  console.log('█'.repeat(70))

  const withSearch = await runJejuDeepThroughSearch({ question: deepQuestion })
  console.log('\noverall ok:        ', withSearch.ok)
  console.log('analyses:          ', withSearch.analyses.length, '(ok:', withSearch.analyses.filter((a) => a.ok).length, ')')

  const rawRequestCount = withSearch.analyses
    .filter((a) => a.ok)
    .reduce((sum, a) => sum + a.searchRequests.length, 0)
  console.log('raw search requests (pre-merge):', rawRequestCount)
  console.log('merged searches executed:       ', withSearch.searches.length, `(cap: 5)`)
  console.log('dropped beyond cap:             ', withSearch.droppedSearchCount)
  if (withSearch.error) console.log('error:             ', withSearch.error)

  if (withSearch.searches.length > 5) {
    console.log('\n⚠️  CAP VIOLATION: more than 5 Perplexity calls were executed!')
  } else {
    console.log(`\n✓ cap respected: ${withSearch.searches.length} ≤ 5 Perplexity calls`)
  }

  for (const s of withSearch.searches) {
    console.log(`\n${'─'.repeat(70)}`)
    console.log(`🔍 "${s.query}"   (ok: ${s.ok})`)
    console.log(`   requestedBy: ${s.requestedBy.join(', ') || '(미상)'}`)
    console.log('─'.repeat(70))
    if (!s.ok) {
      console.log('error:', s.error)
      continue
    }
    console.log(s.result)
  }

  console.log(`\n${'═'.repeat(70)}`)
  console.log('Done.')
}

main().catch((err) => {
  console.error('Uncaught error (this should not happen):', err)
  process.exit(1)
})
