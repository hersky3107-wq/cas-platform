import { describe, expect, it } from 'vitest'
import { buildLabelledReasons, labelForReasonCode } from '../reason-labels'

describe('reason-labels', () => {
  it('maps saju peer_dominant to 비견 in ko', () => {
    expect(labelForReasonCode('saju.tengods.peer_dominant', 'ko')).toBe('비견')
  })

  it('builds parallel reasons + labels for locale', () => {
    const labelled = buildLabelledReasons(
      {
        traits: ['saju.tengods.peer_dominant'],
        elements: ['saju.elements.four_pillars'],
        phase: ['saju.phase.daewoon_sewoon'],
      },
      'ko',
    )
    expect(labelled.reasons.traits).toEqual(['saju.tengods.peer_dominant'])
    expect(labelled.labels.traits).toEqual(['비견'])
    expect(labelled.labels.elements).toEqual(['사주 네 기둥'])
    expect(labelled.labels.phase).toEqual(['대운·세운'])
  })

  it('labels tarot reason codes in human terms, not mapping jargon', () => {
    expect(labelForReasonCode('tarot.traits.arcana_and_suit', 'ko')).toBe('메이저·수트')
    expect(labelForReasonCode('tarot.elements.suit_to_classical_to_oheng', 'ko')).toBe('카드의 기운')
    expect(labelForReasonCode('tarot.traits.reversals_reflected', 'ko')).toBe('뒤집힌 카드')
    expect(labelForReasonCode('prism.traits.core_matrix', 'ko')).toBe('성향의 결')
    expect(labelForReasonCode('prism.cycle.command', 'ko')).toBe('결단')
  })
})
