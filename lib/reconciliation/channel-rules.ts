/**
 * 대사기 — per-channel settlement rules.
 *
 * A rule is DATA (fee + settlement window + tolerances). The parser and the
 * reconcile engine both take a rule as input so new channels are added by
 * defining a rule, not by branching logic.
 *
 * STAGE 1: only 'transfer' is wired. Card / delivery / voucher are intentionally
 * absent — adding them later means adding a ChannelRule, nothing else.
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

/** channel_type → rule. Only 'transfer' exists in Stage 1. */
const RULES_BY_CHANNEL_TYPE: Record<string, ChannelRule> = {
  transfer: TRANSFER_RULE,
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
  }
}
