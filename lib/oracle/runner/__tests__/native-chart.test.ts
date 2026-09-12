import { describe, expect, it } from 'vitest'
import { eokbu, fiveElementBalance, fourPillars, nineStar, tenGods } from '../../engines/calendar'
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

  it('renders 사주 억부 용신 in Korean with 득령/득지/득세, never engine codes', () => {
    const pillars = fourPillars({ date: '1988-03-15', time: '04:30', timezone: 'Asia/Seoul' })
    const chart = buildNativeChart(
      'saju',
      {
        pillars,
        fiveElements: fiveElementBalance(pillars),
        tenGods: tenGods(pillars.day.stem, pillars),
        eokbu: eokbu(pillars),
      } as unknown as JsonObject,
      { locale: 'ko', nominalAge: 39 },
    )
    const yongsin = chart.용신 as {
      강약: string
      용신: string
      희신: string
      기신: string
      요약: string
      판정불가: string
      학교: string
      출처: string
      일간: string
      득령: { 관계: string; 점수: number }
      득지: { 점수: number }
      득세: { 점수: number }
    }
    expect(yongsin.강약).toBe('신약')
    expect(yongsin.용신).toBe('화(火)')
    expect(yongsin.희신).toBe('토(土)')
    expect(yongsin.기신).toBe('수(水)')
    expect(yongsin.요약).toBe('용신 화(火) · 억부법 계산 · 신약 (득령 없음, 득지 0, 득세 2)')
    expect(yongsin.판정불가).toBe('없음')
    expect(yongsin.학교).toBe('억부법')
    expect(yongsin.출처).toBe('억부법 계산')
    expect(yongsin.일간).toContain('己')
    expect(yongsin.득령.관계).toBe('없음')
    const blob = JSON.stringify(chart)
    expect(blob).not.toContain('"weak"')
    expect(blob).not.toContain('"wood"')
    expect(blob).not.toContain('"yongsin"')
    expect(blob).not.toContain('deukryeong')
  })

  it('on 편왕 판정불가 still ships 일간·십신분포·편왕 and asks for AI 판단', () => {
    const pillars = fourPillars({ date: '1984-02-10', time: '04:30', timezone: 'Asia/Seoul' })
    const chart = buildNativeChart(
      'saju',
      {
        pillars,
        fiveElements: fiveElementBalance(pillars),
        tenGods: tenGods(pillars.day.stem, pillars),
        eokbu: eokbu(pillars),
      } as unknown as JsonObject,
      { locale: 'ko', nominalAge: 39 },
    )
    const yongsin = chart.용신 as {
      용신: string
      출처: string
      안내: string
      편왕: { 오행: string; 개수: number; 글자: number } | string
      일간: string
      십신분포: Record<string, number>
    }
    expect(yongsin.용신).toBe('없음')
    expect(yongsin.출처).toBe('AI 판단 요청')
    expect(yongsin.안내).toContain('억부로는 판정되지 않음')
    expect(yongsin.편왕).toMatchObject({ 오행: '목(木)', 개수: 4, 글자: 8 })
    expect(yongsin.일간).toContain('甲')
    expect(Object.keys(yongsin.십신분포).length).toBeGreaterThan(0)
  })
})
