import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  callLeagueDeepModel: vi.fn(),
  submitAgentResearch: vi.fn(),
  getAgentResearch: vi.fn(),
  cancelAgentResearch: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  supabaseAdmin: {
    from: () => {
      throw new Error('no database in this test')
    },
  },
}))

vi.mock('../deep-model', () => ({ callLeagueDeepModel: mocks.callLeagueDeepModel }))

vi.mock('../deep-perplexity-agent', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../deep-perplexity-agent')>()
  return {
    ...actual,
    submitAgentResearch: mocks.submitAgentResearch,
    getAgentResearch: mocks.getAgentResearch,
    cancelAgentResearch: mocks.cancelAgentResearch,
  }
})

import { stageCostsFromLedger } from '../deep-report-ledger'
import { advanceReportState, keepRevoteTally, reportSideWords, type ReportPipelineState } from '../deep-report-run'

type CallArgs = { provider: string; modelOverride: string; userPrompt: string; maxCompletionTokens: number }

function reply(text: string, extra: Partial<{ finishReason: string; promptTokens: number; completionTokens: number }> = {}) {
  return {
    text,
    model: 'm',
    finishReason: extra.finishReason ?? 'stop',
    usage: { promptTokens: extra.promptTokens ?? 1000, completionTokens: extra.completionTokens ?? 500, billedUsd: null, toolFeeUsd: null },
    ms: 10,
  }
}

const BASE: ReportPipelineState = {
  roundId: 'c825bff1-0434-4c4b-917f-c701e245f7f8',
  instrument: 'TECH:OPEN:samsung:release:3단_폴더블:20261231:store_listing',
  category: 'tech',
  proposition: 'Samsung, 2026-10-06 이후 2026-12-31까지 3단 폴더블을 출시할까?',
  context: 'packet',
  outputLanguage: 'ko',
  sideWords: { yes: '출시함', no: '출시 안 함' },
}

const FINDINGS_JSON = JSON.stringify({
  findings: [
    { claim: '[en/official_filings] none found', date: null, source_title: 'x', source_url: null, tier: 'other', side: 'context', query_key: 'official_filings' },
    {
      claim: '삼성전자는 9월 언팩에서 3단 폴더블 출시 일정을 발표하지 않았다.',
      date: '2026-09-24',
      source_title: 'Samsung Newsroom',
      source_url: 'https://news.samsung.com/fabricated',
      tier: 'official',
      side: 'no',
      query_key: 'official_filings',
    },
  ],
})

const OPENING_JSON = JSON.stringify({
  headline: '연내 출시 신호가 약하다',
  points: [
    { text: '언팩에서 일정이 나오지 않았다', ref: 'E1' },
    { text: '인증만으로는 출시를 보장하지 않는다', ref: null },
    { text: '공급망 보도는 2027년을 가리킨다', ref: null },
  ],
  final_side: 'yes',
  final_probability: 24,
})

const CHAIR_JSON = JSON.stringify({
  verdict_side: 'no',
  verdict_probability: 80,
  one_line: '연내 출시 발표·예약 신호가 없다',
  vs_40ai: { ai40_side: 'no', ai40_confidence: 70, relation: 'stronger', why: '공식 일정 부재를 더 무겁게 봤다' },
  key_evidence: [
    { claim: '언팩 일정 언급 없음', source: 'Samsung Newsroom', date: '2026-09-24', tier: 'official', ref: 'E1' },
    { claim: '전파인증 등록', source: '국립전파연구원', date: '2026-09-18', tier: 'regulator', ref: null },
    { claim: '2027년 양산 보도', source: 'Reuters', date: '2026-10-01', tier: 'major_outlet', ref: null },
  ],
  debate_judgment: ['ChatGPT는 인증을 과장했다', 'Grok은 공급망 근거를 잘 썼다'],
  minority_view: null,
  flip_triggers: [{ event: '삼성 예약 판매 공지', by_date: '2026-11-30' }],
  scenarios: [],
})

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => undefined)
})

afterEach(() => {
  vi.restoreAllMocks()
  mocks.callLeagueDeepModel.mockReset()
  mocks.submitAgentResearch.mockReset()
  mocks.getAgentResearch.mockReset()
  delete process.env.LEAGUE_DEEP_RESEARCH_CAP_USD
})

