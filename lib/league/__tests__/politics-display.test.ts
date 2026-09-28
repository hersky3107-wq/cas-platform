import { describe, expect, it } from 'vitest'
import { encodePoliticsInstrument } from '../gateway/adapters/politics-catalog'
import {
  electionHeadlineLabel,
  formatElectionPropositionLocalized,
  politicsPropositionDisplay,
  raceTitleEn,
} from '../politics-display'

const BOTTOMS = encodePoliticsInstrument({
  jurisdiction: 'US',
  office: 'governor',
  cycle: '2026',
  district: 'GA',
  candidate: 'Keisha Lance Bottoms',
  pollCloseMs: 1793746800000,
})

describe('politics display', () => {
  it('formats ELECTION headline in Korean with decoded candidate name', () => {
    const label = electionHeadlineLabel(BOTTOMS, 'ko')
    expect(label).toBe('2026 미국 조지아 주지사 · Keisha Lance Bottoms 당선')
    expect(label).not.toContain('ELECTION:')
    expect(label).not.toContain('%20')
  })

  it('formats ELECTION headline in English', () => {
    const label = electionHeadlineLabel(BOTTOMS, 'en')
    expect(label).toBe('2026 US Georgia Governor · Keisha Lance Bottoms elected')
  })

  it('localizes proposition and recovers when stored text is the raw instrument', () => {
    const prop = formatElectionPropositionLocalized(
      {
        jurisdiction: 'US',
        office: 'governor',
        cycle: '2026',
        district: 'GA',
        candidate: 'Keisha Lance Bottoms',
        pollCloseMs: 1793746800000,
      },
      'ko',
    )
    expect(prop).toBe('2026 미국 조지아 주지사 Keisha Lance Bottoms 당선')

    expect(politicsPropositionDisplay(BOTTOMS, BOTTOMS, 'ko')).toBe(prop)
    expect(politicsPropositionDisplay(BOTTOMS, 'ignored', 'en')).toMatch(/Will Keisha Lance Bottoms be elected/)
  })

  it('raceTitleEn names US house districts', () => {
    expect(
      raceTitleEn({ jurisdiction: 'US', office: 'house', cycle: '2026', district: 'GA-07' }),
    ).toBe('2026 US Georgia 7th District House')
  })
})
