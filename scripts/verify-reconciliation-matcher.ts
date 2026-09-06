/**
 * Unit tests for the Step-2 WINDOW reconciliation planner + fee units +
 * parser regex fallbacks.
 *
 * DB-FREE: everything below calls a pure function with plain in-memory
 * fixtures. No supabaseAdmin, no network, no server-only side effects.
 *
 *   - planWindowReconciliations() (lib/reconciliation/plan-issuer.ts) is the
 *     pure decision core of the unified deterministic engine
 *     (lib/reconciliation/reconcile.ts runUnifiedReconcile): per-issuer /
 *     per-method WINDOW matching, FRACTION fees, refund netting, and the
 *     deterministic-only statuses (matched / expired missing_deposit / aged
 *     unmatched_deposit — everything else stays open for AI proposals).
 *   - fees.ts is the unit-confusion guard: fraction() rejects percent-style
 *     values, toFraction() is the one sanctioned converter.
 *   - The fixtures below include the REAL store data from the spec:
 *     2026-09-01 sales NH 31,500 / 하나 94,500 settling 09-03 / 09-02 at
 *     ~0.15%, and late-August 신한/삼성 money landing 09-02.
 *   - TRANSFER RETIREMENT: transfer/cash/paper_voucher have no planner group
 *     — rows carrying a groupless key are ignored entirely (settlement-only).
 *   - Parser fallbacks + duplicate flags + monthly summary tests unchanged.
 *
 * Run:
 *   npx tsx --env-file=.env.local --import ./scripts/stubs/register-server-only.mjs scripts/verify-reconciliation-matcher.ts
 * (the stub is required because parser.ts `import 'server-only'`,
 * which Next.js aliases away in its own bundler but a plain tsx process can't
 * resolve on its own — see scripts/stubs/register-server-only.mjs. The env
 * file only satisfies supabaseAdmin's module-load construction via the
 * parser import — no test below touches the network or the DB.)
 */

import {
  planWindowReconciliations,
  addDaysIso,
  type GroupRule,
  type WindowDepositInput,
  type WindowSaleInput,
} from '../lib/reconciliation/plan-issuer'
import {
  fraction,
  matchToleranceWon,
  netWon,
  percent,
  toFraction,
} from '../lib/reconciliation/fees'
import {
  channelExpectsDeposit,
  channelFeeFraction,
  CASH_RULE,
  DELIVERY_APP_RULE,
  PAPER_VOUCHER_RULE,
  TRANSFER_RULE,
  CHANNEL_PRESETS,
} from '../lib/reconciliation/channel-rules'
import { matchVoucherType, TRANSFER_PARSE_SPEC, VOUCHER_PARSE_SPEC } from '../lib/reconciliation/parser'
import { annotateDuplicates, normalizeDepositMemo } from '../lib/reconciliation/deposit-duplicates'
import { extractDepositTextRows } from '../lib/reconciliation/deposit-text-rows'
import { computeMonthlySummaryData, getMonthDateRange } from '../lib/reconciliation/summary'

// ── Assertion helpers (matches scripts/verify-fishing-decision.ts) ───────────

let totalCount = 0
let failCount = 0

function assert(condition: boolean, label: string): void {
  totalCount++
  if (condition) {
    console.log(`  ✅ PASS  ${label}`)
  } else {
    console.error(`  ❌ FAIL  ${label}`)
    failCount++
  }
}

function section(title: string, run: () => void): void {
  console.log(`\n══ ${title} ══`)
  const totalBefore = totalCount
  const failBefore = failCount
  run()
  const total = totalCount - totalBefore
  const pass = total - (failCount - failBefore)
  console.log(`\n  ${pass}/${total} passed${failCount > failBefore ? ` — ${failCount - failBefore} FAILED` : ' ✅'}`)
}

// ── Fixture helpers ────────────────────────────────────────────────────────

/** Per-user issuer defaults from the schema seed: 0.15% fraction, T+2, window 3. */
function issuerGroup(key: string, name: string, over?: Partial<GroupRule>): GroupRule {
  return {
    groupKey: key,
    methodCode: 'card',
    issuerId: `id-${key}`,
    label: name,
    fee: fraction(0.0015),
    settlementDays: 2,
    windowDays: 3,
    toleranceWon: 0,
    ...over,
  }
}

