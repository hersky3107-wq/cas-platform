import { describe, expect, it } from 'vitest'
import {
  detectFabrications,
  detectMachineCodeLeaks,
  genericSentenceShare,
  isMostlyKorean,
  narrativeReportsTie,
  phaseHasTie,
  scoreBrand,
  scoreGrounding,
} from '../quality-bakeoff-score'

const SAMPLE_PAYLOAD = {
  system: 'saju',
  traits: { drive: 42, stability: 30, relation: 10, control: 35, exploration: 20, reflection: 25 },
  elements: { wood: 18, fire: 22, earth: 20, metal: 15, water: 25 },
  phase: { advance: 50, hold: 50, release: 0 },
  reasons: {
    traits: ['saju.tengods.peer_dominant'],
    elements: ['saju.elements.four_pillars'],
    phase: ['saju.phase.daewoon_sewoon'],
  },
  labels: {
    traits: ['비견'],
    elements: ['사주 네 기둥'],
    phase: ['대운·세운'],
  },
  unreadable: [],
  context: { asOfDate: '2026-08-23', question: '올해 일의 방향' },
} as Record<string, unknown>

describe('quality-bakeoff-score', () => {
  it('counts human labels as grounding, not raw machine codes', () => {
    const narrative = '비견 흐름에서 drive 42와 fire 22가 advance와 hold 균형에 있습니다.'
    const { matches } = scoreGrounding(narrative, SAMPLE_PAYLOAD)
    expect(matches).toEqual(expect.arrayContaining(['비견', 'drive', 'fire', '42', '22']))
    expect(matches.some((m) => m.includes('peer_dominant'))).toBe(false)
  })

  it('does not flag labelled ten-god terms as fabrication', () => {
    const narrative = '비견이 강하고 대운·세운이 교차합니다.'
    expect(detectFabrications(narrative, SAMPLE_PAYLOAD)).toEqual([])
  })

  it('treats digits inside labels as payload evidence, not fabrication', () => {
    const payload = {
      ...SAMPLE_PAYLOAD,
      system: 'numerology',
      labels: {
        traits: ['개인년 8'],
        elements: ['라이프 패스'],
        phase: ['개인년'],
      },
    } as Record<string, unknown>
    expect(detectFabrications('올해 개인년 8의 흐름을 따르세요.', payload)).toEqual([])
  })

  it('flags invented ten-god terms not present as labels', () => {
    const narrative = '정관이 강하고 일주가 甲子입니다.'
    const fab = detectFabrications(narrative, SAMPLE_PAYLOAD)
    expect(fab).toEqual(expect.arrayContaining(['ten_god:정관', 'pillar:일주', 'stem:甲', 'branch:子']))
  })

  it('detects machine-code leakage in narrative', () => {
    const leaks = detectMachineCodeLeaks(
      'saju.phase.daewoon_sewoon and peer_dominant drive the year.',
      SAMPLE_PAYLOAD,
    )
    expect(leaks).toEqual(expect.arrayContaining(['saju.phase.daewoon_sewoon', 'peer_dominant']))
  })

  it('detects phase ties and tie-reporting language', () => {
    expect(phaseHasTie(SAMPLE_PAYLOAD)).toBe(true)
    expect(narrativeReportsTie('전진과 유지가 반반으로 팽팽합니다.')).toBe(true)
    expect(narrativeReportsTie('올해는 거침없이 전진하세요.')).toBe(false)
  })

  it('measures generic sentence share', () => {
    const narrative =
      '올해는 신중하게 나아가세요. drive 42와 비견 흐름이 중요합니다.'
    expect(genericSentenceShare(narrative, SAMPLE_PAYLOAD)).toBeCloseTo(0.5, 1)
  })

  it('detects Korean locale', () => {
    expect(isMostlyKorean('화(火) 기운과 advance 흐름')).toBe(true)
    expect(isMostlyKorean('This year favors advance with fire energy.')).toBe(false)
  })

  it('disqualifies brands that leak machine codes', () => {
    const runs = [
      {
        brand: 'Leak',
        run: 1,
        narrative: 'saju.tengods.peer_dominant 때문에 전진하세요.',
        one_line: '전진',
        direction: 'advance',
        focus: 'work',
        axis_emphasis: ['drive'],
        contentTokens: 100,
        ms: 1000,
        costUsd: 0.001,
        parsed: true,
      },
      {
        brand: 'Leak',
        run: 2,
        narrative: '비견으로 협력하세요.',
        one_line: '협력',
        direction: 'hold',
        focus: 'work',
        axis_emphasis: ['drive'],
        contentTokens: 80,
        ms: 900,
        costUsd: 0.001,
        parsed: true,
      },
    ]
    const score = scoreBrand('Leak', runs, SAMPLE_PAYLOAD)
    expect(score.disqualified).toBe(true)
    expect(score.machineCodeLeaks.length).toBeGreaterThan(0)
    expect(score.tieHandled).toBe(false)
  })
})