describe('deep report research hop', () => {
  it('submits Perplexity deep research (preset high) and logs its ids, tokens and billed cost', async () => {
    mocks.submitAgentResearch.mockResolvedValue({ id: 'resp_1', status: 'queued', requestId: 'req_1', error: null, text: null, searchResults: [] })
    mocks.getAgentResearch.mockResolvedValue({
      id: 'resp_1',
      status: 'completed',
      text: FINDINGS_JSON,
      searchResults: [{ title: 'Samsung Newsroom', url: 'https://news.samsung.com/global/unpacked-2026', date: '2026-09-24' }],
      inputTokens: 150_000,
      outputTokens: 9_000,
      costUsd: 0.91,
      model: 'agent-high',
      error: null,
      requestId: 'req_2',
    })
    mocks.callLeagueDeepModel.mockResolvedValue(reply(FINDINGS_JSON))

    const out = await advanceReportState(BASE, { runId: 'run-1' })
    expect(out.done).toBe(false)
    expect(out.done === false && out.stage).toBe('opening')

    expect(mocks.submitAgentResearch).toHaveBeenCalledWith(expect.objectContaining({ preset: 'high', schemaName: 'deepreportfindings' }))
    expect(mocks.getAgentResearch).toHaveBeenCalledWith('resp_1')
    expect(mocks.callLeagueDeepModel.mock.calls.map(([args]) => (args as CallArgs).modelOverride)).toEqual([
      'gemini-3.6-flash',
      'grok-4.3',
      'claude-sonnet-5',
    ])

    const research = out.state.research!
    expect(research.deep).toMatchObject({ used: true, responseId: 'resp_1', requestId: 'req_1', status: 'completed', kept: 1, dropped: 1 })
    expect(research.findings).toHaveLength(1)
    expect(research.findings[0]!.providers.sort()).toEqual(['anthropic', 'google', 'perplexity', 'xai'])
    expect(research.findings[0]!.sourceUrl).toBe('https://news.samsung.com/global/unpacked-2026')

    const deepEntry = out.state.ledger!.find((row) => row.provider === 'perplexity')!
    expect(deepEntry).toMatchObject({ stage: 'research', ok: true, billedUsd: 0.91, promptTokens: 150_000, completionTokens: 9_000, responseId: 'resp_1', requestId: 'req_1' })
    expect(out.state.ledger!.filter((row) => row.stage === 'research')).toHaveLength(4)
    const logged = (console.log as unknown as { mock: { calls: unknown[][] } }).mock.calls.map((c) => String(c[0]))
    expect(logged.some((line) => line.includes('response=resp_1') && line.includes('billed=$0.9100'))).toBe(true)
    expect(logged.some((line) => line.includes('research done') && line.includes('deep_used=true'))).toBe(true)
  })

  it('falls back to preset low over the cap and says why deep research produced nothing', async () => {
    process.env.LEAGUE_DEEP_RESEARCH_CAP_USD = '0.1'
    mocks.submitAgentResearch.mockResolvedValue({ id: null, status: 'failed', requestId: 'req_9', error: 'HTTP 401 - invalid key', text: null, searchResults: [] })
    mocks.callLeagueDeepModel.mockResolvedValue(reply(FINDINGS_JSON))

    const out = await advanceReportState(BASE, { runId: 'run-2' })
    expect(mocks.submitAgentResearch).toHaveBeenCalledWith(expect.objectContaining({ preset: 'low' }))
    expect(mocks.callLeagueDeepModel).toHaveBeenCalledTimes(1)
    expect(out.state.research!.path).toBe('standard_fallback')
    expect(out.state.research!.deep).toMatchObject({ used: false, status: 'failed', error: 'HTTP 401 - invalid key' })
    const logged = (console.log as unknown as { mock: { calls: unknown[][] } }).mock.calls.map((c) => String(c[0]))
    expect(logged.some((line) => line.includes('research path=standard_fallback preset=low cap=$0.1'))).toBe(true)
    expect(logged.some((line) => line.includes('deep_reason=HTTP 401'))).toBe(true)
  })
})

