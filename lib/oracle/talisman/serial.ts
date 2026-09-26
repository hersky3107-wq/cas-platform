import { createHash } from 'node:crypto'

/** Fixtures never hash a real session id. */
export const FAKE_TALISMAN_SERIAL = '7f2a19'

type EnvMap = Record<string, string | undefined>

function isDeployEnv(env: EnvMap): boolean {
  return env.NODE_ENV === 'production' || env.VERCEL != null && env.VERCEL !== ''
}

export function talismanSerialSalt(env: EnvMap = process.env): string | null {
  const salt = env.TALISMAN_SERIAL_SALT
  return typeof salt === 'string' && salt.length > 0 ? salt : null
}

/** First 6 hex chars of sha256(session_id + salt). Not reversible. */
export function talismanSerial(sessionId: string, salt: string): string {
  return createHash('sha256').update(`${sessionId}${salt}`, 'utf8').digest('hex').slice(0, 6)
}

export function talismanSerialFromEnv(sessionId: string, env: EnvMap = process.env): string {
  const salt = talismanSerialSalt(env)
  if (!salt) {
    if (isDeployEnv(env)) {
      throw new Error(
        'TALISMAN_SERIAL_SALT is required in production and on Vercel. Set it once and do not rotate — rotating changes every talisman serial.',
      )
    }
    return FAKE_TALISMAN_SERIAL
  }
  return talismanSerial(sessionId, salt)
}
