import { describe, expect, it, vi } from 'vitest'
import { createFakeCredits } from '../../runner/__tests__/fakes'
import { ORACLE_TALISMAN_CREDITS_MODULE, TALISMAN_PRICE } from '../../runner/conventions'
import {
  purchaseTalismanUnlock,
  type TalismanPurchasePort,
  type TalismanPurchaseRow,
  type TalismanSourcePort,
} from '../purchase'
import {
  canDownloadTalismanFormat,
  unlockedTalismanFormats,
  type TalismanBuyPurpose,
} from '../entitlement'

function fakeSource(sessionId: string | null): TalismanSourcePort {
  return {
    async load() {
      return sessionId ? { sessionId } : null
    },
  }
}

function fakePurchases(seed: TalismanPurchaseRow[] = []): TalismanPurchasePort & {
  rows: TalismanPurchaseRow[]
  forceDuplicate: boolean
} {
  const port = {
    rows: [...seed],
    forceDuplicate: false,
    async find(userId: string, sessionId: string, purpose: TalismanBuyPurpose) {
      return port.rows.find(
        (row) => row.user_id === userId && row.session_id === sessionId && row.purpose === purpose,
      ) ?? null
    },
    async insert(row: TalismanPurchaseRow) {
      if (port.forceDuplicate) return 'duplicate' as const
      if (await port.find(row.user_id, row.session_id, row.purpose)) return 'duplicate' as const
      port.rows.push(row)
      return 'inserted' as const
    },
    async list(userId: string, sessionId: string) {
      return port.rows.filter((row) => row.user_id === userId && row.session_id === sessionId)
    },
  }
  return port
}

describe('talisman purchase charge', () => {
  it('deducts before unlocking and is idempotent on retry', async () => {
    const credits = createFakeCredits(20)
    const purchases = fakePurchases()
    const first = await purchaseTalismanUnlock(
      { credits, purchases, source: fakeSource('sess') },
      { userId: 'u1', sessionId: 'sess', purpose: 'deficiency' },
    )
    expect(first).toMatchObject({ ok: true, alreadyOwned: false, charged: TALISMAN_PRICE.deficiency })
    expect(credits.charges).toEqual([
      { userId: 'u1', amount: TALISMAN_PRICE.deficiency, module: ORACLE_TALISMAN_CREDITS_MODULE },
    ])
    expect(purchases.rows).toHaveLength(1)
    expect(credits.balance).toBe(14)

    const retry = await purchaseTalismanUnlock(
      { credits, purchases, source: fakeSource('sess') },
      { userId: 'u1', sessionId: 'sess', purpose: 'deficiency' },
    )
    expect(retry).toMatchObject({ ok: true, alreadyOwned: true, charged: 0 })
    expect(credits.charges).toHaveLength(1)
    expect(credits.balance).toBe(14)
  })

  it('treats a UNIQUE collision as a free re-download and refunds the extra charge', async () => {
    const credits = createFakeCredits(20)
    const purchases = fakePurchases()
    purchases.forceDuplicate = true
    const result = await purchaseTalismanUnlock(
      { credits, purchases, source: fakeSource('sess') },
      { userId: 'u1', purpose: 'wealth' },
    )
    expect(result).toMatchObject({ ok: true, alreadyOwned: true, charged: 0 })
    expect(credits.charges).toHaveLength(1)
    expect(credits.refunds).toEqual([{ userId: 'u1', amount: TALISMAN_PRICE.purpose }])
    expect(credits.balance).toBe(20)
  })

  it('free phone writes no row; paying 6 then unlocks all 4 and charges once', async () => {
    const credits = createFakeCredits(20)
    const purchases = fakePurchases()
    expect(
      canDownloadTalismanFormat({
        purchased: false,
        purpose: 'deficiency',
        format: 'phone',
        isFirstIntegratedSession: true,
      }),
    ).toBe(true)
    expect(purchases.rows).toHaveLength(0)

    const paid = await purchaseTalismanUnlock(
      { credits, purchases, source: fakeSource('sess') },
      { userId: 'u1', sessionId: 'sess', purpose: 'deficiency' },
    )
    expect(paid).toMatchObject({ ok: true, alreadyOwned: false, charged: TALISMAN_PRICE.deficiency })
    expect(credits.charges).toEqual([
      { userId: 'u1', amount: TALISMAN_PRICE.deficiency, module: ORACLE_TALISMAN_CREDITS_MODULE },
    ])
    expect(credits.balance).toBe(14)
    expect(purchases.rows).toHaveLength(1)
    expect(
      unlockedTalismanFormats({
        purchased: true,
        purpose: 'deficiency',
        isFirstIntegratedSession: true,
      }),
    ).toEqual([
      'phone',
      'wallet',
      'square',
      'desktop',
    ])

    const again = await purchaseTalismanUnlock(
      { credits, purchases, source: fakeSource('sess') },
      { userId: 'u1', sessionId: 'sess', purpose: 'deficiency' },
    )
    expect(again).toMatchObject({ ok: true, alreadyOwned: true, charged: 0 })
    expect(credits.charges).toHaveLength(1)
    expect(credits.refunds).toEqual([])
  })

  it('logs and keeps the unlock if a race-refund fails', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    const credits = createFakeCredits(20)
    credits.refund = async () => {
      throw new Error('refund down')
    }
    const purchases = fakePurchases()
    purchases.forceDuplicate = true
    const result = await purchaseTalismanUnlock(
      { credits, purchases, source: fakeSource('sess') },
      { userId: 'u1', sessionId: 'sess', purpose: 'wealth' },
    )
    expect(result).toMatchObject({ ok: true, alreadyOwned: true, charged: 0 })
    expect(logged).toHaveBeenCalled()
    const args = logged.mock.calls[0] ?? []
    expect(JSON.stringify(args)).toMatch(/u1/)
    expect(JSON.stringify(args)).toMatch(/sess/)
    expect(JSON.stringify(args)).toMatch(String(TALISMAN_PRICE.purpose))
    logged.mockRestore()
  })

  it('does not charge when there is no integrated reading or the wallet is empty', async () => {
    const credits = createFakeCredits(20)
    const none = await purchaseTalismanUnlock(
      { credits, purchases: fakePurchases(), source: fakeSource(null) },
      { userId: 'u1', purpose: 'deficiency' },
    )
    expect(none).toEqual({ ok: false, reason: 'no-reading', balance: null })
    expect(credits.charges).toEqual([])

    credits.failWith = 'insufficient'
    const unpaid = await purchaseTalismanUnlock(
      { credits, purchases: fakePurchases(), source: fakeSource('sess') },
      { userId: 'u1', purpose: 'love' },
    )
    expect(unpaid).toMatchObject({ ok: false, reason: 'insufficient' })
    expect(credits.charges).toEqual([])
  })
})
