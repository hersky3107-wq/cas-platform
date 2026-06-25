/**
 * End-to-end verification for the Jeju DEEP pipeline (lib/jeju/deep.ts).
 *
 * Tests a multi-pillar diversification question (관광·반도체·감귤 + 재생에너지·EV·1차산업)
 * to verify orchestration, search, deliberation, vote, and chair verdict end-to-end.
 *
 * Run from project root:
 *   $env:NODE_PATH=".\scripts\stubs"; npx tsx --env-file=.env.local scripts/test-deep.ts
 */

import { runJejuDeepCompleteWithVote } from '@/lib/jeju/deep'

const QUESTION =
  '제주가 관광·반도체·감귤 중심 경제 구조에서 벗어나 지속가능한 산업 다각화를 이루려면, 재생에너지 전환·전기차 인프라·1차산업 경쟁력을 어떻게 함께 끌고 가야 하는가?'

const CHOICE_LABEL: Record<string, string> = {
  approve: '찬성 ✅',
  oppose: '반대 ❌',
  abstain: '기권 ⚪',
}

function sep(char = '─') {
  return char.repeat(70)
}

async function main() {
  console.log(sep('═'))
  console.log('Jeju DEEP — end-to-end verification')
  console.log(`Q: ${QUESTION}`)
  console.log(sep('═'))

  const start = Date.now()
  let full: Awaited<ReturnType<typeof runJejuDeepCompleteWithVote>>

  try {
    full = await runJejuDeepCompleteWithVote({ question: QUESTION })
  } catch (err: unknown) {
    const elapsed = ((Date.now() - start) / 1000).toFixed(1)
    console.error(`\nFATAL (uncaught) after ${elapsed}s:`, err)
    process.exit(1)
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1)

  if (full.error) {
    console.log(`\n⚠️  pipeline error: ${full.error}`)
  }

  // ── VERIFICATION DUMP ─────────────────────────────────────────────────────
  console.log(`\n${sep('█')}`)
  console.log('VERIFICATION DUMP')
  console.log(`overall ok: ${full.ok}  |  ⏱  ${elapsed}초`)
  console.log(sep('█'))

  // 1. plan.questionType
  console.log(`\n[1] plan.questionType: ${full.plan.questionType}`)
  if (full.plan.questionType === 'binary') {
    console.log('    ✓ binary — 2x2 vote branch eligible')
  } else {
    console.log('    ⚠️  NOT binary — 2x2 vote branch will not fire')
  }

  // 2. Convened roles
  console.log(`\n[2] CONVENED ROLES (${full.plan.roles.length}개):`)
  let pressAnalystFound = false
  for (const r of full.plan.roles) {
    const flags = r.isRedTeam ? '  [레드팀]' : ''
    console.log(`    • ${r.roleLabel}  →  ${r.provider}${flags}`)
    if (r.roleLabel.includes('언론')) pressAnalystFound = true
  }
  if (pressAnalystFound) {
    console.log('    ✓ 언론 분석가 소집됨')
  } else {
    console.log('    ℹ️  언론 분석가 미소집')
  }

  // 3. Searches
  console.log(`\n[3] SEARCHES EXECUTED (${full.searches.length}개):`)
  for (const s of full.searches) {
    const ok = s.ok ? '✓' : '✗'
    const by = s.requestedBy.join(', ') || '?'
    console.log(`    [${ok}] "${s.query}"`)
    console.log(`         requestedBy: ${by}`)
  }
  if (full.searches.length === 0) {
    console.log('    (검색 없음)')
  }

  // 4. Deliberation headline
  const delib = full.deliberation
  console.log('\n[4] DELIBERATION:')
  console.log(`    finalScore:    ${delib.finalScore === -1 ? '측정 불가 (-1)' : delib.finalScore + ' / 100'}`)
  console.log(`    roundsRun:     ${delib.roundsRun}`)
  console.log(`    stoppedReason: ${delib.stoppedReason}`)

  // 5. Vote
  const vote = full.vote
  console.log('\n[5] VOTE:')
  console.log(`    summary: ${vote.summary}`)
  if (vote.ok && vote.votes.some((bv) => bv.choice != null)) {
    for (const bv of vote.votes) {
      if (!bv.ok || bv.choice == null) continue
      const choiceLabel = CHOICE_LABEL[bv.choice] ?? bv.choice
      const reason = bv.reason ? `  — ${bv.reason.trim().slice(0, 100)}` : ''
      console.log(`    • ${bv.provider}  →  ${choiceLabel}${reason}`)
    }
    console.log(
      `    tally: 찬성 ${vote.approveCount} / 반대 ${vote.opposeCount} / 기권 ${vote.abstainCount}  |  outcome: ${vote.outcome}`
    )
  } else {
    console.log('    (표결 없음 — 위 summary 참조)')
  }

  // 6. verdict.mediaRisk
  const v = full.verdict
  console.log('\n[6] verdict.mediaRisk (언론 리스크):')
  if (v.mediaRisk && v.mediaRisk.trim() !== '') {
    console.log(v.mediaRisk)
    console.log('    ✓ 언론 리스크 절 생성됨')
  } else {
    console.log('    null — 언론 분석가 미소집 또는 의장이 절 생략')
  }

  // 7. verdict.minorityReport
  console.log('\n[7] verdict.minorityReport:')
  if (v.minorityReport && v.minorityReport.trim() !== '') {
    console.log(v.minorityReport)
  } else {
    console.log('    null (소수의견 없음)')
  }

  // 8. verdict.judgment
  console.log('\n[8] verdict.judgment:')
  if (v.judgment && v.judgment.trim() !== '') {
    console.log(v.judgment)
    const punt = /(전문가들이 갈렸|판단하기 어렵|결정할 수 없|알 수 없)/
    if (punt.test(v.judgment)) {
      console.log('\n    ⚠️  PUNT RISK: 판결이 결단을 회피한 듯 보임')
    } else {
      console.log('\n    ✓ 결단력 있는 판결로 보임')
    }
  } else {
    console.log('    null (판결 없음)')
  }

  console.log(`\n${sep('═')}`)
  console.log(`Done. (${elapsed}초)`)
}

main().catch((err) => {
  console.error('Uncaught error:', err)
  process.exit(1)
})
