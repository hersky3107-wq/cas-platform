import { describe, expect, it } from 'vitest'
import { buildCardData, type PredictionRow, type RoundRow } from '../card-aggregate'
import {
  HISTORY_ENGINE_MODEL_ID,
  HISTORY_NO_SERIES_REASON,
  HISTORY_PATTERN_VOCABULARY,
  HISTORY_PERSONA,
  assertHistoryInputShape,
  buildHistoryInput,
  buildHistorySystemPrompt,
  buildHistoryUserPrompt,
  findFakePatternWinRate,
  findHistoryNewsFundamentalLeak,
  findNamedHistoryPattern,
  formatPriceSeriesForHistory,
  historyPatternVocabularyLine,
  historyRationaleNeedsRetry,
  leagueSideFromHistory,
  parseHistoryOutput,
  stripFakePatternWinRates,
} from '../extra/history'
import { EXTRA_STUB_REASON } from '../extra/stubs'
import { lookupRosterEntry } from '../roster'

function round(): RoundRow {
  return {
    id: 'round-history',
    proposition_text: 'Will XPT close higher 24h from now?',
    category: 'gold_metals',
    color_bucket: 'yellow',
    instrument: 'XPT',
    horizon: '1d',
    resolution_rule: 'COMEX regular-session close',
    resolves_at: '2026-09-21T15:31:00.000Z',
    opened_at: '2026-09-20T21:30:00.000Z',
    actual_outcome: null,
    resolved_at: null,
  }
}

function pred(overrides: Partial<PredictionRow>): PredictionRow {
  return {
    model_id: 'gpt-5.6-sol',
    brand: 'OpenAI',
    camp: 'us',
    league_tier: 'premier',
    predicted_direction: 'up',
    predicted_value: 70,
    reasoning_snippet: 'Momentum.',
    is_correct: null,
    cost_usd: 0.01,
    predicted_at: '2026-09-20T21:31:00.000Z',
    ...overrides,
  }
}

const SAMPLE_BARS = [
  { date: '2026-06-01', close: 980 },
  { date: '2026-07-01', close: 940 },
  { date: '2026-08-01', close: 1005 },
  { date: '2026-09-01', close: 1040 },
  { date: '2026-09-19', close: 1062 },
]

function sampleInput() {
  return buildHistoryInput(
    {
      proposition_text: 'Will XPT close higher 24h from now?',
      category: 'gold_metals',
      instrument: 'XPT',
      horizon: '1d',
      subject_label: 'Platinum',
      proposition_kind: 'binary_close_higher',
      opened_at: '2026-09-20T21:30:00.000Z',
    },
    { bars: SAMPLE_BARS, latestClose: 1062, asOf: '2026-09-19' },
  )
}

