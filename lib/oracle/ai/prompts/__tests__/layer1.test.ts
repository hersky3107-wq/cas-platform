import { describe, expect, it } from 'vitest'
import { buildLayer1SystemPrompt, buildLayer1UserPrompt } from '../layer1'

describe('layer1 prompts', () => {
  it('keeps the shared schema budget for non-prism systems', () => {
    const prompt = buildLayer1SystemPrompt('ko', 'saju')
    expect(prompt).toContain('max 500 characters')
    expect(prompt).not.toContain('Claude-specific length lock')
  })

  it('forbids machine codes in narrative and requires phase-tie reporting', () => {
    const prompt = buildLayer1SystemPrompt('ko', 'saju')
    expect(prompt).toContain('Never print machine codes in narrative or one_line')
    expect(prompt).toContain('report the tie as a tie')
  })

  it('adds Claude-specific length lock only for prism', () => {
    const system = buildLayer1SystemPrompt('ko', 'prism')
    const user = buildLayer1UserPrompt({ system: 'prism' }, 'ko', 'prism')
    expect(system).toContain('Claude-specific length lock')
    expect(system).toContain('280–420 characters')
    expect(user).toContain('narrative ≤500 characters')
  })
})
