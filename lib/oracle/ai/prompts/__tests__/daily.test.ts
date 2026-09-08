import { describe, expect, it } from 'vitest'
import {
  DAILY_NARRATIVE_PROMPT_MAX,
  DAILY_NARRATIVE_PROMPT_MIN,
  DAILY_NARRATIVE_TARGET,
} from '../../parse-layer1'
import { buildDailySystemPrompt, buildDailyUserPrompt, DAILY_PROMPT_VERSION } from '../daily'

describe('daily prompts', () => {
  it('puts the 300–450 budget in the JSON schema and never advertises the parser slack', () => {
    expect(DAILY_PROMPT_VERSION).toBe('daily-v3')
    const prompt = buildDailySystemPrompt('ko')
    expect(prompt).toContain(`"narrative": string,  // ONE woven reading; ${DAILY_NARRATIVE_TARGET} Unicode characters (hard)`)
    expect(prompt).toContain(`Count characters in the final narrative string. If it would exceed ${DAILY_NARRATIVE_PROMPT_MAX}`)
    expect(prompt).toContain('Schema (character budgets are hard limits):')
    expect(prompt).toContain('ONE short piece')
    expect(prompt).toContain('사주 일진')
    expect(prompt).toContain('Ziwei 유일 is NOT in the payload')
    expect(prompt).toContain('NEVER print a raw numeric score')
    expect(prompt).toContain('CHART FIDELITY (mandatory):')
    expect(prompt).toContain('ninestar.오늘.일')
    expect(prompt).toContain('saju.팔자.일주')
    expect(prompt).toContain('astro.오늘')
    expect(prompt).not.toContain('seer')
    expect(prompt).not.toContain(`${DAILY_NARRATIVE_PROMPT_MIN - 20}–${DAILY_NARRATIVE_PROMPT_MAX + 30}`)
    expect(prompt).not.toContain('280–480')
    const user = buildDailyUserPrompt({ kind: 'daily' }, 'ko')
    expect(user).toContain('One weave, not five mini-readings')
    expect(user).toContain(DAILY_NARRATIVE_TARGET)
    expect(user).not.toContain('280–480')
    expect(DAILY_NARRATIVE_PROMPT_MIN).toBe(300)
    expect(DAILY_NARRATIVE_PROMPT_MAX).toBe(450)
  })
})
