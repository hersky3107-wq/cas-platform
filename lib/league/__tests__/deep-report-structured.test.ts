import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { DeepReportProgress, DeepReportView } from '../../../components/league/DeepReportView'
import {
  assignEvidenceRefs,
  dossierSections,
  groundFindingUrls,
  mergeFindings,
  nonFindingReason,
  parseResearchFindings,
  type ResearchFinding,
} from '../deep-report-findings'
import {
  estimateReportCallUsd,
  ledgerEntry,
  ledgerLogLine,
  reportHopAccounting,
  stageCostsFromLedger,
} from '../deep-report-ledger'
import {
  clipText,
  looksTruncated,
  normalizeFinalCall,
  plainText,
  readerText,
  relationTo40,
  stripRefGroups,
  tallyVotes,
  validateChair,
  validateOpening,
  validateRebuttal,
} from '../deep-report-structured'
import { buildDeepSnapshot, type DeepReportSnapshot } from '../deep-snapshot'
import { deepReportCopy } from '../i18n/deep-report-copy'
import { LEAGUE_LOCALES } from '../i18n/locales'
import { scrubVisibleDeepState } from '../visible-disclosure'

// The exact lines the first live Samsung tri-fold dossier showed as "findings".
const OBSERVED_GARBAGE = [
  '### 5. [en/official_filings] Official filings and regulatory records',
  '[en/base_rates] none found',
  '| 없음 | 기타 | 없음 | 일치: 1 | google',
  '*[ko/scheduled_events] 예정된 일정**',
  '(출처: )',
]

function finding(over: Partial<ResearchFinding> & Pick<ResearchFinding, 'claim'>): ResearchFinding {
  return {
    date: null,
    sourceTitle: 'Samsung Newsroom',
    sourceUrl: null,
    tier: 'other',
    side: 'context',
    queryKey: 'changed_30d',
    providers: ['google'],
    ...over,
  }
}

