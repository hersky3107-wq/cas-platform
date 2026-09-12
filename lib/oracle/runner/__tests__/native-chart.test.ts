import { describe, expect, it } from 'vitest'
import { buildLiuyao, tarotDraw } from '../../engines/draw'
import { buildNativeChart } from '../native-chart'
import type { JsonObject } from '../types'

describe('buildNativeChart', () => {
  it('maps a five-card tarot draw to Korean names, positions, and orientation', () => {
    const draw = tarotDraw({
      seed: 'native-tarot',
      spread: 5,
      pickedPositions: [14, 3, 71, 8, 22],
    })
    const chart = buildNativeChart('tarot', { draw } as JsonObject, {
      locale: 'ko',
      nominalAge: 39,
    })
    const cards = chart.카드 as Array<{ 카드: string; 위치: string; 방향: string; 구분: string; 수트: string }>
    expect(cards).toHaveLength(5)
    expect(cards.map((card) => card.위치)).toEqual(['상황', '방해', '조언', '외부', '결과'])
    const death = draw.cards.find((card) => card.name === 'Death')
    if (death) {
      const mapped = cards[draw.cards.indexOf(death)]!
      expect(mapped.카드).toBe('죽음')
      expect(mapped.구분).toBe('메이저')
    }
    const hermit = draw.cards.find((card) => card.name === 'The Hermit')
    if (hermit) {
      const mapped = cards[draw.cards.indexOf(hermit)]!
      expect(mapped.카드).toBe('은둔자')
    }
    expect(JSON.stringify(chart)).not.toContain('pickedPosition')
    expect(JSON.stringify(chart)).not.toContain('"name"')
    expect(JSON.stringify(chart)).not.toContain('traits')
  })

  it('renders 육효 왕쇠 and 복장 in Korean, never raw engine codes', () => {
    const draw = buildLiuyao({
      seed: 'native-iching',
      values: [8, 7, 7, 7, 7, 7],
      monthElement: 'fire',
      dayElement: 'water',
    })
    const chart = buildNativeChart('iching', { draw } as JsonObject, { locale: 'ko', nominalAge: 39 })
    expect(chart.복장).toEqual(['처재'])
    expect(chart.월령오행).toBe('화')
    expect(chart.일진오행).toBe('수')
    const lines = chart.효 as Array<{ 월령: string; 일건: string; 육친: string; 동효생극: string[] }>
    expect(lines).toHaveLength(6)
    expect(lines.every((line) => line.월령.includes('('))).toBe(true)
    expect(lines.some((line) => line.일건 === '비화' || line.일건.includes('생') || line.일건.includes('극'))).toBe(
      true,
    )
    const blob = JSON.stringify(chart)
    expect(blob).not.toContain('monthPhase')
    expect(blob).not.toContain('hiddenRelatives')
    expect(blob).not.toContain('dayRelation')
    expect(blob).not.toContain('"wang"')
    expect(blob).not.toContain('a_generates_b')
    expect(blob).not.toContain('妻财')
  })
})
