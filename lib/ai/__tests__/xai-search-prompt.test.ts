import { describe, expect, it } from 'vitest'
import { XAI_NON_SEARCH_LENGTH_SUFFIX, xaiSystemLengthSuffix } from '../xai-search-prompt'

describe('xaiSystemLengthSuffix', () => {
  it('omits the exhaust-tokens directive on search/scout calls', () => {
    expect(xaiSystemLengthSuffix({ searchTool: true })).toBe('')
    expect(xaiSystemLengthSuffix({ searchTool: true })).not.toContain('full available token capacity')
  })

  it('keeps the length directive for non-search Grok seats', () => {
    expect(xaiSystemLengthSuffix({ searchTool: false })).toBe(XAI_NON_SEARCH_LENGTH_SUFFIX)
    expect(xaiSystemLengthSuffix({})).toBe(XAI_NON_SEARCH_LENGTH_SUFFIX)
    expect(XAI_NON_SEARCH_LENGTH_SUFFIX).toContain('A short response is a failure')
  })
})
