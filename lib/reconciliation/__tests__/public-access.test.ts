import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  isReconPublic,
  isReconciliationPath,
  issueWorkspaceCookieValue,
  parseWorkspaceCookie,
} from '@/lib/reconciliation/public-access'

describe('reconciliation public-access cookie', () => {
  const prevSecret = process.env.RECONCILIATION_PUBLIC_SECRET
  const prevFlag = process.env.RECONCILIATION_PUBLIC

  beforeAll(() => {
    process.env.RECONCILIATION_PUBLIC_SECRET = 'test-hmac-secret-do-not-use'
    process.env.RECONCILIATION_PUBLIC = 'true'
  })

  afterAll(() => {
    process.env.RECONCILIATION_PUBLIC_SECRET = prevSecret
    process.env.RECONCILIATION_PUBLIC = prevFlag
  })

  it('isReconPublic reads the server env flag', () => {
    expect(isReconPublic()).toBe(true)
  })

  it('scopes the path to /reconciliation and its API only', () => {
    expect(isReconciliationPath('/reconciliation')).toBe(true)
    expect(isReconciliationPath('/api/reconciliation/classify')).toBe(true)
    expect(isReconciliationPath('/league')).toBe(false)
    expect(isReconciliationPath('/api/oracle/tarot')).toBe(false)
    expect(isReconciliationPath('/modes/arena')).toBe(false)
  })

  it('round-trips a signed workspace cookie and rejects tampering', async () => {
    const raw = await issueWorkspaceCookieValue()
    expect(raw).toBeTruthy()
    const id = await parseWorkspaceCookie(raw)
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    )
    expect(await parseWorkspaceCookie(`${id}.00000000000000000000000000000000`)).toBeNull()
    expect(await parseWorkspaceCookie('not-a-uuid.abc')).toBeNull()
  })
})
