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

  it('labels tarot reason codes', () => {
    expect(labelForReasonCode('tarot.traits.arcana_and_suit', 'ko')).toBe('아르카나·수트')
  })
})
