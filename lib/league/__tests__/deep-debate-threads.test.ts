import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { DeepReportView } from '../../../components/league/DeepReportView'
import { pairDebaters } from '../deep-debate-pairs'
import { assignDebateSides, reportCostBucket } from '../deep-report-policy'
import { ledgerEntry, stageCostsFromLedger } from '../deep-report-ledger'
import { deepReportCopy } from '../i18n/deep-report-copy'
import { LEAGUE_LOCALES } from '../i18n/locales'
import { buildDeepSnapshot, type DeepReportSnapshot } from '../deep-snapshot'
import { validateChair, validateCounterReply, validateTargetedRebuttal } from '../deep-report-structured'

const OPENING = {
  headline: '출시가 임박했다',
  points: [{ text: '공급 일정이 4분기에 잡혀 있다' }, { text: '수요가 이미 대기 중이다' }],
}

function seats(roundId: string, finalSide?: (index: number, assigned: 'yes' | 'no') => 'yes' | 'no') {
  return assignDebateSides(roundId).map((seat, index) => ({
    provider: seat.provider,
    model: seat.model,
    assignedSide: seat.side,
    finalSide: finalSide ? finalSide(index, seat.side) : seat.side,
  }))
}

describe('debate pairing', () => {
  it('makes three cross-side pairs and rotates the opponent with the round id', () => {
    const partners = new Set<string>()
    for (const roundId of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'round-1', 'round-2', 'nvidia']) {
      const rows = seats(roundId)
      const pairs = pairDebaters(roundId, rows)
      expect(pairs, roundId).toHaveLength(3)
      for (const pair of pairs) {
        expect(pair.yes.assignedSide).toBe('yes')
        expect(pair.no.assignedSide).toBe('no')
      }
      const firstYes = rows.find((row) => row.assignedSide === 'yes')!
      partners.add(pairs.find((pair) => pair.yes.provider === firstYes.provider)!.no.provider)
    }
    expect(partners.size).toBeGreaterThan(1)
  })

  it('pairs by assigned side when final sides are lopsided', () => {
    const rows = seats('round-lop', (_index, assigned) => (assigned === 'yes' ? 'yes' : 'yes'))
    rows[5]!.finalSide = 'no'
    const pairs = pairDebaters('round-lop', rows)
    expect(pairs).toHaveLength(3)
    for (const pair of pairs) {
      expect(pair.yes.assignedSide).not.toBe(pair.no.assignedSide)
    }
  })
})

describe('targeted rebuttal and counter-reply', () => {
  const ctx = { opening: OPENING, acceptedTargets: ['claude-sonnet-5', 'Claude'] }

  it('accepts a quote copied from the opponent opening and rejects an invented one', () => {
    const good = validateTargetedRebuttal(
      JSON.stringify({
        target_model: 'Claude',
        quoted_claim: '공급 일정이 4분기에 잡혀 있다',
        rebuttal: '공지 없는 일정은 출하 근거가 아니다',
        evidence_refs: ['E2'],
      }),
      'stop',
      ctx,
    )
    expect(good.ok && good.value.quotedClaim).toBe('공급 일정이 4분기에 잡혀 있다')
    expect(good.ok && good.value.evidenceRefs).toEqual(['E2'])

    const invented = validateTargetedRebuttal(
      JSON.stringify({
        target_model: 'Claude',
        quoted_claim: '전혀 다른 주장을 여기에 적는다',
        rebuttal: '공지 없는 일정은 출하 근거가 아니다',
        evidence_refs: ['E2'],
      }),
      'stop',
      ctx,
    )
    expect(invented.ok).toBe(false)
    if (!invented.ok) expect(invented.reason).toBe('quoted claim is not in the opponent opening')
  })

  it('parses concede, partial and defend, and requires evidence when the reply holds', () => {
    const concede = validateCounterReply(
      JSON.stringify({
        replies_to_model: 'ChatGPT',
        stance: 'concede',
        reply: '인정합니다. 공식 공지가 없습니다.',
        final_side: 'no',
        final_probability: 64,
        changed_mind: true,
        why_changed: '공지 부재',
      }),
      'stop',
      { acceptedTargets: ['gpt-5.6-terra', 'ChatGPT'] },
    )
    expect(concede.ok && concede.value.stance).toBe('concede')
    expect(concede.ok && concede.value.finalSide).toBe('no')

    const partial = validateCounterReply(
      JSON.stringify({
        replies_to_model: 'ChatGPT',
        stance: 'partial',
        reply: '일정은 맞지만 출하로 보긴 이릅니다.',
        evidence_refs: ['E1'],
        final_side: 'yes',
        final_probability: 61,
        changed_mind: false,
        why_changed: null,
      }),
      'stop',
      { acceptedTargets: ['ChatGPT'] },
    )
    expect(partial.ok && partial.value.stance).toBe('partial')

    const bare = validateCounterReply(
      JSON.stringify({
        replies_to_model: 'ChatGPT',
        stance: 'defend',
        reply: '기존 주장을 유지합니다.',
        final_side: 'yes',
        final_probability: 70,
        changed_mind: false,
        why_changed: null,
      }),
      'stop',
      { acceptedTargets: ['ChatGPT'] },
    )
    expect(bare.ok).toBe(false)
    if (!bare.ok) expect(bare.reason).toBe('defense has no evidence ref')
  })
})

