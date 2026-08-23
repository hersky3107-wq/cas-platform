import { describe, expect, it } from 'vitest'
import { mergeExtraRequestParams } from '@/lib/ai/merge-extra-params'

describe('mergeExtraRequestParams', () => {
  it('deep-merges nested reasoning/provider instead of whole-key replace', () => {
    const merged = mergeExtraRequestParams(
      { reasoning: { effort: 'minimal' }, provider: { order: ['minimax'] } },
      { provider: { allow_fallbacks: true } },
    )
    expect(merged).toEqual({
      reasoning: { effort: 'minimal' },
      provider: { order: ['minimax'], allow_fallbacks: true },
    })
  })

  it('omits a key when the override sets it to null (saju strips catalog reasoning)', () => {
    const merged = mergeExtraRequestParams(
      { reasoning: { effort: 'minimal' }, max_tokens: 1 },
      { reasoning: null, provider: { order: ['deepseek'], allow_fallbacks: true } },
    )
    expect(merged).toEqual({
      max_tokens: 1,
      provider: { order: ['deepseek'], allow_fallbacks: true },
    })
    expect(merged).not.toHaveProperty('reasoning')
  })

  it('treats reasoning.enabled:false as absolute (drops catalog effort)', () => {
    const merged = mergeExtraRequestParams(
      { reasoning: { effort: 'minimal' } },
      { reasoning: { enabled: false } },
    )
    expect(merged).toEqual({ reasoning: { enabled: false } })
  })
})
