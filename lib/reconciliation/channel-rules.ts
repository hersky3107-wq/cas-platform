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
 * no new matcher branching. Cash and paper_voucher are ChannelRules with
 * expectsDeposit: false: stored as revenue and skipped by every deposit
 * matcher. Paper voucher is not same-day complete: expected_deposit_date
 * stays null because the settlement clock starts when the owner banks the
 * slips, which the system cannot know. There is no reconcilePaperVouchers()
 * — a sale-date matcher would false-flag missing_deposit.
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
   * When false, automatic matchers skip this channel. Cash never produces a
   * bank deposit. Paper voucher is banked later on a date the system cannot
   * know. Omitted / true = deposits are expected (transfer, card, app_voucher).
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

/**
 * Paper gift voucher (지류상품권): 0-fee. expected_net = gross.
 * expected_deposit_date stays null — the owner banks the slips later
 * (온누리 same day after deposit, 탐나는전 2–3 days). A sale-date matcher
 * cannot pair that, so expectsDeposit is false and there is no
 * reconcilePaperVouchers().
 */
export const PAPER_VOUCHER_RULE: ChannelRule = {
  channelType: 'paper_voucher',
  feeType: 'percent',
  feeRate: 0,
  settlementDays: 0,
  toleranceWon: 0,
  toleranceDays: 0,
  expectsDeposit: false,
}

/**
 * A named channel preset the user can pick when creating a channel
 * (POST /api/reconciliation/channels with `preset`). DATA ONLY: every preset
 * maps to a channel_type that ALREADY has an engine — delivery apps and
 * foreign pay are card-type (부류 B: fee withheld, PG deposits net after N
 * days), so they ride reconcile-card unchanged. Picking a preset seeds one
 * reconciliation_rules row with these defaults; from then on the rule is a
 * normal per-channel row the user adjusts like any card rule.
 */
export type ChannelPreset = {
  /** Stable pick id (accepted by POST /channels as `preset`). */
  id: string
  /** Default payment_channels.name — overridable at creation. */
  name: string
  /** Must be a key of RULES_BY_CHANNEL_TYPE — presets never add engines. */
  channelType: string
  feeType: FeeType
  feeRate: number
  settlementDays: number
  toleranceWon: number
  toleranceDays: number
  /** Stored on the seeded rule row — tells the user why the default is rough. */
  notes: string
}

/**
 * Delivery apps: the "fee" here is 중개+결제+배달비+광고비 combined
 * (~25-30%) and the real deduction VARIES per settlement (promotions, ad
 * spend). The default below is deliberately a rough midpoint — frequent
 * amount_mismatch is EXPECTED and correct: the multi-AI advisory explains
 * the gap the rule can't model. Do not encode per-promotion deductions as
 * rules. Settlement is weekly-batched, roughly D+3 from sale.
 *
 * Foreign pay (알리페이/위챗페이): normal PG-style percent fee, rough
 * placeholder rate — actual MDR comes from the merchant's PG contract,
 * settlement ~D+2. Adjust via the seeded rule row.
 */
export const CHANNEL_PRESETS: readonly ChannelPreset[] = [
  {
    id: 'baemin',
    name: '배달의민족',
    channelType: 'card',
    feeType: 'percent',
    feeRate: 27.5,
    settlementDays: 3,
    toleranceWon: 1,
    toleranceDays: 0,
    notes:
      '배달앱 프리셋(rough): 중개+결제+배달비+광고비 합산 ~25-30%, 주 단위 배치 정산 ~D+3. 실제 공제는 정산마다 달라 amount_mismatch가 자주 뜨는 것이 정상 — AI 어드바이저리가 차액을 설명. 실제 계약 조건으로 수정하세요.',
  },
  {
    id: 'coupang_eats',
    name: '쿠팡이츠',
    channelType: 'card',
    feeType: 'percent',
    feeRate: 27.5,
    settlementDays: 3,
    toleranceWon: 1,
    toleranceDays: 0,
    notes:
      '배달앱 프리셋(rough): 중개+결제+배달비+광고비 합산 ~25-30%, 주 단위 배치 정산 ~D+3. 실제 공제는 정산마다 달라 amount_mismatch가 자주 뜨는 것이 정상 — AI 어드바이저리가 차액을 설명. 실제 계약 조건으로 수정하세요.',
  },
  {
    id: 'alipay',
    name: '알리페이',
    channelType: 'card',
    feeType: 'percent',
    feeRate: 3,
    settlementDays: 2,
    toleranceWon: 1,
    toleranceDays: 0,
    notes:
      '해외간편결제 프리셋(rough): 수수료 ~3%는 자리표시자 — PG 계약 요율로 수정하세요. 정산 ~D+2.',
  },
  {
    id: 'wechat_pay',
    name: '위챗페이',
    channelType: 'card',
    feeType: 'percent',
    feeRate: 3,
    settlementDays: 2,
    toleranceWon: 1,
    toleranceDays: 0,
    notes:
      '해외간편결제 프리셋(rough): 수수료 ~3%는 자리표시자 — PG 계약 요율로 수정하세요. 정산 ~D+2.',
  },
]

export function channelPresetById(id: string): ChannelPreset | null {
  return CHANNEL_PRESETS.find((p) => p.id === id) ?? null
}

/** channel_type → rule. transfer / app_voucher / card / cash / paper_voucher. */
const RULES_BY_CHANNEL_TYPE: Record<string, ChannelRule> = {
  transfer: TRANSFER_RULE,
  app_voucher: APP_VOUCHER_RULE,
  card: CARD_RULE,
  cash: CASH_RULE,
  paper_voucher: PAPER_VOUCHER_RULE,
}

/** False for cash and paper_voucher (expectsDeposit: false). Everyone else expects a deposit. */
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
