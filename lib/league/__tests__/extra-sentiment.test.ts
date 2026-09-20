import { describe, expect, it } from 'vitest'
import { buildCardData, type PredictionRow, type RoundRow } from '../card-aggregate'
import {
  SENTIMENT_ENGINE_MODEL_ID,
  SENTIMENT_FORBIDDEN_ENGINES,
  SENTIMENT_NO_SIGNAL_REASON,
  SENTIMENT_PERSONA,
  assertSentimentInputShape,
  buildSentimentInput,
  buildSentimentSystemPrompt,
  buildSentimentUserPrompt,
  expectedSentimentCostUsdPerRound,
  findSentimentChartLeak,
  findSentimentLanguage,
  findSentimentPriceFundamentalLeak,
  leagueSideFromSentiment,
  parseSentimentOutput,
  sentimentRationaleNeedsRetry,
} from '../extra/sentiment'
import { EXTRA_STUB_REASON } from '../extra/stubs'
import { lookupRosterEntry } from '../roster'

function round(): RoundRow {
  return {
    id: 'round-sentiment',
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

function sampleInput() {
  return buildSentimentInput({
    proposition_text: 'Will XPT close higher 24h from now?',
    category: 'gold_metals',
    instrument: 'XPT',
    horizon: '1d',
    subject_label: 'Platinum',
    proposition_kind: 'binary_close_higher',
  })
}

describe('sentiment extra seat — engine + contract', () => {
  it('is powered by Perplexity sonar, not reasoning-pro or Grok X-crawl', () => {
    const engine = lookupRosterEntry(SENTIMENT_ENGINE_MODEL_ID)
    expect(SENTIMENT_ENGINE_MODEL_ID).toBe('sonar')
    expect(engine?.league_tier).toBe('scout')
    expect(engine?.caller.kind).toBe('core')
    if (engine?.caller.kind === 'core') {
      expect(engine.caller.provider).toBe('perplexity')
      expect(engine.caller.modelOverride).toBe('sonar')
      expect(engine.caller.searchTool).toBeFalsy()
    }
    expect(SENTIMENT_FORBIDDEN_ENGINES).toContain('grok-4.6-livesearch')
    expect(SENTIMENT_ENGINE_MODEL_ID).not.toMatch(/grok/i)
    expect(SENTIMENT_ENGINE_MODEL_ID).not.toBe('sonar-reasoning-pro')
  })

  it('persona asks for news/web-visible opinion in sentiment language only', () => {
    const system = buildSentimentSystemPrompt()
    expect(system).toContain(SENTIMENT_PERSONA)
    expect(system).toContain('분위기는 ~')
    expect(system).toContain('여론이 ~로 기운다')
    expect(system).toContain('web-visible')
    expect(system).toMatch(/X\/Twitter|live comments/)
    expect(system).toContain('found":false')
    expect(system).toContain('Do NOT look at charts')
    expect(system).toContain('no TIPS')
  })

  it('feeds only the proposition — no price series, packet, or TIPS', () => {
    const input = sampleInput()
    expect(() => assertSentimentInputShape(input)).not.toThrow()
    expect(Object.keys(input).sort()).toEqual(
      ['category', 'horizon', 'instrument', 'proposition', 'propositionKind', 'subjectName'].sort(),
    )
    expect(() => assertSentimentInputShape({ ...input, series: [{ date: '2026-09-19', close: 1 }] })).toThrow(/series/)
    expect(() => assertSentimentInputShape({ ...input, packet: { tips: 2.68 } })).toThrow(/packet/)
    expect(() => assertSentimentInputShape({ ...input, latestClose: 1062 })).toThrow(/latestClose/)
    expect(() => assertSentimentInputShape({ ...input, tips: 2.68 })).toThrow(/tips/)

    const user = buildSentimentUserPrompt(input)
    expect(user).toContain('Will XPT close higher')
    expect(user).toContain('web-visible crowd sentiment')
    expect(user).not.toMatch(/TIPS|CPI|PRICE SERIES|latest close/i)
  })

  it('parses sentiment-language verdicts and maps contract sides', () => {
    const parsed = parseSentimentOutput(
      '{"direction":"down","probability":58,"rationale":"여론이 약세로 기운다. 포럼·블로그 화제는 수요 둔화 루머 쪽이다."}',
    )
    expect(parsed).toEqual({
      kind: 'verdict',
      verdict: 'down',
      confidence: 58,
      rationale: '여론이 약세로 기운다. 포럼·블로그 화제는 수요 둔화 루머 쪽이다.',
    })
    expect(findSentimentLanguage(parsed && parsed.kind === 'verdict' ? parsed.rationale : '')).toBeTruthy()
    expect(leagueSideFromSentiment('down', 'binary_close_higher')).toBe('down')
    expect(leagueSideFromSentiment('up', 'binary_subject_outcome')).toBe('yes')
  })

  it('abstains when search finds no meaningful sentiment — does not invent a vote', () => {
    const parsed = parseSentimentOutput(
      '{"direction":null,"found":false,"probability":null,"rationale":"검색으로 드러난 여론이 없어 판단하지 않습니다."}',
    )
    expect(parsed).toEqual({
      kind: 'abstain',
      rationale: '검색으로 드러난 여론이 없어 판단하지 않습니다.',
    })
    expect(SENTIMENT_NO_SIGNAL_REASON).toContain('여론이 없어')
  })

  it('rejects chart-pattern and packet-macro language in the rationale', () => {
    expect(findSentimentChartLeak('쌍바닥 넥라인 돌파')).toBeTruthy()
    expect(findSentimentChartLeak('여론이 공포로 기운다')).toBeNull()
    expect(findSentimentPriceFundamentalLeak('TIPS 2.68%가 하락을 가리킨다')).toBe('tips')
    expect(findSentimentPriceFundamentalLeak('분위기는 낙관 쪽이다')).toBeNull()
    expect(sentimentRationaleNeedsRetry('쌍바닥 형성 후 상승')).toBe(true)
    expect(sentimentRationaleNeedsRetry('TIPS 2.68%')).toBe(true)
    expect(sentimentRationaleNeedsRetry('가격이 오른다')).toBe(true)
    expect(sentimentRationaleNeedsRetry('여론이 낙관으로 기운다. 화제는 공급 차질 루머다.')).toBe(false)
  })

  it('documents 1 Perplexity search call / round and a cheap band vs Grok', () => {
    const cost = expectedSentimentCostUsdPerRound()
    expect(cost.engine).toBe('sonar')
    expect(cost.calls).toBe(1)
    expect(cost.searchSource).toBe('perplexity-web-index')
    expect(cost.notGrok).toBe(true)
    expect(cost.typicalLow).toBe(0.01)
    expect(cost.typicalHigh).toBe(0.03)
    expect(cost.typicalHigh).toBeLessThan(0.1)
  })

  it('sentiment votes stay out of the official 40-AI consensus math', () => {
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
    const sentimentDown = pred({
      model_id: 'sentiment',
      brand: '📰 심리·내러티브',
      camp: 'other',
      league_tier: 'extra',
      predicted_direction: 'down',
      predicted_value: 58,
      reasoning_snippet: '여론이 약세로 기운다.',
    })
    const without = buildCardData(round(), official)
    const withSentiment = buildCardData(round(), [...official, sentimentDown])
    expect(withSentiment.models.map((m) => m.model_id)).toContain('sentiment')
    expect(withSentiment.tierSplit.extra).toEqual({ up: 0, down: 1, flat: 0, abstain: 0 })
    expect(withSentiment.consensus).toEqual(without.consensus)
    expect(withSentiment.campSplit).toEqual(without.campSplit)
    expect(withSentiment.bookSplit).toEqual(without.bookSplit)
    expect(withSentiment.weightsSplit).toEqual(without.weightsSplit)
    expect(withSentiment.consensus.totalModels).toBe(2)
    expect(withSentiment.consensus.majorityDirection).toBe('up')
  })

  it('leaves no extra stubs once sentiment is wired', () => {
    expect(EXTRA_STUB_REASON).not.toHaveProperty('sentiment')
    expect(Object.keys(EXTRA_STUB_REASON)).toEqual([])
  })
})