describe('history extra seat — engine + contract', () => {
  it('is powered by challenger Claude Sonnet 5, not a tiny world model', () => {
    const engine = lookupRosterEntry(HISTORY_ENGINE_MODEL_ID)
    expect(HISTORY_ENGINE_MODEL_ID).toBe('claude-sonnet-5')
    expect(engine?.league_tier).toBe('challenger')
    expect(engine?.caller.kind).toBe('core')
    if (engine?.caller.kind === 'core') {
      expect(engine.caller.searchTool).toBeFalsy()
    }
  })

  it('persona and prompt name the required pattern vocabulary and forbid fake win-rates', () => {
    const system = buildHistorySystemPrompt()
    expect(system).toContain(HISTORY_PERSONA)
    expect(system).toContain('엘리어트 파동')
    expect(system).toContain('신고가/신저가 돌파형')
    expect(system).toContain('쌍바닥·쌍봉 / 헤드앤숄더')
    expect(system).toContain('U자형 턴어라운드')
    expect(system).toContain('컵앤핸들')
    expect(system).toContain('데드크로스·골든크로스')
    expect(system).toContain('3단·5단 상승 후 급등')
    expect(system).toContain('추세선 상승/하락형')
    expect(system).toContain('데드(죽음) 하락 패턴')
    expect(historyPatternVocabularyLine()).toContain('컵앤핸들')
    expect(system).toMatch(/fake fixed probabilities|made-up per-pattern win rate/i)
    expect(system).toContain('Do NOT assign fake fixed probabilities')
    expect(HISTORY_PATTERN_VOCABULARY).toHaveLength(10)
  })

  it('feeds only the price path + proposition — no research / TIPS / news packet', () => {
    const input = sampleInput()
    expect(() => assertHistoryInputShape(input)).not.toThrow()
    expect(Object.keys(input).sort()).toEqual(
      [
        'asOf',
        'category',
        'horizon',
        'instrument',
        'latestClose',
        'proposition',
        'propositionKind',
        'series',
        'subjectName',
      ].sort(),
    )
    expect(() => assertHistoryInputShape({ ...input, packet: { tips: 2.68 } })).toThrow(/packet/)
    expect(() => assertHistoryInputShape({ ...input, research: 'CPI' })).toThrow(/research/)
    expect(() => assertHistoryInputShape({ ...input, tips: 2.68 })).toThrow(/tips/)

    const user = buildHistoryUserPrompt(input)
    expect(user).toContain('Will XPT close higher')
    expect(user).toContain('2026-09-19: 1062')
    expect(user).toContain('PRICE SERIES')
    expect(user).not.toMatch(/TIPS|CPI|FOMC|earnings|research packet/i)
    expect(formatPriceSeriesForHistory(input)).not.toMatch(/TIPS|consensus|related/i)
  })

  it('parses a pattern-language verdict and maps contract sides', () => {
    const parsed = parseHistoryOutput(
      '{"direction":"up","probability":64,"rationale":"현재 흐름은 쌍바닥 형성 후 넥라인 돌파 초기로, 역사적으로 이 패턴은 상승 지속 경향이 있다."}',
    )
    expect(parsed).toMatchObject({
      verdict: 'up',
      confidence: 64,
      namedPattern: '쌍바닥·쌍봉 / 헤드앤숄더',
    })
    expect(parsed?.rationale).toContain('쌍바닥')
    expect(findNamedHistoryPattern(parsed!.rationale)).toBe('쌍바닥·쌍봉 / 헤드앤숄더')
    expect(leagueSideFromHistory('up', 'binary_close_higher')).toBe('up')
    expect(leagueSideFromHistory('down', 'binary_subject_outcome')).toBe('no')
    expect(leagueSideFromHistory('up', 'binary_threshold')).toBe('above')
  })

  it('detects fake per-pattern win-rates and does not invent replacements', () => {
    expect(findFakePatternWinRate('이 패턴은 90% 상승 확률')).toBeTruthy()
    expect(findFakePatternWinRate('historical win rate 78%')).toBeTruthy()
    expect(findFakePatternWinRate('승률 85%')).toBeTruthy()
    expect(findFakePatternWinRate('10번 중 9번 올랐다')).toBeTruthy()
    expect(
      findFakePatternWinRate('현재 흐름은 쌍바닥 형성 후 넥라인 돌파 초기로, 역사적으로 이 패턴은 상승 지속 경향'),
    ).toBeNull()
    const stripped = stripFakePatternWinRates('쌍바닥이다. 이 패턴은 90% 상승. 추세 지속 경향.')
    expect(stripped).toContain('쌍바닥')
    expect(stripped).not.toMatch(/90%/)
    expect(historyRationaleNeedsRetry('이 패턴은 90% 상승 확률')).toBe(true)
  })

  it('rejects news/fundamental packet language and accepts pattern/history language', () => {
    expect(findHistoryNewsFundamentalLeak('TIPS 2.68%가 하락을 가리킨다')).toBe('tips')
    expect(findHistoryNewsFundamentalLeak('FOMC 대기와 실적발표')).toBeTruthy()
    expect(
      findHistoryNewsFundamentalLeak('3단계 상승 후 급등은 되돌림이 잦았음. 9월 계절성상 약세 경향.'),
    ).toBeNull()
    expect(findNamedHistoryPattern('3단계 상승 후 급등은 되돌림이 잦았음')).toBe('3단·5단 상승 후 급등')
    expect(findNamedHistoryPattern('9월 계절성상 약세 경향')).toBe('계절성')
    expect(historyRationaleNeedsRetry('TIPS 2.68%')).toBe(true)
    expect(historyRationaleNeedsRetry('현재 흐름은 컵앤핸들 완성 초기로, 역사적으로 이 패턴은 상승 지속 경향')).toBe(
      false,
    )
  })

  it('history votes stay out of the official 40-AI consensus math', () => {
    const official = [
      pred({ model_id: 'gpt-5.6-sol', predicted_direction: 'up', predicted_value: 70 }),
      pred({
        model_id: 'qwen3.8-max',
        brand: 'Qwen',
        camp: 'china',
        league_tier: 'premier',
        predicted_direction: 'up',
        predicted_value: 65,
      }),
    ]
    const historyDown = pred({
      model_id: 'history',
      brand: '📜 역사·패턴',
      camp: 'other',
      league_tier: 'extra',
      predicted_direction: 'down',
      predicted_value: 64,
      reasoning_snippet: '3단계 상승 후 급등은 되돌림이 잦았음.',
    })
    const without = buildCardData(round(), official)
    const withHistory = buildCardData(round(), [...official, historyDown])
    expect(withHistory.models.map((m) => m.model_id)).toContain('history')
    expect(withHistory.tierSplit.extra).toEqual({ up: 0, down: 1, flat: 0, abstain: 0 })
    expect(withHistory.consensus).toEqual(without.consensus)
    expect(withHistory.campSplit).toEqual(without.campSplit)
    expect(withHistory.bookSplit).toEqual(without.bookSplit)
    expect(withHistory.weightsSplit).toEqual(without.weightsSplit)
    expect(withHistory.consensus.totalModels).toBe(2)
    expect(withHistory.consensus.majorityDirection).toBe('up')
  })

  it('does not stub history once all extra seats are wired', () => {
    expect(EXTRA_STUB_REASON).not.toHaveProperty('history')
    expect(Object.keys(EXTRA_STUB_REASON)).toEqual([])
    expect(HISTORY_NO_SERIES_REASON).toContain('가격 시계열')
  })
})