describe('deep report research findings', () => {
  it('rejects every garbage line from the first live dossier', () => {
    expect(OBSERVED_GARBAGE.map((line) => nonFindingReason(line))).toEqual([
      'heading',
      'none_found',
      'table_fragment',
      'heading',
      'empty_source',
    ])
    expect(nonFindingReason('삼성전자는 2026년 9월 언팩에서 3단 폴더블 출시 일정을 발표하지 않았다.')).toBeNull()
  })

  it('parses JSON findings and drops headings, tags, none-found, tables and sourceless claims', () => {
    const items = [
      ...OBSERVED_GARBAGE.map((claim) => ({ claim, date: null, source_title: 'x', source_url: null, tier: 'other', side: 'context', query_key: 'base_rates' })),
      // Substantive claim, but no source at all ("(출처: )" stub only).
      { claim: '삼성은 3단 폴더블 출시를 연내 확정했다 (출처: )', date: null, source_title: '', source_url: null, tier: 'other', side: 'yes', query_key: 'strongest_yes' },
      {
        claim: '[ko/official_filings] 국립전파연구원 인증 목록에 SM-F968 모델이 2026년 9월 18일 등록됐다.',
        date: '2026-09-18',
        source_title: '국립전파연구원',
        source_url: 'https://rra.go.kr/ko/license/A_b_popup.do?id=1',
        tier: 'regulator',
        side: 'yes',
        query_key: 'official_filings',
      },
    ]
    const parsed = parseResearchFindings(JSON.stringify({ findings: items }), 'google', 'tech')
    expect(parsed.parsed).toBe(true)
    expect(parsed.dropped).toBe(6)
    expect(parsed.findings).toHaveLength(1)
    const [row] = parsed.findings
    expect(row!.claim).toBe('국립전파연구원 인증 목록에 SM-F968 모델이 2026년 9월 18일 등록됐다.')
    expect(row!.tier).toBe('regulator')
    expect(row!.queryKey).toBe('official_filings')
    expect(row!.sourceUrl).toContain('rra.go.kr')
  })

  it('treats prose, markdown and truncated JSON as not parsed', () => {
    expect(parseResearchFindings('### 1. Findings\n- none found', 'xai', 'tech').parsed).toBe(false)
    expect(parseResearchFindings('{"findings":[{"claim":"삼성은', 'xai', 'tech').parsed).toBe(false)
  })

  it('merges the same fact across providers and counts agreement', () => {
    const merged = mergeFindings([
      [finding({ claim: '삼성전자는 9월 언팩에서 3단 폴더블 출시 일정을 발표하지 않았다', providers: ['perplexity'], tier: 'official' })],
      [finding({ claim: '삼성전자는 9월 언팩에서 3단 폴더블의 출시 일정을 발표하지 않았다.', providers: ['google'] })],
      [finding({ claim: '애플은 2026년 폴더블 아이폰을 내놓지 않는다', providers: ['xai'] })],
    ])
    expect(merged).toHaveLength(2)
    expect(merged[0]!.providers).toEqual(['perplexity', 'google'])
    expect(merged[0]!.tier).toBe('official')
    const refs = assignEvidenceRefs(merged)
    expect(refs.map((row) => row.ref)).toEqual(['E1', 'E2'])
    expect(dossierSections(refs).map((section) => section.key)).toEqual(['changed_30d'])
  })

  it('keeps only links Perplexity actually searched', () => {
    const rows = [
      finding({ claim: '삼성은 3단 폴더블 출시 일정을 공개하지 않았다', sourceTitle: 'Reuters', sourceUrl: 'https://www.reuters.com/made-up-link' }),
      finding({ claim: '국내 인증 목록에 신규 모델이 등록됐다', sourceTitle: 'Samsung Newsroom', sourceUrl: 'https://news.samsung.com/global/real' }),
      finding({ claim: '출처를 확인할 수 없는 주장이다 그래도 길게', sourceTitle: 'Unknown blog', sourceUrl: 'https://fabricated.example/x' }),
    ]
    const grounded = groundFindingUrls(rows, [
      { title: 'Samsung keeps tri-fold launch date under wraps - Reuters', url: 'https://www.reuters.com/tech/samsung-trifold-2026-10-01/', date: '2026-10-01T03:00:00Z' },
      { title: 'Samsung Newsroom', url: 'https://news.samsung.com/global/real', date: null },
    ])
    expect(grounded[0]!.sourceUrl).toBe('https://www.reuters.com/tech/samsung-trifold-2026-10-01/')
    expect(grounded[0]!.date).toBe('2026-10-01')
    expect(grounded[1]!.sourceUrl).toBe('https://news.samsung.com/global/real')
    expect(grounded[2]!.sourceUrl).toBeNull()
    expect(groundFindingUrls(rows, [])).toEqual(rows)
  })

  it('keeps source URLs and refs through the save-time display scrub', () => {
    const state = scrubVisibleDeepState({
      category: 'tech',
      research: { findings: [{ claim: '삼성은 일정을 공개하지 않았다', sourceUrl: 'https://news.samsung.com/a', ref: 'E1' }] },
    }) as { research: { findings: { sourceUrl: string; ref: string }[] } }
    expect(state.research.findings[0]!.sourceUrl).toBe('https://news.samsung.com/a')
    expect(state.research.findings[0]!.ref).toBe('E1')
  })
})

const OPENING = {
  headline: '**인증은 났지만** 출시 발표는 아직 없다 — 연내 출시 가능성은 낮다고 본다, 아주 길게 써서 잘리는지 확인',
  points: [
    { text: '국립전파연구원 인증은 출시 3~5개월 전에 나오는 경우가 많다 [E2]', ref: 'E2' },
    { text: '9월 언팩에서 3단 폴더블 일정은 언급되지 않았다', ref: 'E1' },
    { text: '부품 공급망 보도는 2027년 상반기를 가리킨다 (E3)' },
  ],
  final_side: 'yes',
  final_probability: 24,
}

