import { describe, expect, it } from 'vitest'
import {
  applyYongsinGuard,
  formatComputedYongsinLine,
  formatInferredYongsinLine,
  parseFiveElement,
  readYongsinChartState,
  yongsinNarrativeOverride,
  yongsinSilenceIn,
} from '../yongsin-guard'

describe('parseFiveElement', () => {
  it('reads english, korean, hanja, and 화(火)', () => {
    expect(parseFiveElement('fire')).toBe('fire')
    expect(parseFiveElement('화')).toBe('fire')
    expect(parseFiveElement('火')).toBe('fire')
    expect(parseFiveElement('화(火)')).toBe('fire')
    expect(parseFiveElement('금(金)')).toBe('metal')
    expect(parseFiveElement('없음')).toBeNull()
  })
})

describe('applyYongsinGuard', () => {
  it('blocks a different element when 억부 produced a 용신', () => {
    const clash = applyYongsinGuard({
      state: { computed: 'fire', inapplicable: false, balanced: false },
      proposed: 'metal',
      narrative: '이 사주의 용신은 금입니다.',
    })
    expect(clash.defect).toBe('override')
    expect(clash.needed).toBeNull()

    const same = applyYongsinGuard({
      state: { computed: 'fire', inapplicable: false, balanced: false },
      proposed: 'fire',
      narrative: '용신 화(火)를 따라 설기합니다.',
    })
    expect(same.defect).toBeNull()
    expect(same.needed).toBeNull()
  })

  it('does not treat a matching 용신 in prose as an override', () => {
    expect(yongsinNarrativeOverride('용신 화로 설기한다', 'fire')).toBe(false)
    expect(yongsinNarrativeOverride('용신 금이 필요합니다', 'fire')).toBe(true)
  })

  it('requires an inferred 오행 when 억부 판정불가', () => {
    const silent = applyYongsinGuard({
      state: { computed: null, inapplicable: true, balanced: false },
      proposed: null,
      narrative: '용신을 하나로 고정하지 않습니다. 편왕이 강해 억부가 닫힙니다.',
    })
    expect(silent.defect).toBe('silence')
    expect(yongsinSilenceIn('용신을 하나로 고정하지 않습니다')).toBe(true)

    const inferred = applyYongsinGuard({
      state: { computed: null, inapplicable: true, balanced: false },
      proposed: 'wood',
      narrative: '종왕격으로 목을 따릅니다.',
    })
    expect(inferred.defect).toBeNull()
    expect(inferred.needed).toBe('목(木)')
  })

  it('refuses a 용신 pick when 강약 is 중화', () => {
    const result = applyYongsinGuard({
      state: { computed: null, inapplicable: false, balanced: true },
      proposed: 'fire',
      narrative: '중화이므로 화를 용신으로 둡니다.',
    })
    expect(result.defect).toBe('balanced')
    expect(result.needed).toBeNull()
  })
})

describe('readYongsinChartState', () => {
  it('treats 억부법 계산 as TIER 1 and AI 판단 요청 as TIER 2', () => {
    expect(
      readYongsinChartState({
        chart: { 용신: { 용신: '화(火)', 판정불가: '없음', 출처: '억부법 계산', 강약: '신약' } },
      }),
    ).toEqual({ computed: 'fire', inapplicable: false, balanced: false })
    expect(
      readYongsinChartState({
        chart: { 용신: { 용신: '없음', 판정불가: '편왕 (목(木) 4/8자)', 출처: 'AI 판단 요청', 강약: '없음' } },
      }),
    ).toEqual({ computed: null, inapplicable: true, balanced: false })
  })
})

describe('provenance labels', () => {
  it('distinguishes computed from inferred', () => {
    expect(formatComputedYongsinLine('화(火)')).toBe('용신 화(火) · 억부법 계산')
    expect(formatInferredYongsinLine('화(火)')).toBe('화(火)가 필요해 보입니다 · AI 판단')
  })
})
