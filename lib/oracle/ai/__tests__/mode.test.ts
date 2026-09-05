import { describe, expect, it } from 'vitest'
import { getOracleAiMode } from '../mode'

describe('getOracleAiMode', () => {
  it('lets an explicit live flag win', () => {
    expect(getOracleAiMode({ ORACLE_AI_MODE: 'live', NODE_ENV: 'test' })).toBe('live')
  })

  it('defaults to stub when the flag is missing or not live', () => {
    expect(getOracleAiMode({ NODE_ENV: 'development' })).toBe('stub')
    expect(getOracleAiMode({ NODE_ENV: 'production' })).toBe('stub')
    expect(getOracleAiMode({ NODE_ENV: 'test' })).toBe('stub')
    expect(getOracleAiMode({ ORACLE_AI_MODE: 'stub', NODE_ENV: 'production' })).toBe('stub')
  })
})