describe('debater and chair JSON contracts', () => {
  it('validates an opening, clips text, reads refs, and flips a sub-50 call', () => {
    const checked = validateOpening(JSON.stringify(OPENING), 'stop')
    expect(checked.ok).toBe(true)
    if (!checked.ok) return
    expect(checked.value.headline.length).toBeLessThanOrEqual(60)
    expect(checked.value.headline).not.toContain('**')
    expect(checked.value.points).toHaveLength(3)
    expect(checked.value.points.map((p) => p.ref)).toEqual(['E2', 'E1', 'E3'])
    expect(checked.value.points[0]!.text).not.toContain('E2')
    expect(checked.value.finalSide).toBe('no')
    expect(checked.value.finalProbability).toBe(76)
  })

  it('reports truncation from the finish reason or an unclosed object', () => {
    const cut = JSON.stringify(OPENING).slice(0, 120)
    expect(looksTruncated(cut)).toBe(true)
    expect(validateOpening(cut)).toEqual({ ok: false, reason: 'truncated' })
    expect(validateOpening(JSON.stringify(OPENING), 'length')).toEqual({ ok: false, reason: 'truncated' })
    expect(validateChair('{"verdict_side":"no","one_line":"삼성은', 'max_tokens')).toEqual({ ok: false, reason: 'truncated' })
    expect(validateOpening('Here is my argument: …')).toEqual({ ok: false, reason: 'not_json' })
  })

  it('requires rebuttal items and a final call', () => {
    expect(validateRebuttal(JSON.stringify({ headline: 'x', rebuttal: [], final_side: 'no', final_probability: 70 }))).toEqual({
      ok: false,
      reason: 'missing rebuttal',
    })
    const ok = validateRebuttal(
      JSON.stringify({
        headline: '인증만으로는 부족하다',
        rebuttal: [{ text: '인증이 곧 출시라는 주장은 과거 사례와 맞지 않는다', ref: 'E2' }],
        points: [{ text: '공급망 보도가 가장 강한 근거다', ref: 'E3' }],
        final_side: 'no',
        final_probability: '0.7',
        changed_mind: true,
        why_changed: '공급망 보도가 인증 일정보다 무겁다',
      }),
    )
    expect(ok.ok && ok.value.finalProbability).toBe(70)
    expect(ok.ok && ok.value.whyChanged).toBe('공급망 보도가 인증 일정보다 무겁다')
  })

  it('validates the chair report and rejects thin ones', () => {
    const chair = {
      verdict_side: 'no',
      verdict_probability: 82,
      one_line: '인증은 났지만 연내 출시 발표·예약 신호가 없어 출시 안 함 쪽이 우세하다.',
      vs_40ai: { ai40_side: 'no', ai40_confidence: 71, relation: 'stronger', why: '공급망 보도를 더 무겁게 봤다' },
      key_evidence: [
        { claim: '9월 언팩에서 일정 언급 없음', source: 'Samsung Newsroom', date: '2026-09-24', tier: 'official', ref: 'E1' },
        { claim: '전파인증 등록', source: '국립전파연구원', date: '2026-09-18', tier: 'regulator', ref: 'E2' },
        { claim: '2027년 상반기 보도', source: 'Reuters', date: '2026-10-01', tier: 'major outlet', ref: 'E3' },
      ],
      debate_judgment: ['ChatGPT는 인증의 의미를 과장했다', 'Grok은 공급망 근거를 잘 썼다', 'Gemini는 날짜를 확인하지 않았다'],
      minority_view: '인증 후 2개월 내 출시한 전례도 있다',
      flip_triggers: [{ event: '삼성 공식 예약 판매 공지', by_date: '2026-11-30' }],
      scenarios: [{ name: '2027년 출시', weight: 70 }],
    }
    const checked = validateChair(JSON.stringify(chair))
    expect(checked.ok).toBe(true)
    if (checked.ok) {
      expect(checked.value.keyEvidence[2]!.tier).toBe('major_outlet')
      expect(checked.value.flipTriggers[0]).toEqual({ event: '삼성 공식 예약 판매 공지', byDate: '2026-11-30' })
      expect(checked.value.vs40RelationClaimed).toBe('stronger')
    }
    expect(validateChair(JSON.stringify({ ...chair, key_evidence: chair.key_evidence.slice(0, 2) }))).toEqual({
      ok: false,
      reason: 'fewer than 3 key evidence rows',
    })
    expect(validateChair(JSON.stringify({ ...chair, flip_triggers: [] }))).toEqual({ ok: false, reason: 'missing flip triggers' })
  })

  it('takes evidence refs and YES/NO out of reader text', () => {
    expect(stripRefGroups('출시 경향이 매우 낮다 (E3, E4, E5).')).toBe('출시 경향이 매우 낮다.')
    expect(stripRefGroups('일정이 없다 [E1][E2]')).toBe('일정이 없다')
    expect(stripRefGroups('일정이 없다 E3, E4')).toBe('일정이 없다')
    const words = { yes: '출시함', no: '출시 안 함' }
    expect(
      readerText('Mistral은 E8과 2027년 일정을 묶었다 (E9). 근거는 NO 쪽이다', {
        refLabel: (ref) => (ref === 'E8' ? 'Bloomberg' : null),
        sideWords: words,
      }),
    ).toBe('Mistral은 Bloomberg과 2027년 일정을 묶었다. 근거는 출시 안 함 쪽이다')
    const opening = validateOpening(JSON.stringify({ ...OPENING, points: [{ text: '4분기 출시 경향이 낮다 (E3, E4, E5).' }, { text: '언팩 일정 없음 [E1]' }] }))
    expect(opening.ok && opening.value.points.map((p) => [p.text, p.ref])).toEqual([
      ['4분기 출시 경향이 낮다.', 'E3'],
      ['언팩 일정 없음', 'E1'],
    ])
  })

  it('strips markdown and clips at word boundaries', () => {
    expect(plainText('### **굵게** [링크](https://x.y) | 표 [1]')).toBe('굵게 링크 표')
    const clipped = clipText('삼성은 연내 출시를 발표하지 않았고 예약 판매 일정도 없다', 20)
    expect(clipped.endsWith('…')).toBe(true)
    expect(clipped.length).toBeLessThanOrEqual(20)
  })
})