function sale(id: string, date: string, gross: number, groupKey: string): WindowSaleInput {
  return { id, sale_date: date, gross_amount: gross, groupKey }
}

function deposit(id: string, date: string, amount: number, groupKey: string): WindowDepositInput {
  return { id, deposit_date: date, actual_amount: amount, groupKey }
}

const rules = (...groups: GroupRule[]): Map<string, GroupRule> =>
  new Map(groups.map((g) => [g.groupKey, g]))

// ── fee units (req. F) ─────────────────────────────────────────────────────

function runFeeUnitTests(): void {
  section('fees.ts — FRACTION vs PERCENT made impossible to confuse', () => {
    assert(fraction(0.0015).value === 0.0015 && fraction(0.0015).unit === 'fraction', 'fraction(0.0015) builds a branded fraction')
    let threw = false
    try {
      fraction(2.5) // percent-style value into the fraction constructor = unit bug
    } catch {
      threw = true
    }
    assert(threw, 'fraction(2.5) THROWS — percent units cannot leak into fraction land')
    assert(toFraction(percent(2.5)).value === 0.025, 'toFraction(percent(2.5)) === 0.025 (the one sanctioned converter)')
    assert(toFraction(fraction(0.0015)).value === 0.0015, 'toFraction(fraction) is identity')

    // Real store data at the measured ~0.15% preferential rate:
    assert(netWon(31500, fraction(0.0015)) === 31453, 'netWon(31,500 @0.15%) === 31,453 (NH deposit, exact)')
    assert(netWon(94500, fraction(0.0015)) === 94358, 'netWon(94,500 @0.15%) === 94,358 (하나 deposit was 94,359 — ₩1 rounding)')
    assert(matchToleranceWon(1) >= 1, 'tolerance absorbs the measured ₩1 rounding gap')
    assert(netWon(-20000, fraction(0.0015)) === -19970, 'refund net is sign-preserving')

    assert(channelFeeFraction(DELIVERY_APP_RULE).value === 0.275, 'channelFeeFraction(배달앱 27.5%) === 0.275 fraction')
    assert(channelFeeFraction(TRANSFER_RULE).value === 0, 'channelFeeFraction(transfer 0%) === 0')
  })
}

// ── the real September data from the spec ──────────────────────────────────

