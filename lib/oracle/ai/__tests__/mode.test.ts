import { describe, expect, it } from 'vitest'
import { getOracleAiMode } from '../mode'

describe('getOracleAiMode', () => {
  it('lets an explicit flag win', () => {
    expect(getOracleAiMode({ ORACLE_AI_MODE: 'live', NODE_ENV: 'test' })).toBe('live')
    expect(getOracleAiMode({ ORACLE_AI_MODE: 'stub', NODE_ENV: 'production' })).toBe('stub')
  })

  it('defaults tests to stub so unit tests never spend tokens', () => {
    expect(getOracleAiMode({ NODE_ENV: 'test' })).toBe('stub')
    expect(getOracleAiMode({ VITEST: 'true', NODE_ENV: 'development' })).toBe('stub')
  })

  it('defaults npm run dev and production to live when the flag is missing', () => {
    expect(getOracleAiMode({ NODE_ENV: 'development' })).toBe('live')
    expect(getOracleAiMode({ NODE_ENV: 'production' })).toBe('live')
  })
})
