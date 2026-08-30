/**
 * 대사기 — per-channel settlement rules.
 *
 * A rule is DATA (fee + settlement window + tolerances). The parser and the
 * reconcile engine both take a rule as input so new channels are added by
 * defining a rule, not by branching logic.
 *
 * STAGE 1: only 'transfer' was wired. STAGE 2 adds 'app_voucher' (탐나는전 앱,
 * 온누리 앱) the same way. STAGE 2c adds 'card' (PG/card-company family:
 * card, 바코드결제, 알리페이/위챗, 텍스프리, 배달앱) — still a ChannelRule,
 * no new matcher branching. Cash (channel_type='cash') is a ChannelRule with
 * expectsDeposit: false: it is stored as revenue and skipped by every
 * deposit matcher. Fee rate and settlement window stay DATA.
 *
 * A real per-channel override always wins over these defaults: `ruleFromRow`
 * only falls back to the map below when no `reconciliation_rules` row exists
 * for that channel (or it isn't effective yet) — see reconcile.ts's
 * `ruleForChannel`. Settlement window is therefore "configurable" in the
 * sense the task asked for: add a `reconciliation_rules` row via the existing
 * generic `POST /api/reconciliation/rules` to change it per user/channel
 * without touching this file.
 */

import type { FeeType } from '@/lib/reconciliation/types'

export type ChannelRule = {
  channelType: string
  feeType: FeeType
  /** percent (e.g. 2.5) when feeType='percent'; won amount when 'fixed'. */
  feeRate: number
  /** expected days from sale to deposit (0 = same day). */
  settlementDays: number
  /** won discrepancy tolerated before a match is flagged. */
  toleranceWon: number
  /** date discrepancy (days) tolerated before a match is flagged. */
  toleranceDays: number
  /**
   * When false, this channel never produces a bank deposit (cash).
   * Omitted / true = deposits are expected (transfer, card, app_voucher).
   */
  expectsDeposit?: boolean
}

/** Bank transfer: no fee, same-day, exact. The simplest possible rule. */
export const TRANSFER_RULE: ChannelRule = {
  channelType: 'transfer',
  feeType: 'percent',
  feeRate: 0,
  settlementDays: 0,
  toleranceWon: 0,
  toleranceDays: 0,
}

/**
 * App/barcode local voucher (탐나는전 앱, 온누리 앱): the merchant reads a
 * barcode/QR and the voucher operator deposits the FULL face value straight
 * to the bank account on its own schedule — zero fee, same shape as a
 * transfer. Card-type local vouchers are NOT this rule: they ride inside a
 * normal card settlement and are out of scope here (sale_kind='card').
 */
export const APP_VOUCHER_RULE: ChannelRule = {
  channelType: 'app_voucher',
  feeType: 'percent',
  feeRate: 0,
  settlementDays: 0,
  toleranceWon: 0,
  toleranceDays: 0,
}

/**
 * Card-type family (channel_type='card'): card, 바코드결제, 알리페이/위챗,
 * 텍스프리, 배달앱. One family because they all deduct a percent fee and
 * settle NET, batched, days later via a PG/card company. Per-merchant rates
 * differ — override via a reconciliation_rules row; this default is only
 * the placeholder used when no row exists yet.
 */
export const CARD_RULE: ChannelRule = {
  channelType: 'card',
  feeType: 'percent',
  feeRate: 2.5,
  settlementDays: 2,
  toleranceWon: 1,
  toleranceDays: 0,
}

/**
 * Cash: recorded as revenue, never deposited to the bank. feeRate 0.
 * Matchers must skip these sales (no missing_deposit). expected_net = gross;
 * expected_deposit_date stays null — do not call expectedDepositDate().
 */
export const CASH_RULE: ChannelRule = {
  channelType: 'cash',
  feeType: 'percent',
  feeRate: 0,
  settlementDays: 0,
  toleranceWon: 0,
  toleranceDays: 0,
  expectsDeposit: false,
}

/** channel_type → rule. transfer / app_voucher / card / cash. */
const RULES_BY_CHANNEL_TYPE: Record<string, ChannelRule> = {
  transfer: TRANSFER_RULE,
  app_voucher: APP_VOUCHER_RULE,
  card: CARD_RULE,
  cash: CASH_RULE,
}

/** False only for cash (expectsDeposit: false). Everyone else expects a deposit. */
export function channelExpectsDeposit(rule: ChannelRule): boolean {
  return rule.expectsDeposit !== false
}

export function ruleForChannelType(channelType: string): ChannelRule | null {
  return RULES_BY_CHANNEL_TYPE[channelType] ?? null
}

/** Net amount expected to arrive after the channel's fee. */
export function expectedNet(gross: number, rule: ChannelRule): number {
  const fee = rule.feeType === 'percent' ? (gross * rule.feeRate) / 100 : rule.feeRate
  const net = gross - fee
  return Math.round(net * 100) / 100
}

/** Date (YYYY-MM-DD) the deposit is expected, given the sale date + settlement window. */
export function expectedDepositDate(saleDate: string, rule: ChannelRule): string {
  if (rule.settlementDays === 0) return saleDate
  const d = new Date(`${saleDate}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + rule.settlementDays)
  return d.toISOString().slice(0, 10)
}

/** Build a ChannelRule from a stored reconciliation_rules row (falls back to defaults). */
export function ruleFromRow(row: {
  fee_type?: string | null
  fee_rate?: number | null
  settlement_days?: number | null
  tolerance_won?: number | null
  tolerance_days?: number | null
} | null, channelType: string): ChannelRule {
  const base = ruleForChannelType(channelType) ?? TRANSFER_RULE
  if (!row) return base
  const feeType = (row.fee_type as FeeType) ?? base.feeType
  return {
    channelType,
    feeType,
    feeRate: row.fee_rate ?? base.feeRate,
    settlementDays: row.settlement_days ?? base.settlementDays,
    toleranceWon: row.tolerance_won ?? base.toleranceWon,
    toleranceDays: row.tolerance_days ?? base.toleranceDays,
    expectsDeposit: base.expectsDeposit,
  }
}
