import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { classifyNoAnswerFailReason } from '../fail-reason'

describe('classifyNoAnswerFailReason', () => {
  it('maps timeout / empty-content / 429 / HTTP classes without storing bodies', () => {
    expect(classifyNoAnswerFailReason({ error: 'gpt-5-search-api timeout after 60000ms' })).toBe('timeout')
    expect(classifyNoAnswerFailReason({ error: 'HTTP 200 but message.content was empty. Raw: {"secret":"nope"}' })).toBe(
      'empty_content',
    )
    expect(classifyNoAnswerFailReason({ error: 'HTTP 429 rate limit' })).toBe('rate_limited')
    expect(classifyNoAnswerFailReason({ error: 'HTTP 401 Unauthorized - sk-abc' })).toBe('http_4xx:401')
    expect(classifyNoAnswerFailReason({ error: 'HTTP 503 Service Unavailable' })).toBe('http_5xx:503')
    expect(classifyNoAnswerFailReason({ parseFailure: 'reasoning_leak' })).toBe('reasoning_leak')
    expect(classifyNoAnswerFailReason({})).toBe('unparseable')
  })
})

describe('qwen3.5-flash thinking off', () => {
  it('WORLD openrouter seat disables thinking via extraRequestParams', () => {
    const src = readFileSync(join(__dirname, '../../../lib/ai/platform-providers.ts'), 'utf8')
    const line = src.split('\n').find((l) => l.includes("id: 'openrouter:qwen3.5-flash'"))
    expect(line).toBeTruthy()
    expect(line).toContain('reasoning: { exclude: true }')
    expect(line).toContain('chat_template_kwargs: { enable_thinking: false }')
    const roster = readFileSync(join(__dirname, '../roster.ts'), 'utf8')
    expect(roster).toContain("platformId: 'openrouter:qwen3.5-flash'")
  })
})
