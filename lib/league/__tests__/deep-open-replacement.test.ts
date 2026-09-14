import { describe, expect, it } from 'vitest'
import {
  isLeagueOpenReplacementSeat,
  LEAGUE_DEAD_OPEN_PROVIDER,
  LEAGUE_OPEN_REPLACEMENT_PLATFORM_ID,
  LEAGUE_OPEN_REPLACEMENT_PROVIDER,
  LEAGUE_VOTE_BRAND_LABEL,
  LEAGUE_VOTE_PANEL,
  remapOpenPlanExaone,
} from '../deep-open-replacement-policy'

describe('league deep-open EXAONE replacement', () => {
  it('remaps every exaone seat to glm-5.2 and leaves other brands alone', () => {
    const plan = {
      ok: true,
      question: 'q',
      rationale: '',
      primaryAngleId: 'primary',
      searchNeeded: false,
      roles: [
        { roleId: 'a', roleLabel: 'A', mandate: '', subQuestion: '', provider: 'openai', isDoubledAngle: false },
        { roleId: 'b', roleLabel: 'B', mandate: '', subQuestion: '', provider: 'exaone', isDoubledAngle: false },
        { roleId: 'c', roleLabel: 'C', mandate: '', subQuestion: '', provider: 'solar', isDoubledAngle: false },
      ],
    }

    const remapped = remapOpenPlanExaone(plan)
    expect(remapped.roles.map((r) => r.provider)).toEqual(['openai', 'glm-5.2', 'solar'])
    expect(isLeagueOpenReplacementSeat(LEAGUE_DEAD_OPEN_PROVIDER)).toBe(true)
    expect(isLeagueOpenReplacementSeat(LEAGUE_OPEN_REPLACEMENT_PROVIDER)).toBe(true)
    expect(isLeagueOpenReplacementSeat('deepseek')).toBe(false)
    expect(LEAGUE_OPEN_REPLACEMENT_PLATFORM_ID).toBe('openrouter:glm-5.2')
  })

  it('remaps a debate-shaped plan the same way (exaone seat only)', () => {
    const plan = {
      ok: true,
      question: 'q',
      rationale: '',
      roles: [
        { roleId: 'a', roleLabel: 'A', mandate: '', provider: 'openai', isRedTeam: false },
        { roleId: 'b', roleLabel: 'B', mandate: '', provider: 'exaone', isRedTeam: true },
        { roleId: 'c', roleLabel: 'C', mandate: '', provider: 'solar', isRedTeam: false },
      ],
    }
    expect(remapOpenPlanExaone(plan).roles.map((r) => r.provider)).toEqual(['openai', 'glm-5.2', 'solar'])
  })

  it('configures league vote panel without exaone and with glm-5.2', () => {
    expect(LEAGUE_VOTE_PANEL).toContain('glm-5.2')
    expect(LEAGUE_VOTE_PANEL).not.toContain('exaone')
    expect(LEAGUE_VOTE_PANEL).toHaveLength(9)
    expect(LEAGUE_VOTE_BRAND_LABEL['glm-5.2']).toBe('GLM')
  })
})
