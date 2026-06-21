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
  runJejuDeepComplete,
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

  // ── BEATS 1–4 COMPLETE: full pipeline (… → DELIBERATE → CHAIR VERDICT) ────
  console.log(`\n\n${'█'.repeat(70)}`)
  console.log('FULL DEEP RUN (orchestrate → analyze → search → revise → debate → deliberate → VERDICT)')
  console.log(`Q: ${deepQuestion}`)
  console.log('█'.repeat(70))

  const full = await runJejuDeepComplete({ question: deepQuestion })
  console.log('\noverall ok:        ', full.ok)
  console.log('analyses:          ', full.analyses.length, '(ok:', full.analyses.filter((a) => a.ok).length, ')')

  const rawRequestCount = full.analyses
    .filter((a) => a.ok)
    .reduce((sum, a) => sum + a.searchRequests.length, 0)
  console.log('raw search requests (pre-merge):', rawRequestCount)
  console.log('merged searches executed:       ', full.searches.length, `(cap: 5)`)
  console.log('dropped beyond cap:             ', full.droppedSearchCount)
  if (full.error) console.log('error:             ', full.error)

  if (full.searches.length > 5) {
    console.log('\n⚠️  CAP VIOLATION: more than 5 Perplexity calls were executed!')
  } else {
    console.log(`\n✓ cap respected: ${full.searches.length} ≤ 5 Perplexity calls`)
  }

  console.log(`\n${'═'.repeat(70)}`)
  console.log('SHARED RESEARCH MATERIAL (search results placed on the table)')
  console.log('═'.repeat(70))
  for (const s of full.searches) {
    console.log(`\n🔍 "${s.query}"   (ok: ${s.ok})`)
    console.log(`   requestedBy: ${s.requestedBy.join(', ') || '(미상)'}`)
    console.log(s.ok ? s.result : `   error: ${s.error}`)
  }

  // ── Revision comparison: who changed their mind after the research? ───────
  const changedCount = full.revised.filter((r) => r.changed).length
  console.log(`\n\n${'═'.repeat(70)}`)
  console.log(`REVISED ANALYSES (after search) — ${changedCount}/${full.revised.length} experts changed view`)
  console.log('═'.repeat(70))

  for (const r of full.revised) {
    console.log(`\n${'─'.repeat(70)}`)
    console.log(`${r.roleLabel}  →  ${r.provider}${r.isRedTeam ? '  [RED TEAM]' : ''}`)
    console.log(`ok: ${r.ok} | changed: ${r.changed ? '✓ YES' : '— no'}`)
    console.log('─'.repeat(70))
    if (!r.ok) {
      console.log('error:', r.error)
      continue
    }
    console.log('[1차]   ', r.firstPass ?? '(없음)')
    console.log('\n[갱신]  ', r.revised ?? '(없음)')
  }

  // ── PIECE 3: the debate round — do they actually clash or just agree? ─────
  const okRebuttals = full.debate.filter((d) => d.ok)
  const engaged = okRebuttals.filter((d) => d.targetRoleLabels.length > 0).length
  console.log(`\n\n${'═'.repeat(70)}`)
  console.log(`DEBATE ROUND (rebuttals) — ${engaged}/${okRebuttals.length} experts named a target to push back on`)
  console.log('═'.repeat(70))

  // Heuristic sycophancy sniff: rebuttal text that reads like pure agreement.
  const agreeRe = /(동의합니다|좋은 지적|이견이 없|모두 동의|전적으로 공감)/

  for (const d of full.debate) {
    console.log(`\n${'─'.repeat(70)}`)
    console.log(`${d.roleLabel}  →  ${d.provider}${d.isRedTeam ? '  [RED TEAM]' : ''}`)
    console.log(`ok: ${d.ok}`)
    if (!d.ok) {
      console.log('error:', d.error)
      continue
    }
    console.log(`반박 대상: ${d.targetRoleLabels.join(', ') || '(없음 — 대상 미지정)'}`)
    const looksLikeChorus =
      d.targetRoleLabels.length === 0 || (d.rebuttal != null && agreeRe.test(d.rebuttal))
    if (looksLikeChorus) console.log('⚠️  CHORUS RISK: 반박이 아니라 동의처럼 보임 — 확인 필요')
    console.log('─'.repeat(70))
    console.log(d.rebuttal ?? '(없음)')
  }

  // ── PIECE 3.6: looped deliberation — does consensus CLIMB across rounds? ───
  const delib = full.deliberation
  console.log(`\n\n${'═'.repeat(70)}`)
  console.log('DELIBERATION (looped convergence rounds)')
  console.log('═'.repeat(70))

  // The headline: per-round score progression (should climb, e.g. 45 → 62 → 78).
  console.log('\n[라운드별 합의 점수 진행]')
  let prev: number | null = null
  for (const r of delib.rounds) {
    const score = r.consensusScore === -1 ? '측정불가' : `${r.consensusScore}`
    const delta = prev != null && r.consensusScore !== -1 ? ` (Δ${r.consensusScore - prev >= 0 ? '+' : ''}${r.consensusScore - prev})` : ''
    const oneLine = (r.summary || '(요약 없음)').replace(/\s+/g, ' ').slice(0, 90)
    console.log(`  R${r.roundNumber}: ${score}/100${delta}  — ${oneLine}`)
    if (r.consensusScore !== -1) prev = r.consensusScore
  }

  console.log(`\nroundsRun:     ${delib.roundsRun}`)
  console.log(`stoppedReason: ${delib.stoppedReason}`)
  console.log(`finalScore:    ${delib.finalScore === -1 ? '측정 불가 (-1)' : delib.finalScore + ' / 100'}`)
  if (delib.error) console.log(`error:         ${delib.error}`)

  console.log(`\n${'═'.repeat(70)}`)
  console.log('최종 합의된 지점 (agreedPoints):')
  for (const p of delib.agreedPoints) console.log(`  • ${p}`)
  console.log('\n최종 잔존 쟁점 (contestedPoints → 소수의견 후보):')
  for (const p of delib.contestedPoints) console.log(`  • ${p}`)
  console.log('\n[최종 라운드 요약]')
  console.log(delib.summary || '(없음)')

  // ── BEAT 4: the chair's one-page verdict — the deliverable an official reads ─
  const v = full.verdict
  console.log(`\n\n${'█'.repeat(70)}`)
  console.log('의장(CHAIR) 최종 판결 — 1페이지 결재 문서')
  console.log(`provider: ${v.provider} | consensus: ${v.consensusScore === -1 ? '측정 불가' : v.consensusScore + '/100'} | ok: ${v.ok}`)
  console.log('█'.repeat(70))
  if (!v.ok) {
    console.log('error:', v.error)
  } else {
    console.log('\n## 최종 판단')
    console.log(v.judgment ?? '(없음)')
    console.log('\n## 수집 데이터 요약 (beat 1)')
    console.log(v.beat1Summary ?? '(없음)')
    console.log('\n## 전문가 분석·조사 요약 (beat 2)')
    console.log(v.beat2Summary ?? '(없음)')
    console.log('\n## 토론·합의 과정 (beat 3)')
    console.log(v.beat3Summary ?? '(없음)')
    console.log('\n## 마이너리티 리포트')
    console.log(v.minorityReport ?? '(없음)')
    console.log('\n## 참고 사항')
    console.log(v.disclaimer)

    // Quick judgment-quality sniff: decisive ruling, not a wishy-washy punt.
    const punt = /(전문가들이 갈렸|판단하기 어렵|결정할 수 없|알 수 없)/
    if (v.judgment && punt.test(v.judgment)) {
      console.log('\n⚠️  PUNT RISK: 판결이 결단을 회피한 듯 보임 — 확인 필요')
    } else if (v.judgment) {
      console.log('\n✓ 결단력 있는 판결로 보임 (회피 표현 미검출)')
    }
  }

  console.log(`\n${'═'.repeat(70)}`)
  console.log('Done.')
}

main().catch((err) => {
  console.error('Uncaught error (this should not happen):', err)
  process.exit(1)
})