describe('final vote', () => {
  it('counts assigned-YES at 24% as NO and as a changed mind', () => {
    expect(normalizeFinalCall('yes', 24)).toEqual({ side: 'no', probability: 76 })
    const tally = tallyVotes([
      { provider: 'anthropic', model: 'claude-sonnet-5', assignedSide: 'yes', finalSide: 'no', finalProbability: 70 },
      { provider: 'openai', model: 'gpt-5.6-terra', assignedSide: 'yes', finalSide: 'yes', finalProbability: 24 },
      { provider: 'google', model: 'gemini-3.6-flash', assignedSide: 'yes', finalSide: 'yes', finalProbability: 62 },
      { provider: 'xai', model: 'grok-4.3', assignedSide: 'no', finalSide: 'no', finalProbability: 85 },
      { provider: 'deepseek', model: 'deepseek-v4-pro', assignedSide: 'no', finalSide: 'no', finalProbability: 80 },
      { provider: 'mistral', model: 'mistral-medium-3.5', assignedSide: 'no', finalSide: 'no', finalProbability: 77 },
    ])
    const terra = tally.seats.find((row) => row.model === 'gpt-5.6-terra')!
    expect(terra.finalSide).toBe('no')
    expect(terra.finalProbability).toBe(76)
    expect(terra.changedMind).toBe(true)
    expect(tally).toMatchObject({ yes: 1, no: 5, counted: 6, total: 6, majority: 'no', majorityCount: 5 })
    expect(tally.changed.map((row) => row.provider)).toEqual(['anthropic', 'openai'])
    expect(deepReportCopy('ko').tally(tally.total, tally.majorityCount, '출시 안 함')).toBe('6명 중 5명 출시 안 함')
  })

  it('relates the verdict to the 40-AI result', () => {
    expect(relationTo40({ side: 'no', probability: 82 }, { side: 'no', confidence: 71 })).toBe('stronger')
    expect(relationTo40({ side: 'no', probability: 60 }, { side: 'no', confidence: 71 })).toBe('weaker')
    expect(relationTo40({ side: 'yes', probability: 60 }, { side: 'no', confidence: 71 })).toBe('opposite')
    expect(relationTo40({ side: 'yes', probability: 60 }, null)).toBeNull()
  })
})