describe('deep report debate and chair hops', () => {
  const researched: ReportPipelineState = {
    ...BASE,
    research: {
      path: 'deep',
      findings: [
        {
          claim: '삼성전자는 9월 언팩에서 3단 폴더블 출시 일정을 발표하지 않았다.',
          date: '2026-09-24',
          sourceTitle: 'Samsung Newsroom',
          sourceUrl: 'https://news.samsung.com/global/unpacked-2026',
          tier: 'official',
          side: 'no',
          queryKey: 'official_filings',
          providers: ['perplexity'],
          ref: 'E1',
        },
      ],
      seats: [],
      deep: null,
      sourcesFound: 1,
    },
  }

  it('retries a truncated opening once with a JSON-only instruction and keeps the final call independent of the side', async () => {
    const seen = new Map<string, number>()
    mocks.callLeagueDeepModel.mockImplementation(async (args: CallArgs) => {
      const n = (seen.get(args.provider) ?? 0) + 1
      seen.set(args.provider, n)
      return n === 1 ? reply(OPENING_JSON.slice(0, 90), { finishReason: 'length', completionTokens: 8000 }) : reply(OPENING_JSON)
    })

    const out = await advanceReportState(researched, { runId: 'run-3' })
    expect(out.done === false && out.stage).toBe('rebuttal')
    expect(mocks.callLeagueDeepModel).toHaveBeenCalledTimes(12)
    const calls = mocks.callLeagueDeepModel.mock.calls.map(([args]) => args as CallArgs)
    expect(calls.every((args) => args.maxCompletionTokens >= 8000)).toBe(true)
    const retries = calls.filter((args) => args.userPrompt.includes('rejected (truncated)'))
    expect(retries).toHaveLength(6)

    const openings = out.state.openings!
    expect(openings).toHaveLength(6)
    expect(openings.every((row) => row.ok && row.attempts === 2)).toBe(true)
    // Assigned YES or NO, the stated "yes 24" is a NO 76 call.
    expect(openings.every((row) => row.finalSide === 'no' && row.finalProbability === 76)).toBe(true)
    const ledger = out.state.ledger!
    expect(ledger.filter((row) => row.stage === 'opening' && !row.ok)).toHaveLength(6)
    expect(ledger.filter((row) => row.stage === 'opening' && !row.ok).every((row) => row.error === 'truncated' && row.finishReason === 'length')).toBe(true)
    expect(stageCostsFromLedger(ledger).debate.calls).toBe(12)
  })

  it('retries the chair once, relates it to the 40-AI result, and costs the call', async () => {
    const debated: ReportPipelineState = {
      ...researched,
      openings: [
        { provider: 'openai', model: 'gpt-5.6-terra', side: 'yes', ok: true, attempts: 1, headline: 'h', points: [{ text: 'p', ref: 'E1' }], rebuttal: [], finalSide: 'yes', finalProbability: 60, whyChanged: null },
      ],
      rebuttals: [
        { provider: 'openai', model: 'gpt-5.6-terra', side: 'yes', ok: true, attempts: 1, headline: 'h2', points: [], rebuttal: [{ text: 'r', ref: null }], finalSide: 'no', finalProbability: 76, whyChanged: 'w' },
      ],
      fortySeat: { side: 'no', confidence: 70, yes: 10, no: 30, noAnswer: 0, total: 40 },
      revotes: [],
    }
    mocks.callLeagueDeepModel
      .mockResolvedValueOnce(reply(JSON.stringify({ ...JSON.parse(CHAIR_JSON), flip_triggers: [] })))
      .mockResolvedValueOnce(reply(CHAIR_JSON, { promptTokens: 10_000, completionTokens: 5_000 }))

    const out = await advanceReportState(debated, { runId: 'run-4' })
    expect(out.done).toBe(true)
    if (!out.done) return
    expect(out.result).toEqual({ ok: true, report: '출시 안 함 · 80% — 연내 출시 발표·예약 신호가 없다' })
    const [first, second] = mocks.callLeagueDeepModel.mock.calls.map(([args]) => args as CallArgs)
    expect(first!.modelOverride).toBe('claude-opus-5-5')
    expect(first!.maxCompletionTokens).toBeGreaterThanOrEqual(16000)
    expect(first!.userPrompt).toContain('final NO 76% (changed side)')
    expect(second!.userPrompt).toContain('rejected (missing flip triggers)')
    expect(out.state.chair).toMatchObject({ verdictSide: 'no', verdictProbability: 80, relation: 'stronger', vs40Why: '공식 일정 부재를 더 무겁게 봤다' })
    const chairCost = stageCostsFromLedger(out.state.ledger!).chair
    expect(chairCost.calls).toBe(2)
    expect(chairCost.estimatedUsd).toBeGreaterThan(0.14)
  })

  it('drops an invalid re-vote and still reaches the chair without failing the report', async () => {
    const ready: ReportPipelineState = {
      ...researched,
      openings: [
        { provider: 'openai', model: 'gpt-5.6-terra', side: 'yes', ok: true, attempts: 1, headline: 'h', points: [{ text: 'p', ref: 'E1' }], rebuttal: [], finalSide: 'yes', finalProbability: 60, whyChanged: null },
      ],
      rebuttals: [],
      counters: [],
    }
    mocks.callLeagueDeepModel.mockResolvedValue(reply('not a revote'))

    const out = await advanceReportState(ready, { runId: 'run-revote-drop' })
    expect(out.done).toBe(false)
    if (out.done) return
    expect(out.stage).toBe('chair')
    expect(out.state.revotes).toEqual([])
    expect(out.state.result).toBeUndefined()
    expect(keepRevoteTally(out.state.revotes ?? [], ready.openings ?? [])).toBe(false)
    expect(mocks.callLeagueDeepModel.mock.calls.every(([args]) => (args as CallArgs).userPrompt.includes('neutral referee'))).toBe(true)
  })
})

describe('report side words', () => {
  it('uses the round contract words, not YES/NO', () => {
    const words = reportSideWords(
      { proposition_kind: 'binary_subject_outcome', category: 'tech', instrument: BASE.instrument },
      'ko',
    )
    expect(words).toEqual({ yes: '출시함', no: '출시 안 함' })
  })
})
