import { describe, expect, it } from 'vitest'
import { ORACLE_SEER_PERSONAS } from '../../seer-roster'
import { buildVerdictSystemPrompt, buildVerdictUserPrompt } from '../verdict'

describe('verdict prompts', () => {
  it('injects each persona decision rule verbatim, never a tone description', () => {
    for (const persona of ORACLE_SEER_PERSONAS) {
      const prompt = buildVerdictSystemPrompt('ko', persona.slug, 9)
      expect(prompt).toContain(persona.decisionRule)
    }
  })

  it('carries panel size, per-count line budget, and the ballot schema', () => {
    const three = buildVerdictSystemPrompt('ko', 'reader', 3)
    const nine = buildVerdictSystemPrompt('ko', 'reader', 9)
    expect(three).toContain('panel of 3')
    expect(three).toContain('max 400 characters')
    expect(nine).toContain('panel of 9')
    expect(nine).toContain('max 80 characters')
    for (const key of ['verdict_line', 'direction', 'focus', 'domains', 'minority_opinion']) {
      expect(three).toContain(key)
    }
    expect(three).toContain('"advance" | "hold" | "release"')
    expect(three).toContain('"work" | "money" | "love" | "social" | "energy"')
  })

  it('states that tallying happens in code — the seer never aggregates', () => {
    const prompt = buildVerdictSystemPrompt('ko', 'seer', 5)
    expect(prompt).toContain('counted in code')
    expect(prompt).toMatch(/never speak for the panel/i)
  })

  it('bans internal engine vocabulary and model/brand mentions', () => {
    const prompt = buildVerdictSystemPrompt('ko', 'guide', 3)
    expect(prompt).toContain('코어 매트릭스')
    expect(prompt).toMatch(/Never mention AI, models, brands/i)
  })

  it('user prompt carries the question when present and says so when absent', () => {
    const withQuestion = buildVerdictUserPrompt(
      { reader: { slug: 'reader', index: 1, of: 3 }, context: { asOfDate: '2026-09-05', question: '이직해도 될까?' } },
      'ko',
    )
    expect(withQuestion).toContain('이직해도 될까?')
    const without = buildVerdictUserPrompt(
      { reader: { slug: 'reader', index: 1, of: 3 }, context: { asOfDate: '2026-09-05', question: null } },
      'ko',
    )
    expect(without).toContain('No question was submitted')
    expect(without).toContain('Korean')
  })
})