function runRealDataTests(): void {
  section('window planner — REAL 9/1 store data (per-issuer windows)', () => {
    const NH = issuerGroup('issuer:nh', 'NH') // T+2, window 3
    const HANA = issuerGroup('issuer:hana', '하나', { settlementDays: 1 }) // 하나 was T+1 in the sample
    const SHINHAN = issuerGroup('issuer:shinhan', '신한')
    const SAMSUNG = issuerGroup('issuer:samsung', '삼성')

    const sales = [
      sale('s-nh', '2026-09-01', 31500, NH.groupKey),
      sale('s-hana', '2026-09-01', 94500, HANA.groupKey),
      // Late-August 신한 sale whose money lands 09-02 — months are irrelevant:
      sale('s-shinhan', '2026-08-30', 68135, SHINHAN.groupKey),
    ]
    const deposits = [
      deposit('d-hana', '2026-09-02', 94359, HANA.groupKey), // memo 하나90343621
      deposit('d-nh', '2026-09-03', 31453, NH.groupKey), // memo NH15524303
      deposit('d-shinhan', '2026-09-02', 68033, SHINHAN.groupKey), // memo 신한11895817
      deposit('d-samsung', '2026-09-02', 42636, SAMSUNG.groupKey), // 삼성17938696 — sales not entered
    ]

    const { plans, summary } = planWindowReconciliations({
      today: '2026-09-06',
      rulesByGroup: rules(NH, HANA, SHINHAN, SAMSUNG),
      sales,
      deposits,
    })

    const matched = plans.filter((p) => p.status === 'matched')
    assert(matched.length === 3, `NH + 하나 + 신한 all matched (got ${matched.length})`)
    const byDeposit = new Map(matched.map((p) => [p.pairs[0]?.deposit_id, p]))

    const nh = byDeposit.get('d-nh')
    assert(nh?.pairs[0]?.sale_id === 's-nh', 'NH 31,500 (9/1) ↔ 31,453 (9/3): T+2 lands inside the window')
    assert(nh?.discrepancyAmount === 0, 'NH residual 0 (rounding exact)')
    assert(nh?.issuerId === 'id-issuer:nh' && nh?.methodCode === 'card', 'NH plan carries issuer + method for the result row')

    const hana = byDeposit.get('d-hana')
    assert(hana?.pairs[0]?.sale_id === 's-hana', '하나 94,500 (9/1) ↔ 94,359 (9/2): T+1 issuer lag')
    assert(hana?.discrepancyAmount === -1, '하나 residual −1 (₩1 rounding ABSORBED, recorded honestly)')

    const shinhan = byDeposit.get('d-shinhan')
    assert(shinhan?.pairs[0]?.sale_id === 's-shinhan', '신한 8/30 매출 ↔ 9/2 입금: window crosses the month boundary')

    // 삼성 42,636: its late-Aug sales were never entered. Deposit is only 4
    // days old — NOT flagged, left open for the AI/owner. That is the whole
    // deterministic-vs-AI split.
    assert(summary.unmatched_deposit === 0, '삼성 deposit NOT flagged unmatched (too young to condemn)')
    assert(summary.deposits_left_open_for_ai === 1, '삼성 deposit left open → AI inference queue')
    assert(summary.missing_deposit === 0, 'no missing_deposit — every sale matched')

    // Same data but weeks later: now the 삼성 deposit is aged and candidate-free.
    const aged = planWindowReconciliations({
      today: '2026-09-20',
      rulesByGroup: rules(NH, HANA, SHINHAN, SAMSUNG),
      sales,
      deposits,
    })
    assert(
      aged.plans.some((p) => p.status === 'unmatched_deposit' && p.pairs[0]?.deposit_id === 'd-samsung'),
      '삼성 deposit aged 14d+ with zero candidates → unmatched_deposit'
    )
  })
}

// ── refund netting (req. B) ────────────────────────────────────────────────

function runRefundNettingTests(): void {
  section('refund netting — negative sales net inside the batch', () => {
    const HANA = issuerGroup('issuer:hana', '하나', { settlementDays: 1 })
    const sales = [
      sale('s-pos', '2026-09-01', 50000, HANA.groupKey),
      sale('s-ref', '2026-09-01', -20000, HANA.groupKey), // refund, same issuer, same day
    ]
    // Batch deposit = (50,000 − 20,000) × (1 − 0.0015) per-sale-rounded:
    const expected = netWon(50000, fraction(0.0015)) + netWon(-20000, fraction(0.0015)) // 49925 − 19970
    assert(expected === 29955, `netted batch expectation is ₩29,955 (got ${expected})`)

    const { plans, summary } = planWindowReconciliations({
      today: '2026-09-03',
      rulesByGroup: rules(HANA),
      sales,
      deposits: [deposit('d1', '2026-09-02', 29955, HANA.groupKey)],
    })
    assert(plans.length === 1 && plans[0]?.status === 'matched', 'refund-netted day batch → matched')
    assert(plans[0]?.matchKind === 'day_batch', 'match kind is day_batch (1:1 pass defers when a refund is in the window)')
    assert(plans[0]?.pairs.length === 2, 'both the sale and the refund are linked to the deposit')
    assert(plans[0]?.discrepancyReason.includes('환불 1건 상계'), 'reason names the refund netting')
    assert(summary.matched === 1, 'summary.matched === 1')

    // A positive-only 1:1 match must NOT fire against the un-netted amount:
    const wrong = planWindowReconciliations({
      today: '2026-09-03',
      rulesByGroup: rules(HANA),
      sales,
      deposits: [deposit('d2', '2026-09-02', 49925, HANA.groupKey)],
    })
    assert(
      wrong.plans.every((p) => p.status !== 'matched'),
      'deposit equal to the UN-netted single sale does not match while a refund shares the window'
    )
  })
}