describe('chair exchange and counter cost', () => {
  const chair = {
    verdict_side: 'no',
    verdict_probability: 80,
    one_line: '공식 일정이 없어 출시 안 함 쪽이 우세하다.',
    vs_40ai: { relation: 'stronger', why: '공지 부재를 더 무겁게 봤다' },
    key_evidence: [
      { claim: '일정 공지 없음', source: 'NVIDIA', date: '2026-10-01', tier: 'official', ref: 'E1' },
      { claim: '공급 보도', source: 'Reuters', date: '2026-10-02', tier: 'major_outlet', ref: 'E2' },
      { claim: '수요 대기', source: 'Bloomberg', date: '2026-10-03', tier: 'major_outlet', ref: 'E3' },
    ],
    minority_view: '공급 일정만으로도 출시 가능성이 있다',
    flip_triggers: [{ event: '공식 출시 공지', by_date: '2026-11-30' }],
    scenarios: [{ name: '연내 출시', weight: 30 }],
  }

  it('requires the chair to name both sides of one exchange', () => {
    const exchanges = [{ left: 'Claude', right: 'ChatGPT' }]
    const cited = validateChair(
      JSON.stringify({
        ...chair,
        debate_judgment: ['Claude가 ChatGPT의 일정 주장을 인용했고 Claude는 인정했다.', '공급 보도는 보조 근거다.'],
      }),
      'stop',
      { exchanges },
    )
    expect(cited.ok).toBe(true)
    const missed = validateChair(
      JSON.stringify({
        ...chair,
        debate_judgment: ['일정 공지가 없다.', '공급 보도는 보조 근거다.'],
      }),
      'stop',
      { exchanges },
    )
    expect(missed.ok).toBe(false)
    if (!missed.ok) expect(missed.reason).toBe('debate judgment cites no exchange')
  })

  it('logs the counter round inside the debate cost bucket', () => {
    expect(reportCostBucket('counter')).toBe('debate')
    const costs = stageCostsFromLedger([
      ledgerEntry({ stage: 'counter', provider: 'openai', model: 'gpt-5.6-terra', ok: true, attempt: 1, ms: 1000, promptTokens: 1000, completionTokens: 200 }),
    ])
    expect(costs.debate.calls).toBe(1)
    expect(costs.chair.calls).toBe(0)
  })
})

