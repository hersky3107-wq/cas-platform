import { describe, expect, it } from 'vitest'
import { isThirdPartyPredictionClaim, omitThirdPartyPredictionText } from '../research-merge'
import { formatMultiSourceSection, mergeResearchFindings, type RawResearchFinding } from '../research-merge'
import { runMultiSourceResearch, type ResearchProviderCaller } from '../research-providers'

const SCOREBASE = [
  'scorebase의 47% 추정치',
  '47% 예측치',
  'scorebase win probability 47%',
  'Best tip: home win. Odds 1.90',
  '오늘의 픽은 원정 승',
  '배당 1.85',
  '승률 추정 47%',
]

describe('third-party prediction filter', () => {
  it('drops scorebase tips and odds, and keeps a lineup fact', () => {
    for (const sample of SCOREBASE) {
      expect(isThirdPartyPredictionClaim(sample), sample).toBe(true)
      expect(omitThirdPartyPredictionText(sample, 'sports')).toBe(true)
      expect(omitThirdPartyPredictionText(sample, 'politics_election')).toBe(true)
      expect(omitThirdPartyPredictionText(sample, 'entertainment')).toBe(true)
    }
    const lineup = 'Ulsan named a full-strength lineup; the first-choice goalkeeper is fit.'
    const injury = '광주FC 주전 수비수가 햄스트링 부상으로 결장한다.'
    expect(isThirdPartyPredictionClaim(lineup)).toBe(false)
    expect(isThirdPartyPredictionClaim(injury)).toBe(false)
    expect(omitThirdPartyPredictionText(SCOREBASE[0]!, 'tech')).toBe(false)
  })

  it('keeps a scorebase claim out of the official multi-source packet', async () => {
    const caller: ResearchProviderCaller = async () => ({
      costUsd: 0.01,
      findings: [
        {
          provider: 'perplexity',
          claim: 'scorebase의 47% 추정치',
          date: '2026-10-05',
          url: 'https://scorebase.example/ulsan',
          side: 'neutral',
          rumor: false,
        },
        {
          provider: 'perplexity',
          claim: 'Ulsan have won 3 of their last 5 league matches.',
          date: '2026-10-04',
          url: 'https://kleague.com/match',
          side: 'neutral',
          rumor: false,
        },
      ] satisfies RawResearchFinding[],
    })
    const result = await runMultiSourceResearch({
      queries: ['Ulsan form'],
      proposition: 'Will Ulsan win?',
      instrument: 'MATCH:soccer_korea_kleague1:1:away:1:Gwangju%20FC:Ulsan%20Hyundai%20FC',
      deadline: '2026-10-11T08:00:00.000Z',
      configured: ['perplexity'],
      costCapUsd: 1,
      caller,
      category: 'sports',
    })
    const section = result.section
    expect(section).not.toMatch(/scorebase|47%|예측|추정/)
    expect(section).toContain('won 3 of their last 5')
    expect(result.merged.facts.map((f) => f.claim).join('\n')).not.toMatch(/scorebase/)
    const unfiltered = formatMultiSourceSection({
      merged: mergeResearchFindings([
        {
          provider: 'perplexity',
          claim: 'scorebase의 47% 추정치',
          date: null,
          url: null,
          side: 'neutral',
          rumor: false,
        },
      ]),
      log: result.log,
    })
    expect(unfiltered).toContain('scorebase')
  })
})