// ── batch / N:M (req. C) ───────────────────────────────────────────────────

function runBatchTests(): void {
  section('batch matching — multi-day windows, multi-deposit days', () => {
    // Delivery app: 27.5% fee, D+3, window 7 — weekly batch of 2 sale days.
    const DELIV: GroupRule = {
      groupKey: 'method:delivery_app:ch1',
      methodCode: 'delivery_app',
      issuerId: null,
      label: '배달의민족',
      fee: channelFeeFraction(DELIVERY_APP_RULE),
      settlementDays: DELIVERY_APP_RULE.settlementDays,
      windowDays: DELIVERY_APP_RULE.toleranceDays,
      toleranceWon: DELIVERY_APP_RULE.toleranceWon,
    }
    const s1 = sale('s1', '2026-09-01', 10000, DELIV.groupKey) // net 7,250
    const s2 = sale('s2', '2026-09-02', 20000, DELIV.groupKey) // net 14,500
    const batch = planWindowReconciliations({
      today: '2026-09-05',
      rulesByGroup: rules(DELIV),
      sales: [s1, s2],
      deposits: [deposit('d1', '2026-09-04', 21750, DELIV.groupKey)],
    })
    assert(batch.plans.length === 1 && batch.plans[0]?.status === 'matched', 'two sale days → one weekly batch deposit → matched')
    assert(batch.plans[0]?.matchKind === 'window_batch', 'match kind is window_batch')
    assert(batch.plans[0]?.pairs.length === 2, 'both sales linked to the batch deposit')

    // Several deposits covering one period (multi_deposit_batch):
    const NH = issuerGroup('issuer:nh', 'NH')
    const m = planWindowReconciliations({
      today: '2026-09-05',
      rulesByGroup: rules(NH),
      sales: [
        sale('m1', '2026-09-01', 30000, NH.groupKey), // net 29,955
        sale('m2', '2026-09-01', 40000, NH.groupKey), // net 39,940
      ],
      deposits: [
        deposit('md1', '2026-09-03', 29955, NH.groupKey),
        deposit('md2', '2026-09-03', 39940, NH.groupKey),
      ],
    })
    // Exact 1:1s take precedence — but both resolve, nothing left open:
    assert(m.summary.matched === 2 && m.summary.deposits_left_open_for_ai === 0, 'two same-day deposits both consumed (M:N period coverage)')
  })
}

// ── deterministic-only flags ───────────────────────────────────────────────

function runWindowExpiryTests(): void {
  section('missing_deposit fires only after the window EXPIRES', () => {
    const NH = issuerGroup('issuer:nh', 'NH') // window end = sale + 2 + 3
    const sales = [sale('s1', '2026-09-01', 31500, NH.groupKey)]

    const young = planWindowReconciliations({
      today: '2026-09-04', // window ends 09-06 — money may still be coming
      rulesByGroup: rules(NH),
      sales,
      deposits: [],
    })
    assert(young.plans.length === 0, 'window still open → NO missing_deposit yet')
    assert(young.summary.sales_left_open === 1, 'sale reported as left open instead')

    const expired = planWindowReconciliations({
      today: '2026-09-07', // 09-06 passed with no deposit
      rulesByGroup: rules(NH),
      sales,
      deposits: [],
    })
    assert(
      expired.plans.length === 1 && expired.plans[0]?.status === 'missing_deposit',
      'window expired → missing_deposit'
    )
    assert(expired.plans[0]?.discrepancyAmount === 31453, 'discrepancy is the expected NET (fee applied)')
    assert(
      expired.plans[0]?.pairs[0]?.sale_id === 's1' && expired.plans[0]?.pairs[0]?.deposit_id === null,
      'one-sided pair (deposit_id null)'
    )

    // Refund-only day: nets to ≤ 0 → nothing is owed → never missing_deposit.
    const refundOnly = planWindowReconciliations({
      today: '2026-09-30',
      rulesByGroup: rules(NH),
      sales: [sale('r1', '2026-09-01', -20000, NH.groupKey)],
      deposits: [],
    })
    assert(refundOnly.plans.length === 0, 'refund-only expired day expects no deposit → no flag')
  })
}

