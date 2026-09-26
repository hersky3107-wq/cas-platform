/**
 * Charge then unlock a 부적. Look up the paid row BEFORE charging so a
 * normal re-click never deducts. Deduct happens before the UNIQUE insert.
 * Refund-on-UNIQUE is only for a concurrent race; if that refund fails,
 * log user_id + session_id + amount at error level.
 */
import { ORACLE_TALISMAN_CREDITS_MODULE, TALISMAN_PRICE } from '../runner/conventions'
import type { CreditsPort } from '../runner/types'
import {
  parseTalismanBuyPurpose,
  talismanPriceFor,
  type TalismanBuyPurpose,
} from './entitlement'

export type { TalismanBuyPurpose }

export type TalismanPurchaseRow = {
  user_id: string
  session_id: string
  purpose: TalismanBuyPurpose
  credits_charged: number
}

export type TalismanPurchasePort = {
  find(
    userId: string,
    sessionId: string,
    purpose: TalismanBuyPurpose,
  ): Promise<TalismanPurchaseRow | null>
  insert(row: TalismanPurchaseRow): Promise<'inserted' | 'duplicate'>
  list(userId: string, sessionId: string): Promise<TalismanPurchaseRow[]>
}

export type TalismanSourcePort = {
  load(
    userId: string,
    sessionId?: string | null,
  ): Promise<{ sessionId: string } | null>
}

export type PurchaseTalismanOk = {
  ok: true
  alreadyOwned: boolean
  charged: number
  purpose: TalismanBuyPurpose
  sessionId: string
  balance: number | null
}

export type PurchaseTalismanFailure = {
  ok: false
  reason: 'no-reading' | 'insufficient' | 'error'
  balance: number | null
}

export type PurchaseTalismanResult = PurchaseTalismanOk | PurchaseTalismanFailure

export async function purchaseTalismanUnlock(
  deps: {
    credits: CreditsPort
    purchases: TalismanPurchasePort
    source: TalismanSourcePort
  },
  input: {
    userId: string
    sessionId?: string | null
    purpose?: string | null
  },
): Promise<PurchaseTalismanResult> {
  const purpose = parseTalismanBuyPurpose(input.purpose)
  const source = await deps.source.load(input.userId, input.sessionId)
  if (!source) return { ok: false, reason: 'no-reading', balance: null }

  const existing = await deps.purchases.find(input.userId, source.sessionId, purpose)
  if (existing) {
    return {
      ok: true,
      alreadyOwned: true,
      charged: 0,
      purpose,
      sessionId: source.sessionId,
      balance: null,
    }
  }

  const amount = talismanPriceFor(purpose)
  const charge = await deps.credits.charge(input.userId, amount, ORACLE_TALISMAN_CREDITS_MODULE)
  if (!charge.ok) {
    return {
      ok: false,
      reason: charge.reason === 'insufficient' ? 'insufficient' : 'error',
      balance: charge.balance,
    }
  }

  const charged = charge.skipped ? 0 : amount
  const written = await deps.purchases.insert({
    user_id: input.userId,
    session_id: source.sessionId,
    purpose,
    credits_charged: charged,
  })

  if (written === 'duplicate') {
    // Race only. A normal re-click returns above before charge.
    if (charged > 0) {
      try {
        await deps.credits.refund(input.userId, charged)
      } catch (err) {
        console.error('[talisman] refund after UNIQUE failed', {
          user_id: input.userId,
          session_id: source.sessionId,
          amount: charged,
          err,
        })
      }
    }
    return {
      ok: true,
      alreadyOwned: true,
      charged: 0,
      purpose,
      sessionId: source.sessionId,
      balance: charge.balance,
    }
  }

  return {
    ok: true,
    alreadyOwned: false,
    charged,
    purpose,
    sessionId: source.sessionId,
    balance: charge.balance,
  }
}

export { TALISMAN_PRICE, ORACLE_TALISMAN_CREDITS_MODULE }
