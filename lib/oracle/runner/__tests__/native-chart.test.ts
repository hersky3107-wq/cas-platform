import { describe, expect, it } from 'vitest'
import { nineStar } from '../../engines/calendar'
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

  it('renders 구성 낙서 구궁 with Korean 흉방 and no invented 吉 grade', () => {
    const natal = nineStar({ date: '1951-06-15', time: '12:00', timezone: 'Asia/Seoul' })
    const current = nineStar({ date: '1988-03-15', time: '12:00', timezone: 'Asia/Seoul' })
    const chart = buildNativeChart('ninestar', { natal, current } as unknown as JsonObject, {
      locale: 'ko',
      nominalAge: 39,
    })
    const hyung = chart.흉방 as Record<string, string>
    expect(hyung).toMatchObject({
      오황살: '서',
      암검살: '동',
      본명살: '북서',
      본명적살: '남동',
      세파: '북서',
    })
    expect(chart.길방).toEqual(['남서'])
    const yearGrid = chart.연반 as { 둔: string; 안내: string; 격자: Array<Array<{ 방위: string; 성: string; 흉방: string[]; 본명관계: string }>> }
    expect(yearGrid.둔).toBe('양둔')
    expect(yearGrid.안내).toContain('낙서')
    expect(yearGrid.격자).toHaveLength(3)
    expect(yearGrid.격자.every((row) => row.length === 3)).toBe(true)
    expect(yearGrid.격자[0]!.map((cell) => cell.방위)).toEqual(['남동', '남', '남서'])
    const west = yearGrid.격자[1]![2]!
    expect(west.방위).toBe('서')
    expect(west.성).toBe('오황토성')
    expect(west.흉방).toContain('오황살')
    const blob = JSON.stringify(chart)
    expect(blob).not.toContain('"west"')
    expect(blob).not.toContain('"yang"')
    expect(blob).not.toContain('대길')
    expect(blob).not.toContain('"wood"')
  })
})