// ── idempotency + settlement-only retirement (req. D) ──────────────────────

function runIdempotencyAndRetirementTests(): void {
  section('idempotency + settlement-only methods never planned', () => {
    const NH = issuerGroup('issuer:nh', 'NH')
    const sales = [sale('s1', '2026-09-01', 31500, NH.groupKey)]
    const deposits = [deposit('d1', '2026-09-03', 31453, NH.groupKey)]

    const first = planWindowReconciliations({
      today: '2026-09-06',
      rulesByGroup: rules(NH),
      sales,
      deposits,
    })
    assert(first.plans.length === 1, 'first run plans 1 reconciliation')

    const rerun = planWindowReconciliations({
      today: '2026-09-06',
      rulesByGroup: rules(NH),
      sales,
      deposits,
      alreadyMatchedSaleIds: new Set(['s1']),
      alreadyMatchedDepositIds: new Set(['d1']),
    })
    assert(rerun.plans.length === 0, 're-run with already-matched ids plans 0 (no double-create)')
    assert(rerun.summary.sales_considered === 0 && rerun.summary.deposits_considered === 0, 're-run considers nothing')

    // TRANSFER RETIRED: the orchestrator never builds a group for
    // settlement-only methods, so their rows carry a groupKey with no rule —
    // the planner must ignore them completely (no match, no flag, ever).
    const strayTransfer = planWindowReconciliations({
      today: '2026-09-30',
      rulesByGroup: rules(NH),
      sales: [sale('t1', '2026-09-01', 50000, 'method:transfer:ch-t')],
      deposits: [deposit('td1', '2026-09-01', 50000, 'method:transfer:ch-t')],
    })
    assert(strayTransfer.plans.length === 0, 'transfer rows (groupless) produce ZERO plans — never missing_deposit')
    assert(
      strayTransfer.summary.sales_considered === 0 && strayTransfer.summary.deposits_considered === 0,
      'transfer rows are not even considered'
    )

    assert(channelExpectsDeposit(CASH_RULE) === false, 'CASH_RULE stays expectsDeposit=false (정산 전용)')
    assert(channelExpectsDeposit(PAPER_VOUCHER_RULE) === false, 'PAPER_VOUCHER_RULE stays expectsDeposit=false (정산 전용)')
    assert(
      CHANNEL_PRESETS.every((p) => p.channelType !== 'card'),
      'presets no longer lump onto card: 배달앱→delivery_app, 알리/위챗→foreign_pay'
    )
    assert(addDaysIso('2026-08-30', 5) === '2026-09-04', 'window arithmetic crosses month boundaries')
  })
}

// ── Parser regex-fallback test ────────────────────────────────────────────

function runParserTests(): void {
  console.log('\n══ TRANSFER_PARSE_SPEC.regexFallback() — AI unavailable ══')
  const totalBefore = totalCount
  const failBefore = failCount

  // ── Case A: MM/DD form, no year in text → year filled in from `today` ────
  {
    const text = '[Web발신]\n[국민은행]\n08/13 09:15\n홍길동님 50,000원 입금\n잔액 1,234,500원'
    const { date, amount } = TRANSFER_PARSE_SPEC.regexFallback(text, '2026-08-13')
    assert(date === '2026-08-13', `Parser Case A: date extracted as 2026-08-13 (got ${date})`)
    assert(amount === 50000, `Parser Case A: amount extracted as 50000 (got ${amount})`)
  }

  // ── Case B: full YYYY.MM.DD form is used as-is (not overridden by today) ─
  {
    const text = '입금 120,000원 완료 (2026.08.10 14:00 기준)'
    const { date, amount } = TRANSFER_PARSE_SPEC.regexFallback(text, '2026-08-13')
    assert(date === '2026-08-10', `Parser Case B: full date 2026-08-10 wins over today (got ${date})`)
    assert(amount === 120000, `Parser Case B: amount extracted as 120000 (got ${amount})`)
  }

  // ── Case C: plain digits, no comma grouping, dash date separator ─────────
  {
    const text = '08-13 카카오뱅크 입금 75000원'
    const { date, amount } = TRANSFER_PARSE_SPEC.regexFallback(text, '2026-08-13')
    assert(date === '2026-08-13', `Parser Case C: MM-DD date resolved with today's year (got ${date})`)
    assert(amount === 75000, `Parser Case C: amount extracted as 75000 (got ${amount})`)
  }

  // ── Case D: no amount/date present at all → both null (no throw) ─────────
  {
    const text = '안녕하세요 좋은 하루 되세요'
    const { date, amount } = TRANSFER_PARSE_SPEC.regexFallback(text, '2026-08-13')
    assert(date === null, 'Parser Case D: no date in text → null')
    assert(amount === null, 'Parser Case D: no amount in text → null')
  }

  const total = totalCount - totalBefore
  const pass = total - (failCount - failBefore)
  console.log(`\n  ${pass}/${total} passed${failCount > failBefore ? ` — ${failCount - failBefore} FAILED` : ' ✅'}`)
}

