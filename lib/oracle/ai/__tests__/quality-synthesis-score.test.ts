import { describe, expect, it } from 'vitest'
import {
  rankSynthesisBrands,
  scoreSynthesisBrand,
  type SynthesisBakeoffRun,
} from '../quality-synthesis-score'

const READERS = [
  '비견이 강해 동료와 역할을 나눠야 한다. 물 기운이 높아 우회가 유리하다.',
  '전진과 유지가 50대 50이다. 하반기 결실을 본다.',
]

function run(overrides: Partial<SynthesisBakeoffRun> = {}): SynthesisBakeoffRun {
  return {
    brand: 'OpenAI',
    panel: 'single_saju_n3',
    run: 1,
    agreements: ['비견이 강해 협업이 중요하다'],
    divergences: ['하반기 결실 시점에 이견'],
    conclusion: '비견과 물 기운을 고려해 동료와 역할을 나누며 우회하라.',
    confidence_note: null,
    contentTokens: 100,
    ms: 1,
    costUsd: 0.01,
    parsed: true,
    ...overrides,
  }
}

describe('quality-synthesis-score', () => {
  it('marks a universal conclusion as generic / DQ', () => {
    const score = scoreSynthesisBrand(
      'OpenAI',
      'single_saju_n3',
      [
        run({
          run: 1,
          conclusion: '누구에게나 해당하듯 균형이 핵심이며 단계적으로 움직이라.',
        }),
        run({
          run: 2,
          conclusion: '준비된 기회에 유연하게 조율하는 균형이 핵심입니다.',
        }),
      ],
      READERS,
    )
    expect(score.conclusionGeneric).toBe(true)
    expect(score.disqualified).toBe(true)
  })

  it('ranks grounded specific synthesis above platitudes', () => {
    const grounded = scoreSynthesisBrand(
      'DeepSeek',
      'single_saju_n3',
      [run({ brand: 'DeepSeek', run: 1 }), run({ brand: 'DeepSeek', run: 2 })],
      READERS,
    )
    const generic = scoreSynthesisBrand(
      'OpenAI',
      'single_saju_n3',
      [
        run({
          brand: 'OpenAI',
          run: 1,
          agreements: ['균형이 중요하다'],
          divergences: ['유연함이 필요하다'],
          conclusion: '균형이 핵심이다.',
        }),
        run({
          brand: 'OpenAI',
          run: 2,
          agreements: ['단계적으로 가라'],
          divergences: ['신중하라'],
          conclusion: '단계적으로 균형이 핵심이다.',
        }),
      ],
      READERS,
    )
    const ranked = rankSynthesisBrands([generic, grounded])
    expect(ranked[0]?.brand).toBe('DeepSeek')
  })
})
