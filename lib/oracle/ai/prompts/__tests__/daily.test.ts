import { describe, expect, it } from 'vitest'
import { DAILY_NARRATIVE_TARGET } from '../../parse-layer1'
import { buildDailySystemPrompt, buildDailyUserPrompt, DAILY_PROMPT_VERSION } from '../daily'

describe('daily prompts', () => {
  it('asks for one 300–450 weave and forbids a panel, question, and axis scores', () => {
    expect(DAILY_PROMPT_VERSION).toBe('daily-v1')
    const prompt = buildDailySystemPrompt('ko')
    expect(prompt).toContain(`aim ${DAILY_NARRATIVE_TARGET}`)
    expect(prompt).toContain('ONE short piece')
    expect(prompt).toContain('사주 일진')
    expect(prompt).toContain('Ziwei 유일 is NOT in the payload')
    expect(prompt).toContain('NEVER print a raw numeric score')
    expect(prompt).not.toContain('seer')
    const user = buildDailyUserPrompt({ kind: 'daily' }, 'ko')
    expect(user).toContain('One weave, not five mini-readings')
  })
})