describe('per-stage cost ledger', () => {
  it('prices the chair at Opus 5.5 list price instead of $0', () => {
    expect(estimateReportCallUsd('claude-opus-5-5', 10_000, 5_000)).toBeCloseTo(0.04 + 0.1, 6)
    const chair = ledgerEntry({ stage: 'chair', provider: 'anthropic', model: 'claude-opus-5-5', ok: true, attempt: 1, ms: 90_000, promptTokens: 10_000, completionTokens: 5_000 })
    expect(chair.billedUsd).toBeNull()
    expect(chair.estimatedUsd).toBeGreaterThan(0.1)
  })

  it('uses the provider bill when there is one and buckets each stage', () => {
    const entries = [
      ledgerEntry({ stage: 'research', provider: 'perplexity', model: 'agent:high', ok: true, attempt: 1, ms: 400_000, billedUsd: 0.91, promptTokens: 120_000, completionTokens: 9_000, requestId: 'req_1', responseId: 'resp_1' }),
      ledgerEntry({ stage: 'research', provider: 'google', model: 'gemini-3.6-flash', ok: true, attempt: 1, ms: 40_000, promptTokens: 2_000, completionTokens: 3_000, toolFeeUsd: 0.035 }),
      ledgerEntry({ stage: 'opening', provider: 'xai', model: 'grok-4.3', ok: false, attempt: 1, ms: 30_000, promptTokens: 3_000, completionTokens: 8_000, finishReason: 'length', error: 'truncated' }),
      ledgerEntry({ stage: 'rebuttal', provider: 'xai', model: 'grok-4.3', ok: true, attempt: 1, ms: 30_000, promptTokens: 3_000, completionTokens: 900 }),
      ledgerEntry({ stage: 'chair', provider: 'anthropic', model: 'claude-opus-5-5', ok: true, attempt: 1, ms: 90_000, promptTokens: 10_000, completionTokens: 5_000 }),
    ]
    expect(entries[0]!.estimatedUsd).toBe(0)
    expect(entries[1]!.estimatedUsd).toBeGreaterThan(0.035)
    const costs = stageCostsFromLedger(entries)
    expect(costs.research.billedUsd).toBeCloseTo(0.91)
    expect(costs.research.calls).toBe(2)
    expect(costs.debate.calls).toBe(2)
    expect(costs.chair.estimatedUsd).toBeCloseTo(0.14, 6)

    const hop = reportHopAccounting(
      { billed_usd: 0.91, estimated_usd: 0.05, provider_calls: 2 },
      { ledger: entries.slice(0, 2), stageCosts: stageCostsFromLedger(entries.slice(0, 2)) },
      { ledger: entries },
    )
    expect(hop.stageCosts.chair.estimatedUsd).toBeCloseTo(0.14, 6)
    expect(hop.stageCosts.debate.calls).toBe(2)
    expect(hop.totals.providerCalls).toBe(5)
    expect(hop.totals.billedUsd).toBeCloseTo(0.91)

    const line = ledgerLogLine('run-1', entries[0]!)
    expect(line).toContain('request=req_1')
    expect(line).toContain('response=resp_1')
    expect(line).toContain('billed=$0.9100')
    expect(ledgerLogLine('run-1', entries[4]!)).toMatch(/est=\$0\.14/)
  })
})

describe('deep report copy', () => {
  it('has the four plain-language steps and vote strings in every locale', () => {
    for (const locale of LEAGUE_LOCALES) {
      const copy = deepReportCopy(locale)
      for (const step of ['research', 'opening', 'rebuttal', 'counter', 'revote', 'chair'] as const) {
        expect(copy.steps[step].length).toBeGreaterThan(1)
        expect(copy.steps[step]).not.toBe(step)
      }
      expect(copy.tally(6, 5, 'X')).toContain('5')
      expect(copy.changedBadge.length).toBeGreaterThan(2)
    }
    expect(Object.values(deepReportCopy('ko').steps)).toEqual(['자료 찾는 중', '찬반 주장', '1:1 반박', '재반박', '편 떼고 재투표', '의장 정리'])
    expect(deepReportCopy('ko').changedBadge).toBe('토론 후 생각을 바꾼 AI')
  })
})

