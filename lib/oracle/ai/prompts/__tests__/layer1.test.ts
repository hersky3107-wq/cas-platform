import { describe, expect, it } from 'vitest'
import { LAYER1_PROMPT_VERSION, buildLayer1SystemPrompt, buildLayer1UserPrompt } from '../layer1'
import { LAYER1_NARRATIVE_TARGET } from '../../parse-layer1'

describe('layer1 prompts (v4)', () => {
  it('is the v4 prompt: native-only, no axes variant', () => {
    expect(LAYER1_PROMPT_VERSION).toBe('layer1-v4')
    // The signature takes no readingInput any more — one code path.
    expect(buildLayer1SystemPrompt.length).toBeLessThanOrEqual(2)
  })

  it('demands the 700–1100 budget and forbids raw scores in prose (FIX 3)', () => {
    const prompt = buildLayer1SystemPrompt('ko', 'saju')
    expect(prompt).toContain(`aim ${LAYER1_NARRATIVE_TARGET}`)
    expect(prompt).toContain('NEVER print a raw numeric score')
    expect(prompt).toContain('Write for someone who knows NOTHING')
    expect(prompt).toContain('END with what to actually do or watch for')
    expect(prompt).not.toContain('connect at least THREE payload values')
    expect(prompt).not.toContain('max 500 characters')
  })

  it('keeps the internal-vocabulary ban', () => {
    const prompt = buildLayer1SystemPrompt('ko', 'saju')
    expect(prompt).toContain('Never name our internal engine layers')
    expect(prompt).toContain('코어 매트릭스')
  })

  it('gives tarot its no-오행, name-every-card rule', () => {
    const prompt = buildLayer1SystemPrompt('ko', 'tarot')
    expect(prompt).toContain('name every card')
    expect(prompt).toContain('Tarot has no 오행')
    const user = buildLayer1UserPrompt({ system: 'tarot' }, 'ko', 'tarot')
    expect(user).toContain('name the cards')
  })

  it('astro rule pins planets-vs-elements; sukuyou bans 명성 vocabulary (FIX 5c)', () => {
    expect(buildLayer1SystemPrompt('ko', 'astro')).toContain('never call a planet an element')
    expect(buildLayer1SystemPrompt('ko', 'sukuyou')).toContain('never call them 명성')
  })

  it('adds the Claude length lock only for prism, rescaled to the v4 budget', () => {
    const system = buildLayer1SystemPrompt('ko', 'prism')
    const user = buildLayer1UserPrompt({ system: 'prism' }, 'ko', 'prism')
    expect(system).toContain('PRISM / length lock (mandatory)')
    expect(system).toContain(`Target narrative length: ${LAYER1_NARRATIVE_TARGET}`)
    expect(user).toContain('Emit JSON only')
    expect(buildLayer1SystemPrompt('ko', 'saju')).not.toContain('length lock')
  })
})
