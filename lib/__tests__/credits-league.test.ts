import { describe, expect, it } from 'vitest'
import {
  LEAGUE_DEBATE_CREDITS,
  LEAGUE_GENERATE_CREDITS,
  LEAGUE_OPEN_CREDITS,
  creditsForLeagueDebate,
  creditsForLeagueGenerate,
  creditsForLeagueOpen,
} from '../credits'

describe('league / governance credit constants', () => {
  it('pins the confirmed open-analysis and debate prices', () => {
    expect(LEAGUE_OPEN_CREDITS).toBe(50)
    expect(LEAGUE_DEBATE_CREDITS).toBe(70)
    expect(creditsForLeagueOpen()).toBe(50)
    expect(creditsForLeagueDebate()).toBe(70)
  })

  it('pins the confirmed live-generation price', () => {
    expect(LEAGUE_GENERATE_CREDITS).toBe(7)
    expect(creditsForLeagueGenerate()).toBe(7)
  })
})