// ── VOUCHER_PARSE_SPEC regex-fallback + voucher_type extraField test ──────

function runVoucherParserTests(): void {
  console.log('\n══ VOUCHER_PARSE_SPEC.regexFallback() + voucher_type ══')
  const totalBefore = totalCount
  const failBefore = failCount

  // ── Case A: 탐나는전 app deposit — date/amount reused from TRANSFER, plus voucher_type ─
  {
    const text = '[Web발신]\n[농협은행]\n08/20 10:05\n탐나는전 50,000원 입금\n잔액 890,000원'
    const { date, amount } = VOUCHER_PARSE_SPEC.regexFallback(text, '2026-08-20')
    assert(date === '2026-08-20', `Voucher Case A: date extracted as 2026-08-20 (got ${date})`)
    assert(amount === 50000, `Voucher Case A: amount extracted as 50000 (got ${amount})`)
    assert(matchVoucherType(text) === '탐나는전', `Voucher Case A: voucher_type is 탐나는전 (got ${matchVoucherType(text)})`)
  }

  // ── Case B: 온누리 app deposit ─────────────────────────────────────────
  {
    const text = '입금 120,000원 완료 (2026.08.19 09:00 기준) 온누리상품권'
    const { date, amount } = VOUCHER_PARSE_SPEC.regexFallback(text, '2026-08-20')
    assert(date === '2026-08-19', `Voucher Case B: date extracted as 2026-08-19 (got ${date})`)
    assert(amount === 120000, `Voucher Case B: amount extracted as 120000 (got ${amount})`)
    assert(matchVoucherType(text) === '온누리', `Voucher Case B: voucher_type is 온누리 (got ${matchVoucherType(text)})`)
  }

  // ── Case C: neither known voucher name present → voucher_type is null ────
  {
    const text = '08-20 카카오뱅크 입금 75000원'
    assert(matchVoucherType(text) === null, 'Voucher Case C: unrecognized payer → voucher_type null (not hallucinated)')
  }

  const total = totalCount - totalBefore
  const pass = total - (failCount - failBefore)
  console.log(`\n  ${pass}/${total} passed${failCount > failBefore ? ` — ${failCount - failBefore} FAILED` : ' ✅'}`)
}

