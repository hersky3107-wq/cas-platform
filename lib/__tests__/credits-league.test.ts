import { describe, expect, it } from 'vitest'
import {
  LEAGUE_ARCHIVE_CREDITS,
  LEAGUE_DEEP_DEBATE_CREDITS,
  LEAGUE_DEEP_OPEN_CREDITS,
  LEAGUE_GENERATE_CREDITS,
  creditsForLeagueArchive,
  creditsForLeagueDeepDebate,
  creditsForLeagueDeepOpen,
  creditsForLeagueGenerate,
} from '../credits'

describe('league credit constants (single module)', () => {
  it('pins deep-analysis prices — do not change these without an owner decision', () => {
    expect(LEAGUE_DEEP_OPEN_CREDITS).toBe(50)
    expect(LEAGUE_DEEP_DEBATE_CREDITS).toBe(70)
    expect(creditsForLeagueDeepOpen()).toBe(50)
    expect(creditsForLeagueDeepDebate()).toBe(70)
  })

  it('pins the confirmed live-generation price', () => {
    expect(LEAGUE_GENERATE_CREDITS).toBe(7)
    expect(creditsForLeagueGenerate()).toBe(7)
  })

  it('pins the deep-archive price', () => {
    expect(LEAGUE_ARCHIVE_CREDITS).toBe(3)
    expect(creditsForLeagueArchive()).toBe(3)
  })
})
