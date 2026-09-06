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

import { percent, toFraction, ZERO_FEE, type FractionRate } from '@/lib/reconciliation/fees'
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
  /**
   * WINDOW width for the Step-2 planner: deposits are accepted in
   * [sale_date, sale_date + settlementDays + toleranceDays]. (Historically
   * "date discrepancy tolerated"; the retired single-date matcher never read
   * it, the window planner does. Stored reconciliation_rules.tolerance_days
   * rows flow through ruleFromRow the same way.)
   */
  toleranceDays: number
  /**
   * When false, automatic matchers skip this channel. Cash never produces a
   * bank deposit. Paper voucher is banked later on a date the system cannot
   * know. Omitted / true = deposits are expected (card, app_voucher, …).
   */
  expectsDeposit?: boolean
}

/**
 * Bank transfer: no fee, same-day, exact.
 *
 * ★RETIRED FROM RECONCILIATION (Step 2, per the store owner's spec):
 * transfer is 정산 전용 (settlement-only). The unified engine excludes it by
 * DATA — payment_method_defs.is_reconciled=false — so transfer sales never
 * produce missing_deposit and transfer-hinted deposits are never matched.
 * The rule object stays because createSale still uses it for expected-net
 * bookkeeping and sale_kind defaulting; expectsDeposit is deliberately NOT
 * flipped to false here (that would silently re-default transfer sales to
 * sale_kind='cash' in createSale and corrupt monthly summaries).
 */
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
  // The operator pays out on its own schedule; face-value exact matching is
  // safe, so the window is generous rather than same-day.
  toleranceDays: 5,
  toleranceWon: 0,
}

/**
 * Legacy lumped-card rule (channel_type='card' rows NOT yet attributed to a
 * card_issuers issuer). The Step-2 engine matches card money PER ISSUER with
 * the issuer's FRACTION fee (card_issuers.fee_rate wins over any percent
 * rule); this rule remains only as the fallback for issuer-less legacy card
 * sales. 2.5% is a placeholder — the measured real-world small-merchant rate
 * was ~0.149%.
 */
export const CARD_RULE: ChannelRule = {
  channelType: 'card',
  feeType: 'percent',
  feeRate: 2.5,
  settlementDays: 2,
  toleranceWon: 1,
  toleranceDays: 3,
}

/**
 * Delivery apps (배민/쿠팡이츠…), now a first-class channel_type
 * (retyped from 'card' by the Step-2 migration). The "fee" is 중개+결제+
 * 배달비+광고비 combined and VARIES per settlement — deterministic exact
 * matches are rare and that is fine: unresolved delivery deposits flow to
 * the AI match-inference queue instead. Weekly batches → wide window.
 */
export const DELIVERY_APP_RULE: ChannelRule = {
  channelType: 'delivery_app',
  feeType: 'percent',
  feeRate: 27.5,
  settlementDays: 3,
  toleranceWon: 1,
  toleranceDays: 7,
}

/** Alipay/WeChat via PG (retyped from 'card'). Placeholder MDR — user-editable rule. */
export const FOREIGN_PAY_RULE: ChannelRule = {
  channelType: 'foreign_pay',
  feeType: 'percent',
  feeRate: 3,
  settlementDays: 2,
  toleranceWon: 1,
  toleranceDays: 3,
}

/**
 * Barcode pay (제로페이류): typically 0-fee, ~D+1. ★Route warning (defs
 * notes): barcode money may arrive via a card issuer OR as a direct
 * transfer under its own name — never assume one route.
 */
export const BARCODE_PAY_RULE: ChannelRule = {
  channelType: 'barcode_pay',
  feeType: 'percent',
  feeRate: 0,
  settlementDays: 1,
  toleranceWon: 0,
  toleranceDays: 3,
}

/** Tax-free (card portion). Placeholder rate; adjust from the operator contract. */
export const TAX_FREE_RULE: ChannelRule = {
  channelType: 'tax_free',
  feeType: 'percent',
  feeRate: 1.5,
  settlementDays: 3,
  toleranceWon: 1,
  toleranceDays: 4,
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
 * maps to a channel_type in RULES_BY_CHANNEL_TYPE (and payment_method_defs).
 * Since Step 2, delivery apps are channel_type='delivery_app' and Alipay/
 * WeChat are 'foreign_pay' — first-class reconciled methods, no longer lumped
 * under 'card'. (Channels created before the retype migration keep 'card'
 * until the Step-2 SQL updates them.) Picking a preset seeds one
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
    channelType: 'delivery_app',
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
    channelType: 'delivery_app',
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
    channelType: 'foreign_pay',
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
    channelType: 'foreign_pay',
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

/** channel_type → rule, one per payment_method_defs code. */
const RULES_BY_CHANNEL_TYPE: Record<string, ChannelRule> = {
  transfer: TRANSFER_RULE,
  app_voucher: APP_VOUCHER_RULE,
  card: CARD_RULE,
  delivery_app: DELIVERY_APP_RULE,
  foreign_pay: FOREIGN_PAY_RULE,
  barcode_pay: BARCODE_PAY_RULE,
  tax_free: TAX_FREE_RULE,
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

/**
 * Percent-unit ChannelRule fee → branded FractionRate, through the one
 * sanctioned converter (fees.ts). The Step-2 planner accepts ONLY fractions;
 * this is the single place a channel rule's percent number becomes one.
 * Corrupt rows (negative / ≥100) yield ZERO_FEE rather than a guess.
 */
export function channelFeeFraction(rule: ChannelRule): FractionRate {
  if (rule.feeType !== 'percent' || rule.feeRate === 0) return ZERO_FEE
  if (rule.feeRate >= 100 || rule.feeRate < 0) return ZERO_FEE
  return toFraction(percent(rule.feeRate))
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
