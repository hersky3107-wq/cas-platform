/**
 * Product-rule 결번: hold → 말을 아킴, never inherit 육효.
 * Tarot reads Outcome only; runes read Future only.
 */
import { describe, expect, it } from 'vitest'
import { fourPillars } from '../../engines/calendar'
import type { RuneDrawn, TarotDrawnCard } from '../../engines/draw'
import { voteRuneFuture, voteTaeil, voteTarotOutcome } from '../votes'
import { taeilYongshenForCategory } from '../category-tables'
import { LEAGUE_UNREADABLE } from '../status'

function outcome(partial: Partial<TarotDrawnCard> & Pick<TarotDrawnCard, 'name' | 'arcana' | 'number'>): TarotDrawnCard {
  return {
    id: partial.id ?? 0,
    suit: partial.suit ?? null,
    reversed: partial.reversed ?? false,
    positionLabel: 'Outcome',
    pickedPosition: 5,
    ...partial,
  }
}

function future(partial: Partial<RuneDrawn> & Pick<RuneDrawn, 'name'>): RuneDrawn {
  return {
    id: partial.id ?? 0,
    transliteration: partial.transliteration ?? '',
    glyph: partial.glyph ?? '',
    reversed: partial.reversed ?? false,
    positionLabel: 'Future',
    pickedPosition: 3,
    ...partial,
  }
}

describe('타로 Outcome only + reversal (product polarity)', () => {
  it('Death (release) upright → down; reversed flips to up', () => {
    expect(voteTarotOutcome([outcome({ name: 'Death', arcana: 'major', number: 13 })], 'direction').vote).toBe('down')
    expect(
      voteTarotOutcome([outcome({ name: 'Death', arcana: 'major', number: 13, reversed: true })], 'direction').vote,
    ).toBe('up')
  })

  it('does not average the other four cards', () => {
    const cards: TarotDrawnCard[] = [
      { ...outcome({ name: 'The Sun', arcana: 'major', number: 19 }), positionLabel: 'Situation', pickedPosition: 1 },
      { ...outcome({ name: 'The Sun', arcana: 'major', number: 19 }), positionLabel: 'Obstacle', pickedPosition: 2 },
      { ...outcome({ name: 'The Sun', arcana: 'major', number: 19 }), positionLabel: 'Advice', pickedPosition: 3 },
      { ...outcome({ name: 'The Sun', arcana: 'major', number: 19 }), positionLabel: 'External', pickedPosition: 4 },
      outcome({ name: 'Death', arcana: 'major', number: 13 }),
    ]
    expect(voteTarotOutcome(cards, 'direction').vote).toBe('down')
  })

  it('hold is 결번 — does not inherit 육효', () => {
    const vote = voteTarotOutcome([outcome({ name: 'The Hanged Man', arcana: 'major', number: 12 })], 'direction')
    expect(vote.vote).toBeNull()
    expect(vote.abstained).toBe(true)
    expect(vote.unreadableCode).toBe(LEAGUE_UNREADABLE.tarot)
  })

  it('reversed hold still 결번 (hold has no opposite among three axes)', () => {
    const vote = voteTarotOutcome(
      [outcome({ name: 'The Hanged Man', arcana: 'major', number: 12, reversed: true })],
      'pick_one',
    )
    expect(vote.vote).toBeNull()
    expect(vote.abstained).toBe(true)
  })

  it('minor rank 7 (release) → down; Ace (advance) → up', () => {
    expect(
      voteTarotOutcome([outcome({ name: 'Seven of Wands', arcana: 'minor', number: 7, suit: 'wands' })], 'direction')
        .vote,
    ).toBe('down')
    expect(
      voteTarotOutcome([outcome({ name: 'Ace of Cups', arcana: 'minor', number: 1, suit: 'cups' })], 'direction').vote,
    ).toBe('up')
  })
})

describe('룬 Future only + reversal', () => {
  it('Fehu (advance) upright → up; reversed → down', () => {
    expect(voteRuneFuture([future({ name: 'Fehu' })], 'direction').vote).toBe('up')
    expect(voteRuneFuture([future({ name: 'Fehu', reversed: true })], 'direction').vote).toBe('down')
  })

  it('Thurisaz hold is 결번 — does not inherit 육효', () => {
    const vote = voteRuneFuture([future({ name: 'Thurisaz' })], 'direction')
    expect(vote.vote).toBeNull()
    expect(vote.abstained).toBe(true)
    expect(vote.unreadableCode).toBe(LEAGUE_UNREADABLE.runes)
  })
})

describe('사주 택일 (not 명리)', () => {
  const pillars = fourPillars({ date: '1988-03-15', time: '04:30', timezone: 'Asia/Seoul' })

  it('uses 일진/월건 오행, never 대운, and labels the vote taeil', () => {
    expect(pillars.day.branch.element).toBe('fire')
    expect(pillars.month.branch.element).toBe('wood')
    const stocks = voteTaeil(pillars, taeilYongshenForCategory('stocks'), 'direction')
    expect(stocks.system).toBe('taeil')
    expect(stocks.camp).toBe('timing')
    // 巳火 and 卯木 both 극 金 → down
    expect(stocks.vote).toBe('down')
    expect(stocks.abstained).toBe(false)
  })

  it('yinYang names the 천간 bucket and does not change the 오행 ballot', () => {
    const sports = voteTaeil(pillars, taeilYongshenForCategory('sports'), 'direction')
    const entertainment = voteTaeil(pillars, taeilYongshenForCategory('entertainment'), 'direction')
    expect(taeilYongshenForCategory('sports').yinYang).not.toBe(taeilYongshenForCategory('entertainment').yinYang)
    expect(sports.vote).toBe(entertainment.vote)
    expect(sports.vote).toBe('up')
  })

  it('일진 vs 월건 split is 결번 — does not inherit 육효', () => {
    const vote = voteTaeil(pillars, taeilYongshenForCategory('crypto'), 'direction')
    // 火 vs 水 = 극, 木 vs 水 = 생 → split
    expect(vote.abstained).toBe(true)
    expect(vote.vote).toBeNull()
    expect(vote.unreadableCode).toBe(LEAGUE_UNREADABLE.taeil)
  })
})