// ── Rendered report ───────────────────────────────────────────────────────────

const FINDINGS: ResearchFinding[] = [
  finding({ claim: '삼성전자는 9월 언팩에서 3단 폴더블 출시 일정을 발표하지 않았다.', date: '2026-09-24', sourceTitle: 'Samsung Newsroom', sourceUrl: 'https://news.samsung.com/global/unpacked', tier: 'official', side: 'no', queryKey: 'official_filings', providers: ['perplexity', 'google'], ref: 'E1' }),
  finding({ claim: '국립전파연구원 인증 목록에 SM-F968 모델이 9월 18일 등록됐다.', date: '2026-09-18', sourceTitle: '국립전파연구원', tier: 'regulator', side: 'yes', queryKey: 'scheduled_events', providers: ['xai'], ref: 'E2' }),
  finding({ claim: '부품 공급망 보도는 양산 시점을 2027년 상반기로 본다.', date: '2026-10-01', sourceTitle: 'Reuters', sourceUrl: 'https://www.reuters.com/tech/samsung', tier: 'major_outlet', side: 'no', queryKey: 'changed_30d', providers: ['anthropic'], ref: 'E3' }),
]

function turn(provider: string, model: string, side: 'yes' | 'no', finalSide: 'yes' | 'no', finalProbability: number, extra: Record<string, unknown> = {}) {
  return {
    provider,
    model,
    side,
    ok: true,
    attempts: 1,
    headline: `**${provider}** ### 주장 | 요약`,
    points: [
      { text: '인증 후 3~5개월 뒤 출시하는 경우가 많다', ref: 'E2' },
      { text: '언팩에서 일정이 나오지 않았다', ref: 'E1' },
      { text: '공급망 보도는 2027년을 가리킨다', ref: 'E3' },
    ],
    rebuttal: [],
    finalSide,
    finalProbability,
    whyChanged: null,
    ...extra,
  }
}

const SEATS: [string, string, 'yes' | 'no', 'yes' | 'no', number][] = [
  ['anthropic', 'claude-sonnet-5', 'yes', 'no', 70],
  ['openai', 'gpt-5.6-terra', 'yes', 'yes', 24],
  ['google', 'gemini-3.6-flash', 'yes', 'yes', 62],
  ['xai', 'grok-4.3', 'no', 'no', 85],
  ['deepseek', 'deepseek-v4-pro', 'no', 'no', 80],
  ['mistral', 'mistral-medium-3.5', 'no', 'no', 77],
]

