import { describe, expect, it } from 'vitest'
import {
  parseSynthesisJson,
  SYNTHESIS_AGREEMENT_MAX,
  SYNTHESIS_CONCLUSION_MAX,
  SYNTHESIS_LIST_MAX,
} from '../parse-synthesis'
import { buildSynthesisSystemPrompt } from '../prompts/synthesis'

describe('synthesis contract', () => {
  it('requires the exact four-field value types', () => {
    expect(
      parseSynthesisJson(
        JSON.stringify({
          agreements: ['one'],
          divergences: [],
          conclusion: 'conclusion',
          confidence_note: null,
        }),
      ),
    ).toEqual({
      agreements: ['one'],
      divergences: [],
      conclusion: 'conclusion',
      confidence_note: null,
    })
    expect(parseSynthesisJson('{"agreements":[],"divergences":[],"conclusion":3,"confidence_note":null}')).toBeNull()
  })

  it('enforces list and character budgets after parsing', () => {
    const parsed = parseSynthesisJson(
      JSON.stringify({
        agreements: Array.from({ length: 20 }, () => 'a'.repeat(500)),
        divergences: [],
        conclusion: 'c'.repeat(2_000),
        confidence_note: null,
      }),
    )!
    expect(parsed.agreements).toHaveLength(SYNTHESIS_LIST_MAX)
    expect(parsed.agreements[0]).toHaveLength(SYNTHESIS_AGREEMENT_MAX)
    expect(parsed.conclusion).toHaveLength(SYNTHESIS_CONCLUSION_MAX)
  })

  it('pins JSON-only, no-working, no-machine-code prompt discipline', () => {
    const prompt = buildSynthesisSystemPrompt('ko')
    expect(prompt).toContain('exactly one JSON object')
    expect(prompt).toContain('no preamble')
    expect(prompt).toContain('visible working')
    expect(prompt).toContain('machine codes')
    expect(prompt).toContain('do not simulate reader dialogue')
  })
})
