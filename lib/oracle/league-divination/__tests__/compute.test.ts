import { describe, expect, it } from 'vitest'
import { computeLeagueDivination } from '../compute'
import { leagueDrawSeed } from '../seed'
import { ichingDraw, runeDraw, tarotDraw } from '../../engines/draw'
import { LEAGUE_RUNE_COUNT, LEAGUE_TAROT_PICKS, LEAGUE_TAROT_SPREAD } from '../conventions'

const INPUT = {
  roundId: 'round-fixture-1',
  firstViewIso: '2026-09-19T08:52:00.000Z',
  categoryId: 'stocks' as const,
  axis: 'direction' as const,
}

describe('computeLeagueDivination', () => {
  it('is deterministic for the same roundId + firstViewIso', () => {
    const a = computeLeagueDivination(INPUT)
    const b = computeLeagueDivination(INPUT)
    expect(a).toEqual(b)
    expect(a.aggregate.vote === 'up' || a.aggregate.vote === 'down').toBe(true)
    expect(a.aggregate.confidence).toBeGreaterThanOrEqual(0)
    expect(a.aggregate.confidence).toBeLessThanOrEqual(1)
  })

  it('seeds draws as roundId:firstViewIso:system', () => {
    const result = computeLeagueDivination(INPUT)
    expect(result.charts.iching.draw.seed).toBe(leagueDrawSeed(INPUT.roundId, INPUT.firstViewIso, 'iching'))
    expect(result.charts.tarot.seed).toBe(leagueDrawSeed(INPUT.roundId, INPUT.firstViewIso, 'tarot'))
    expect(result.charts.runes.seed).toBe(leagueDrawSeed(INPUT.roundId, INPUT.firstViewIso, 'runes'))
    expect(result.charts.tarot).toEqual(
      tarotDraw({
        seed: result.charts.tarot.seed,
        spread: LEAGUE_TAROT_SPREAD,
        pickedPositions: [...LEAGUE_TAROT_PICKS],
      }),
    )
    expect(result.charts.runes).toEqual(
      runeDraw({ seed: result.charts.runes.seed, count: LEAGUE_RUNE_COUNT }),
    )
    expect(result.charts.iching.draw.primary).toEqual(
      ichingDraw({ seed: result.charts.iching.draw.seed }).primary,
    )
  })

  it('gives astro and 구성 no ballot and reports the chart-pack reasons', () => {
    const result = computeLeagueDivination(INPUT)
    expect(result.charts.astro.ballot).toBeNull()
    expect(result.charts.astro.reason).toBe('horary_judgment_not_implemented')
    expect(result.charts.astro.chart.timeKnown).toBe(true)
    expect(result.charts.astro.chart.angles).not.toBeNull()
    expect(result.charts.astro.location).toEqual({ lat: 37.5665, lng: 126.978, tz: 'Asia/Seoul' })
    expect(result.charts.ninestar.ballot).toBeNull()
    expect(result.charts.ninestar.reason).toBe('five_yellow_and_auspicious_direction_not_implemented')
    expect(result.charts.ninestar.result.day.number).toBeGreaterThanOrEqual(1)
    expect(result.charts.ninestar.result.day.number).toBeLessThanOrEqual(9)
    expect(result.charts.taeil.label).toBe('택일')
    expect(result.votes.taeil.system).toBe('taeil')
  })

  it('pick_one emits only a/b', () => {
    const result = computeLeagueDivination({ ...INPUT, axis: 'pick_one', categoryId: 'sports' })
    expect(result.aggregate.vote === 'a' || result.aggregate.vote === 'b').toBe(true)
    for (const item of Object.values(result.votes)) {
      expect(item.vote === 'a' || item.vote === 'b').toBe(true)
    }
  })
})