function runMultiRowDepositTests(): void {
  console.log('\n══ extractDepositTextRows + HITL duplicate flags ══')
  const totalBefore = totalCount
  const failBefore = failCount

  {
    const text =
      '2026.08.01 온누리 50,000원 입금\n2026.08.15 탐나는전 30,000원 입금\n08.20 홍길동 10,000원 입금'
    const rows = extractDepositTextRows(text)
    assert(rows.length === 3, `multi-row: 3 rows (got ${rows.length})`)
    assert(rows[0]?.date === '2026-08-01' && rows[0]?.amount === 50000, 'multi-row: first keeps printed date')
    assert(rows[1]?.date === '2026-08-15' && rows[1]?.amount === 30000, 'multi-row: second keeps its own date')
    assert(rows[2]?.date === '2026-08-20' && rows[2]?.year_ambiguous === false, 'multi-row: MM/DD year inferred from siblings')
  }

  {
    const text = '[Web발신]\n[국민은행]\n08/13 09:15\n홍길동님 50,000원 입금\n잔액 1,234,500원'
    const rows = extractDepositTextRows(text)
    assert(rows.length === 1, `SMS: one deposit row, 잔액 skipped (got ${rows.length})`)
    assert(rows[0]?.amount === 50000, 'SMS: amount 50000')
    assert(rows[0]?.date == null && rows[0]?.year_ambiguous === true, 'SMS: no year in capture → date null, not guessed')
  }

  {
    const existing = [
      { id: 'd1', deposit_date: '2026-08-01', actual_amount: 50000, memo: '온누리' },
    ]
    const cores = [
      {
        date: '2026-08-01',
        amount: 50000,
        memo: '온누리',
        confidence: 0.6,
        year_ambiguous: false,
        method: 'ai' as const,
        extra: null,
      },
      {
        date: '2026-08-01',
        amount: 50000,
        memo: '탐나는전',
        confidence: 0.6,
        year_ambiguous: false,
        method: 'ai' as const,
        extra: null,
      },
      {
        date: '2026-08-02',
        amount: 50000,
        memo: '온누리',
        confidence: 0.6,
        year_ambiguous: false,
        method: 'ai' as const,
        extra: null,
      },
    ]
    const flagged = annotateDuplicates(cores, existing)
    assert(flagged.length === 3, 'duplicate annotator never drops a row')
    assert(flagged[0]?.duplicate_suspect === true && flagged[0]?.matching_deposit_ids[0] === 'd1', 'same date+amount+memo → 중복 의심')
    assert(flagged[1]?.duplicate_suspect === false, 'same date+amount different memo → not a duplicate')
    assert(flagged[2]?.duplicate_suspect === false, 'different date → not a duplicate')
    assert(normalizeDepositMemo('  온누리   상품권  ') === '온누리 상품권', 'memo normalized')
  }

  const total = totalCount - totalBefore
  const pass = total - (failCount - failBefore)
  console.log(`\n  ${pass}/${total} passed${failCount > failBefore ? ` — ${failCount - failBefore} FAILED` : ' ✅'}`)
}