function threadState() {
  const turn = (over: Record<string, unknown>) => ({
    ok: true,
    attempts: 1,
    headline: null,
    points: [],
    rebuttal: [],
    finalSide: null,
    finalProbability: null,
    whyChanged: null,
    ...over,
  })
  return {
    roundId: 'nvidia-thread',
    category: 'tech',
    proposition: 'NVIDIA가 이 칩을 연내 출하할까?',
    outputLanguage: 'ko',
    sideWords: { yes: '예', no: '아니오' },
    research: { path: 'deep', findings: [], seats: [], deep: null, sourcesFound: 0 },
    openings: [
      turn({
        provider: 'anthropic',
        model: 'claude-sonnet-5',
        side: 'yes',
        headline: '출시가 임박했다',
        points: [{ text: '공급 일정이 4분기에 잡혀 있다', ref: 'E1' }],
        finalSide: 'yes',
        finalProbability: 70,
      }),
      turn({
        provider: 'openai',
        model: 'gpt-5.6-terra',
        side: 'no',
        headline: '일정이 없다',
        points: [{ text: '공식 출시일이 공지되지 않았다', ref: 'E2' }],
        finalSide: 'no',
        finalProbability: 80,
      }),
    ],
    rebuttals: [
      turn({
        provider: 'openai',
        model: 'gpt-5.6-terra',
        side: 'no',
        rebuttalText: '공지는 아직 출하가 아니다',
        rebuttal: [{ text: '공지는 아직 출하가 아니다', ref: 'E2' }],
        quotedClaim: '공급 일정이 4분기에 잡혀 있다',
        targetModel: 'claude-sonnet-5',
        evidenceRefs: ['E2'],
      }),
      turn({
        provider: 'anthropic',
        model: 'claude-sonnet-5',
        side: 'yes',
        rebuttalText: '일정 공백이 취소를 뜻하지는 않는다',
        rebuttal: [{ text: '일정 공백이 취소를 뜻하지는 않는다', ref: 'E1' }],
        quotedClaim: '공식 출시일이 공지되지 않았다',
        targetModel: 'gpt-5.6-terra',
        evidenceRefs: ['E1'],
      }),
    ],
    counters: [
      turn({
        provider: 'anthropic',
        model: 'claude-sonnet-5',
        side: 'yes',
        finalSide: 'no',
        finalProbability: 62,
        whyChanged: '공지 부재',
        repliesToModel: 'gpt-5.6-terra',
        stance: 'concede',
        reply: '인정합니다. 공식 공지가 없습니다.',
      }),
      turn({
        provider: 'openai',
        model: 'gpt-5.6-terra',
        side: 'no',
        finalSide: 'no',
        finalProbability: 78,
        repliesToModel: 'claude-sonnet-5',
        stance: 'defend',
        reply: '공지 없는 일정은 출하 근거가 아닙니다.',
        evidenceRefs: ['E2'],
      }),
    ],
  }
}

describe('debate thread UI', () => {
  const snap = buildDeepSnapshot('report', threadState()) as DeepReportSnapshot

  it('renders one thread, the conceded point, and the stance badges in every locale', () => {
    expect(snap.threads).toHaveLength(1)
    expect(snap.threads[0]!.exchanges).toHaveLength(2)
    expect(snap.concessions.map((row) => row.brand)).toContain('Claude')
    for (const locale of LEAGUE_LOCALES) {
      const copy = deepReportCopy(locale)
      const html = renderToStaticMarkup(createElement(DeepReportView, { snap, locale })).replace(/&#x27;|&#39;/g, "'")
      expect(html, locale).toContain('data-testid="deep-report-thread"')
      expect(html, locale).toContain('data-testid="deep-report-conceded"')
      expect(html, locale).toContain(copy.debateHeading)
      expect(html, locale).toContain(copy.concededHeading)
      expect(html, locale).toContain(copy.stanceBadge.concede)
      expect(html, locale).toContain(copy.stanceBadge.defend)
      expect(html, locale).toContain(copy.rebuttalAbout('Claude', '공급 일정이 4분기에 잡혀 있다'))
      expect(html, locale).toContain('<details')
      expect(html, locale).toContain('출시가 임박했다')
    }
  })
})