const DONE_STATE = {
  roundId: 'c825bff1-0434-4c4b-917f-c701e245f7f8',
  instrument: 'TECH:OPEN:samsung:release:3단_폴더블:20261231:store_listing',
  category: 'tech',
  proposition: 'Samsung, 2026-10-06 이후 2026-12-31까지 3단 폴더블을 출시할까?',
  context: 'packet',
  outputLanguage: 'ko',
  sideWords: { yes: '출시함', no: '출시 안 함' },
  research: { path: 'deep', findings: FINDINGS, seats: [], deep: null, sourcesFound: 3 },
  openings: SEATS.map(([p, m, side]) => turn(p, m, side, side, 70)),
  rebuttals: SEATS.map(([p, m, side, finalSide, prob]) =>
    turn(p, m, side, finalSide, prob, {
      rebuttal: [{ text: '상대는 인증을 곧 출시로 과장했다', ref: 'E2' }],
      points: [{ text: '공급망 보도가 가장 강한 근거다', ref: 'E3' }],
      whyChanged: finalSide !== side ? '공급망 보도가 인증보다 무겁다' : null,
    }),
  ),
  chair: {
    verdictSide: 'no',
    verdictProbability: 82,
    oneLine: '**인증은 났지만** 연내 출시 신호가 없다',
    vs40Why: '공급망 보도(E3)를 더 무겁게 봐 NO 쪽으로 기울었다',
    vs40RelationClaimed: 'stronger',
    relation: 'stronger',
    ai40: { side: 'no', confidence: 71, yes: 12, no: 28, noAnswer: 0, total: 40 },
    keyEvidence: [
      { claim: '9월 언팩에서 일정 언급 없음', source: 'Samsung Newsroom', date: '2026-09-24', tier: 'official', ref: 'E1' },
      { claim: '전파인증 등록', source: '국립전파연구원', date: '2026-09-18', tier: 'regulator', ref: 'E2' },
      { claim: '2027년 상반기 양산 보도', source: 'Reuters', date: '2026-10-01', tier: 'major_outlet', ref: 'E3' },
    ],
    debateJudgment: ['ChatGPT는 E2의 의미를 과장했다 (E1, E3).', 'Grok은 공급망 근거를 잘 썼다'],
    minorityView: '인증 후 2개월 내 출시한 전례도 있다',
    flipTriggers: [{ event: '삼성 공식 예약 판매 공지', byDate: '2026-11-30' }],
    scenarios: [{ name: '2027년 출시', weight: 70 }],
  },
  ledger: [{ stage: 'chair', provider: 'anthropic', model: 'claude-opus-5-5', requestId: 'req_x' }],
  result: { ok: true, report: '출시 안 함 · 82% — 인증은 났지만 연내 출시 신호가 없다' },
}

function renderText(snap: DeepReportSnapshot): string {
  const html =
    renderToStaticMarkup(createElement(DeepReportProgress, { snap, stage: 'done', running: false, locale: 'ko' })) +
    renderToStaticMarkup(createElement(DeepReportView, { snap, locale: 'ko' }))
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
}

describe('rendered deep report', () => {
  const snap = buildDeepSnapshot('report', scrubVisibleDeepState(DONE_STATE)) as DeepReportSnapshot

  it('leads with the verdict, the 40-AI relation and the final vote', () => {
    expect(snap.verdict).toMatchObject({ side: 'no', probability: 82, relation: 'stronger' })
    const text = renderText(snap)
    expect(text).toContain('출시 안 함 · 82%')
    expect(text).toContain('6명 중 5명 출시 안 함')
    expect(text).toContain('토론 후 생각을 바꾼 AI')
    expect(text).toContain('ChatGPT')
    expect(text).toContain('출시 안 함 76%')
    expect(text).toContain('삼성 공식 예약 판매 공지')
    expect(text).toContain('ChatGPT는 국립전파연구원의 의미를 과장했다.')
    expect(text).toContain('공급망 보도를 더 무겁게 봐 출시 안 함 쪽으로 기울었다')
    expect(text.indexOf('출시 안 함 · 82%')).toBeLessThan(text.indexOf('6명 중 5명'))
    expect(snap.keyEvidence[0]).toMatchObject({ url: 'https://news.samsung.com/global/unpacked', tier: 'official', agreement: 2 })
  })

  it('shows no internal ids, codes, model ids or markdown', () => {
    const text = renderText(snap)
    for (const leak of ['TECH:OPEN', 'research', 'opening', 'rebuttal', 'chair', 'claude-sonnet-5', 'gpt-5.6-terra', 'req_x', 'E1', 'E2', 'E3', 'YES', 'NO', '###', '**', '|', '(출처: )']) {
      expect(text, leak).not.toContain(leak)
    }
    expect(snap.instrument).toBeNull()
  })

  it('renders a pre-JSON run as plain text without markdown', () => {
    const legacy = buildDeepSnapshot('report', {
      category: 'tech',
      research: { dossier: '### 1. x' },
      openings: [{ provider: 'xai', model: 'grok-4.3', side: 'no', text: 'wall of text', ok: true }],
      rebuttals: [],
      chairReport: '## 1. 결론\n**출시 안 함** | 근거',
      result: { ok: true, report: '...' },
    }) as DeepReportSnapshot
    expect(legacy.legacyText).toBe('1. 결론\n출시 안 함 근거')
    expect(legacy.seats).toEqual([])
  })
})