function runMonthlySummaryTests(): void {
  console.log('\n── Monthly summary & date range tests ────────────────────────')
  const totalBefore = totalCount
  const failBefore = failCount

  // Date range tests
  const aug2026 = getMonthDateRange('2026-08')
  assert(aug2026?.from === '2026-08-01' && aug2026?.to === '2026-08-31', '2026-08 range is 2026-08-01 ~ 2026-08-31')

  const feb2026 = getMonthDateRange('2026-02')
  assert(feb2026?.from === '2026-02-01' && feb2026?.to === '2026-02-28', '2026-02 non-leap range is 2026-02-01 ~ 2026-02-28')

  const feb2024 = getMonthDateRange('2024-02')
  assert(feb2024?.from === '2024-02-01' && feb2024?.to === '2024-02-29', '2024-02 leap year range is 2024-02-01 ~ 2024-02-29')

  const invalid = getMonthDateRange('2026-13')
  assert(invalid === null, 'invalid month returns null')

  // Monthly summary computation tests
  const sales = [
    { id: 's1', sale_date: '2026-08-05', gross_amount: 100000, discount_amount: 5000, sale_kind: 'card' },
    { id: 's2', sale_date: '2026-08-10', gross_amount: 50000, discount_amount: null, sale_kind: 'paper_voucher' },
    { id: 's3', sale_date: '2026-08-15', gross_amount: 30000, discount_amount: 2000, sale_kind: 'cash' },
    { id: 's4', sale_date: '2026-08-20', gross_amount: 40000, discount_amount: null, sale_kind: 'app_voucher' },
    { id: 's5', sale_date: '2026-09-01', gross_amount: 999999, discount_amount: null, sale_kind: 'card' }, // Out of month
  ]

  const deposits = [
    { id: 'd1', deposit_date: '2026-08-07', actual_amount: 97500, memo: '카드정산' }, // Matched
    { id: 'd2', deposit_date: '2026-08-22', actual_amount: 40000, memo: '온누리앱' }, // Matched
    { id: 'd3', deposit_date: '2026-08-25', actual_amount: 12000, memo: '미대사입금' }, // Unmatched
    { id: 'd4', deposit_date: '2026-09-02', actual_amount: 888888, memo: '다음달' }, // Out of month
  ]

  const reconciliations = [
    { id: 'r1', status: 'matched' },
    { id: 'r2', status: 'amount_mismatch' },
    { id: 'r3', status: 'missing_deposit' },
  ]

  const matches = [
    { reconciliation_id: 'r1', sales_record_id: 's1', deposit_record_id: 'd1' },
    { reconciliation_id: 'r2', sales_record_id: 's4', deposit_record_id: 'd2' },
    { reconciliation_id: 'r3', sales_record_id: 's2', deposit_record_id: null }, // missing deposit for paper_voucher (if any)
  ]

  const summary = computeMonthlySummaryData({
    month: '2026-08',
    from: '2026-08-01',
    to: '2026-08-31',
    sales,
    deposits,
    reconciliations,
    matches,
  })

  assert(summary.total_sales === 220000, `total_sales is sum of all in-month sales (100k+50k+30k+40k = 220000, got ${summary.total_sales})`)
  assert(summary.total_discount === 7000, `total_discount is sum of discounts in-month (5k+2k = 7000, got ${summary.total_discount})`)
  assert(summary.sales_by_kind.card.amount === 100000 && summary.sales_by_kind.card.count === 1, 'card sales breakdown')
  assert(summary.sales_by_kind.paper_voucher.amount === 50000 && summary.sales_by_kind.paper_voucher.count === 1, 'paper_voucher sales breakdown')
  assert(summary.sales_by_kind.cash.amount === 30000 && summary.sales_by_kind.cash.count === 1, 'cash sales breakdown')
  assert(summary.sales_by_kind.app_voucher.amount === 40000 && summary.sales_by_kind.app_voucher.count === 1, 'app_voucher sales breakdown')

  assert(summary.deposits.total_amount === 149500, `total deposits is 97500+40000+12000 = 149500, got ${summary.deposits.total_amount}`)
  assert(summary.deposits.matched_amount === 137500, `matched deposits is 97500+40000 = 137500, got ${summary.deposits.matched_amount}`)
  assert(summary.deposits.unmatched_amount === 12000, `unmatched deposits is 12000, got ${summary.deposits.unmatched_amount}`)
  assert(summary.deposits.matched_count === 2 && summary.deposits.unmatched_count === 1, 'deposit matched/unmatched counts')

  assert(summary.counts.matched === 1, 'counts.matched === 1')
  assert(summary.counts.amount_mismatch === 1, 'counts.amount_mismatch === 1')
  assert(summary.counts.missing_deposit === 1, 'counts.missing_deposit === 1')
  assert(summary.counts.paper_voucher_pending === 1, 'paper_voucher_pending === 1')
  assert(summary.paper_voucher_pending_amount === 50000, 'paper_voucher_pending_amount === 50000')

  const total = totalCount - totalBefore
  const pass = total - (failCount - failBefore)
  console.log(`\n  ${pass}/${total} passed${failCount > failBefore ? ` — ${failCount - failBefore} FAILED` : ' ✅'}`)
}

// ── Main ──────────────────────────────────────────────────────────────────

function main(): void {
  runFeeUnitTests()
  runRealDataTests()
  runRefundNettingTests()
  runBatchTests()
  runWindowExpiryTests()
  runIdempotencyAndRetirementTests()
  runParserTests()
  runVoucherParserTests()
  runMultiRowDepositTests()
  runMonthlySummaryTests()

  if (failCount > 0) {
    console.error(`\n❌ ${failCount} assertion(s) failed`)
    process.exitCode = 1
  } else {
    console.log('\n✅ all assertions passed')
  }
}

main()
