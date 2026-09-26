import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { FAKE_TALISMAN_SERIAL, talismanSerial, talismanSerialFromEnv } from '../serial'

describe('talismanSerial', () => {
  it('takes the first 6 hex chars of sha256(session_id + salt)', () => {
    const expected = createHash('sha256').update('abcSALT', 'utf8').digest('hex').slice(0, 6)
    expect(talismanSerial('abc', 'SALT')).toBe(expected)
    expect(talismanSerial('abc', 'SALT')).toHaveLength(6)
    expect(talismanSerial('abc', 'SALT')).toMatch(/^[0-9a-f]{6}$/)
    expect(talismanSerial('abc', 'SALT')).not.toBe(talismanSerial('abc', 'OTHER'))
    expect(talismanSerial('abc', 'SALT')).not.toBe(talismanSerial('xyz', 'SALT'))
  })

  it('uses the fake serial when the env salt is missing in local dev', () => {
    expect(talismanSerialFromEnv('session', {})).toBe(FAKE_TALISMAN_SERIAL)
    expect(talismanSerialFromEnv('session', { NODE_ENV: 'development' })).toBe(FAKE_TALISMAN_SERIAL)
    expect(talismanSerialFromEnv('session', { TALISMAN_SERIAL_SALT: 'env-salt' })).toBe(
      talismanSerial('session', 'env-salt'),
    )
  })

  it('refuses the fake serial when the salt is missing on Vercel or in production', () => {
    const message =
      'TALISMAN_SERIAL_SALT is required in production and on Vercel. Set it once and do not rotate — rotating changes every talisman serial.'
    expect(() => talismanSerialFromEnv('session', { NODE_ENV: 'production' })).toThrow(message)
    expect(() => talismanSerialFromEnv('session', { VERCEL: '1' })).toThrow(message)
    expect(() => talismanSerialFromEnv('session', { VERCEL: '1', NODE_ENV: 'development' })).toThrow(message)
  })
})
