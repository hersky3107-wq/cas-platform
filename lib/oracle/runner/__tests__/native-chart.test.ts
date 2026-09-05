import { describe, expect, it } from 'vitest'
import { tarotDraw } from '../../engines/draw'
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
})
