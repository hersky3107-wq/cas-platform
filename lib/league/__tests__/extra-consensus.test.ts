import { describe, expect, it } from 'vitest'
import { buildCardData, type PredictionRow, type RoundRow } from '../card-aggregate'
import {
  CONSENSUS_ENGINE_MODEL_ID,
  CONSENSUS_FORBIDDEN_ENGINES,
  CONSENSUS_CRYPTO_MONEY_HINTS,
  CONSENSUS_INDEX_MONEY_HINTS,
  CONSENSUS_MONEY_SIGNALS,
  CONSENSUS_NO_SIGNAL_REASON,
  CONSENSUS_PERSONA,
  assertConsensusInputShape,
  buildConsensusInput,
  buildConsensusSystemPrompt,
  buildConsensusUserPrompt,
  consensusMoneySearchHints,
  expectedConsensusCostUsdPerRound,
  findConsensusChartLeak,
  findConsensusMoneyLanguage,
  findConsensusNewsMoodLeak,
  findConsensusPacketLeak,
  leagueSideFromConsensus,
  parseConsensusOutput,
  consensusRationaleNeedsRetry,
} from '../extra/consensus'
import { EXTRA_STUB_REASON } from '../extra/stubs'
import { lookupRosterEntry } from '../roster'

function round(): RoundRow {
  return {
    id: 'round-consensus',
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
  return buildConsensusInput({
    proposition_text: 'Will XPT close higher 24h from now?',
    category: 'gold_metals',
    instrument: 'XPT',
    horizon: '1d',
    subject_label: 'Platinum',
    proposition_kind: 'binary_close_higher',
  })
}

describe('consensus extra seat — engine + contract', () => {
  it('is powered by Perplexity sonar, not reasoning-pro or Grok', () => {
    const engine = lookupRosterEntry(CONSENSUS_ENGINE_MODEL_ID)
    expect(CONSENSUS_ENGINE_MODEL_ID).toBe('sonar')
    expect(engine?.league_tier).toBe('scout')
    if (engine?.caller.kind === 'core') {
      expect(engine.caller.provider).toBe('perplexity')
      expect(engine.caller.modelOverride).toBe('sonar')
    }
    expect(CONSENSUS_FORBIDDEN_ENGINES).toContain('grok-4.6-livesearch')
    expect(CONSENSUS_ENGINE_MODEL_ID).not.toMatch(/grok/i)
    expect(CONSENSUS_ENGINE_MODEL_ID).not.toBe('sonar-reasoning-pro')
  })

  it('persona searches money-positioning signals in market-priced language', () => {
    const system = buildConsensusSystemPrompt()
    expect(system).toContain(CONSENSUS_PERSONA)
    expect(system).toContain('옵션 시장은 ~%를 반영')
    expect(system).toContain('Polymarket')
    expect(system).toContain('Kalshi')
    expect(system).toContain('COT')
    expect(system).toContain('funding rate')
    expect(system).toContain('Deribit')
    expect(system).toContain('VIX')
    expect(system).toContain('etf_index')
    expect(system).toContain('crypto_spot')
    expect(system).toContain('found":false')
    expect(CONSENSUS_MONEY_SIGNALS.join(' ')).toMatch(/implied probability/)
    expect(CONSENSUS_MONEY_SIGNALS.join(' ')).toMatch(/Polymarket/)
    expect(CONSENSUS_MONEY_SIGNALS.join(' ')).toMatch(/COT/)
    expect(CONSENSUS_MONEY_SIGNALS.join(' ')).toMatch(/institutional/)
  })

  it('user prompt names category-specific money signals for index ETFs and crypto', () => {
    const indexUser = buildConsensusUserPrompt(
      buildConsensusInput({
        proposition_text: 'Will DIA close higher by 2026-09-23 than its last close?',
        category: 'etf_index',
        instrument: 'DIA',
        horizon: '1d',
        subject_label: 'DIA',
        proposition_kind: 'binary_close_higher',
      }),
    )
    expect(indexUser).toContain('YM')
    expect(indexUser).toContain('CBOE')
    expect(indexUser).toContain('VIX')
    expect(indexUser).toMatch(/do not abstain/i)
    expect(CONSENSUS_INDEX_MONEY_HINTS.join(' ')).toMatch(/YM/)

    const cryptoUser = buildConsensusUserPrompt(
      buildConsensusInput({
        proposition_text: 'Will DOGE/USD close higher by 2026-09-23 than its last close?',
        category: 'memecoin',
        instrument: 'DOGE/USD',
        horizon: '1d',
        subject_label: 'DOGE/USD',
        proposition_kind: 'binary_close_higher',
      }),
    )
    expect(cryptoUser).toContain('funding')
    expect(cryptoUser).toContain('Deribit')
    expect(cryptoUser).toContain('taker')
    expect(cryptoUser).toMatch(/do not abstain/i)
    expect(consensusMoneySearchHints('crypto_spot')).toContain('funding')
    expect(CONSENSUS_CRYPTO_MONEY_HINTS.join(' ')).toMatch(/funding/)
  })

  it('feeds only the proposition — no price series, packet, or TIPS', () => {
    const input = sampleInput()
    expect(() => assertConsensusInputShape(input)).not.toThrow()
    expect(Object.keys(input).sort()).toEqual(
      ['category', 'horizon', 'instrument', 'proposition', 'propositionKind', 'subjectName'].sort(),
    )
    expect(() => assertConsensusInputShape({ ...input, series: [{ date: '2026-09-19', close: 1 }] })).toThrow(/series/)
    expect(() => assertConsensusInputShape({ ...input, packet: { tips: 2.68 } })).toThrow(/packet/)
    expect(() => assertConsensusInputShape({ ...input, latestClose: 1062 })).toThrow(/latestClose/)

    const user = buildConsensusUserPrompt(input)
    expect(user).toContain('Will XPT close higher')
    expect(user).toContain('money-positioning')
    expect(user).not.toMatch(/PRICE SERIES|latest close|분위기|여론/i)
  })

  it('parses money-language verdicts and maps contract sides', () => {
    const parsed = parseConsensusOutput(
      '{"direction":"up","probability":61,"rationale":"옵션 시장은 상승 내재확률을 반영하고, 선물 포지션은 투기 순매수로 기울어 있다."}',
    )
    expect(parsed).toEqual({
      kind: 'verdict',
      verdict: 'up',
      confidence: 61,
      rationale: '옵션 시장은 상승 내재확률을 반영하고, 선물 포지션은 투기 순매수로 기울어 있다.',
    })
    expect(findConsensusMoneyLanguage(parsed && parsed.kind === 'verdict' ? parsed.rationale : '')).toBeTruthy()
    expect(leagueSideFromConsensus('up', 'binary_close_higher')).toBe('up')
    expect(leagueSideFromConsensus('down', 'binary_subject_outcome')).toBe('no')
  })

  it('abstains when no money-positioning data is found — does not invent odds', () => {
    const parsed = parseConsensusOutput(
      '{"direction":null,"found":false,"probability":null,"rationale":"시장이 돈으로 매긴 확률 신호를 찾지 못했습니다."}',
    )
    expect(parsed).toEqual({
      kind: 'abstain',
      rationale: '시장이 돈으로 매긴 확률 신호를 찾지 못했습니다.',
    })
    expect(CONSENSUS_NO_SIGNAL_REASON).toBe('시장이 돈으로 매긴 확률 신호를 찾지 못했습니다')
  })

  it('rejects chart-pattern and news-mood language; keeps money language', () => {
    expect(findConsensusChartLeak('쌍바닥 넥라인 돌파')).toBeTruthy()
    expect(findConsensusNewsMoodLeak('여론이 공포로 기운다')).toBe('여론')
    expect(findConsensusPacketLeak('TIPS 2.68%')).toBe('tips')
    expect(findConsensusNewsMoodLeak('옵션 시장은 58%를 반영')).toBeNull()
    expect(consensusRationaleNeedsRetry('쌍바닥 형성 후 상승')).toBe(true)
    expect(consensusRationaleNeedsRetry('분위기는 낙관 쪽이다')).toBe(true)
    expect(consensusRationaleNeedsRetry('TIPS 2.68%')).toBe(true)
    expect(consensusRationaleNeedsRetry('예측시장 배당은 상승 쪽에 걸려 있다')).toBe(false)
    expect(findConsensusMoneyLanguage('펀딩비가 양수라 롱이 숏에게 지불한다')).toBeTruthy()
    expect(findConsensusMoneyLanguage('VIX 스큐가 풋 쪽으로 기울어 있다')).toBeTruthy()
    expect(consensusRationaleNeedsRetry('바이낸스 펀딩비는 음수다')).toBe(false)
  })

  it('documents 1 Perplexity search call / round in the same cheap band as sentiment', () => {
    const cost = expectedConsensusCostUsdPerRound()
    expect(cost.engine).toBe('sonar')
    expect(cost.calls).toBe(1)
    expect(cost.searchSource).toBe('perplexity-web-index')
    expect(cost.notGrok).toBe(true)
    expect(cost.typicalLow).toBe(0.01)
    expect(cost.typicalHigh).toBe(0.03)
    expect(cost.moneySignals).toHaveLength(4)
  })

  it('consensus extra votes stay out of the official 40-AI math', () => {
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
    const moneyDown = pred({
      model_id: 'consensus',
      brand: '💰 돈이 매긴 확률',
      camp: 'other',
      league_tier: 'extra',
      predicted_direction: 'down',
      predicted_value: 61,
      reasoning_snippet: '예측시장 배당은 하락 쪽에 걸려 있다.',
    })
    const without = buildCardData(round(), official)
    const withMoney = buildCardData(round(), [...official, moneyDown])
    expect(withMoney.models.map((m) => m.model_id)).toContain('consensus')
    expect(withMoney.tierSplit.extra).toEqual({ up: 0, down: 1, flat: 0, abstain: 0 })
    expect(withMoney.consensus).toEqual(without.consensus)
    expect(withMoney.campSplit).toEqual(without.campSplit)
    expect(withMoney.bookSplit).toEqual(without.bookSplit)
    expect(withMoney.weightsSplit).toEqual(without.weightsSplit)
    expect(withMoney.consensus.totalModels).toBe(2)
    expect(withMoney.consensus.majorityDirection).toBe('up')
  })

  it('leaves no extra stubs', () => {
    expect(Object.keys(EXTRA_STUB_REASON)).toEqual([])
  })
})
