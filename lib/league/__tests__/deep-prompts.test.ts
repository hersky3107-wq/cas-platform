import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  LEAGUE_DEEP_DEBATE_ROSTER,
  LEAGUE_DEEP_DISCLAIMER,
  LEAGUE_DEEP_OPEN_ROSTER,
  fallbackDebateRoles,
  fallbackOpenRoles,
  leagueAnalystSystemPrompt,
  leagueChairSystemPrompt,
  leagueDebateOrchestratorSystemPrompt,
  leagueOpenOrchestratorSystemPrompt,
  leaguePreReportSystemPrompt,
  leagueSynthesisSystemPrompt,
  leagueVoteSystemPrompt,
} from '../deep-prompts'
import { runWithOutputLanguage } from '../deep-output-language'

const AX_PERSONA_MARKERS = [
  '자원·에너지 정책 보좌',
  '자원·에너지 안보 정책 심의',
  'gatherJejuSnapshot',
  'councilMode',
  'warroom',
  'You are the final chair of a national resource',
]

const LEAGUE_DEEP_FILES = [
  'deep-prompts.ts',
  'deep-open-engine.ts',
  'deep-debate-engine.ts',
  'deep-open-run.ts',
  'deep-debate-run.ts',
  'deep-context.ts',
  'deep-advance.ts',
  'deep-http.ts',
  'deep-open-replacement.ts',
  'deep-debate-replacement.ts',
  'deep-model.ts',
  'deep-deepseek.ts',
  'deep-types.ts',
  'deep-output-language.ts',
]

describe('league-local deep prompts', () => {
  it('uses a private analyst roster with no exaone seat', () => {
    expect(LEAGUE_DEEP_OPEN_ROSTER).toHaveLength(8)
    expect(LEAGUE_DEEP_DEBATE_ROSTER).toHaveLength(8)
    expect(LEAGUE_DEEP_OPEN_ROSTER).toContain('glm-5.2')
    expect(LEAGUE_DEEP_OPEN_ROSTER).not.toContain('exaone')
    expect(LEAGUE_DEEP_DEBATE_ROSTER).not.toContain('exaone')
    expect(fallbackOpenRoles()).toHaveLength(8)
    expect(fallbackDebateRoles()).toHaveLength(8)
  })

  it('keeps commentary disclaimer and forbids AX ministry framing in prompt builders', () => {
    const blobs = [
      LEAGUE_DEEP_DISCLAIMER,
      leagueAnalystSystemPrompt('Price-path analyst', 'read the packet'),
      leagueOpenOrchestratorSystemPrompt(),
      leagueDebateOrchestratorSystemPrompt(),
      leaguePreReportSystemPrompt(),
      leagueSynthesisSystemPrompt(),
      leagueVoteSystemPrompt(),
      leagueChairSystemPrompt(),
    ].join('\n')
    expect(blobs).toContain('unscored commentary')
    for (const marker of AX_PERSONA_MARKERS) {
      expect(blobs).not.toContain(marker)
    }
    expect(blobs).not.toMatch(/You are a (national|government|ministry)/i)
    expect(blobs).toMatch(/Do not cite or request/)
    expect(blobs).toMatch(/Never assign seats named after governments/)
    expect(blobs).toContain('## Key findings')
    expect(blobs).toContain('## Evidence from the packets')
  })

  it('severs motie/jeju/gunpo imports from the league deep path', () => {
    const here = dirname(fileURLToPath(import.meta.url))
    const root = join(here, '..')
    for (const file of LEAGUE_DEEP_FILES) {
      const src = readFileSync(join(root, file), 'utf8')
      expect(src, file).not.toMatch(/@\/lib\/motie/)
      expect(src, file).not.toMatch(/@\/lib\/jeju/)
      expect(src, file).not.toMatch(/@\/lib\/gunpo/)
      expect(src, file).not.toMatch(/from '\.\.\/motie/)
    }
  })

  it('asks Korean sessions for 핵심 발견 / 패킷 근거, not English section chrome', async () => {
    const prompt = await runWithOutputLanguage('ko', async () =>
      leagueAnalystSystemPrompt('Price-path analyst', 'read the packet')
    )
    expect(prompt).toContain('## 핵심 발견')
    expect(prompt).toContain('## 패킷 근거')
    expect(prompt).not.toContain('## Key findings')
    expect(prompt).not.toContain('## Evidence from the packets')
  })
})
