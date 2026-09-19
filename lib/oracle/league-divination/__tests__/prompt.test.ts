import { describe, expect, it } from 'vitest'
import { compactReaderPack } from '../compact-pack'
import { computeLeagueDivination } from '../compute'
import { buildLeagueReaderSystemPrompt, buildLeagueReaderUserPrompt } from '../prompt'

describe('league reader prompt', () => {
  it('forbids 결번 / voter-roll wording and does not send the roll to the model', () => {
    const computed = computeLeagueDivination({
      roundId: 'prompt-quiet',
      firstViewIso: '2026-09-19T08:52:00.000Z',
      categoryId: 'stocks',
      axis: 'direction',
    })
    const pack = compactReaderPack(computed, { proposition: 'q', subjectName: 's' })
    const system = buildLeagueReaderSystemPrompt()
    const user = buildLeagueReaderUserPrompt(pack)
    expect(system).toMatch(/never mention 결번/)
    expect(user).not.toMatch(/voterRoll|votedCount|ichingAlone|결번|말을 아낌|표를 냄/)
    expect(user).not.toContain('"abstained"')
    expect(user).toContain('CODE VERDICT')
    expect(user).toContain(pack.tarot.outcomeKo)
  })
})
