/**
 * Unit tests for the transfer / app-voucher reconciliation matcher + parser
 * regex fallbacks.
 *
 * DB-FREE: everything below calls a pure function with plain in-memory
 * fixtures. No supabaseAdmin, no network, no server-only side effects.
 *
 *   - planTransferReconciliations() (lib/reconciliation/reconcile.ts) is the
 *     pure decision core BOTH reconcileTransfers() AND reconcileAppVouchers()
 *     delegate to — it takes plain sales/deposits arrays + a rule map +
 *     already-matched id sets and returns what *would* be created, with no
 *     I/O and no channel-type awareness at all.
 *   - Card-type (STAGE 2c) reuses the same planner with CARD_RULE (2.5% fee,
 *     T+2 settlement). Tests below prove net comparison, batch N:M with fee,
 *     amount_mismatch, missing_deposit, and unmatched_deposit.
 *   - TRANSFER_PARSE_SPEC.regexFallback() / VOUCHER_PARSE_SPEC's
 *     regexFallback + voucher_type extraField (lib/reconciliation/parser.ts)
 *     are the deterministic fallbacks parseDeposit() uses when the AI path
 *     is unavailable — also pure.
 *
 * Run:
 *   npx tsx --import ./scripts/stubs/register-server-only.mjs scripts/verify-reconciliation-matcher.ts
 * (the stub is required because reconcile.ts/parser.ts `import 'server-only'`,
 * which Next.js aliases away in its own bundler but a plain tsx process can't
 * resolve on its own — see scripts/stubs/register-server-only.mjs.)
 */

import {
  planTransferReconciliations,
  type PlannerDepositInput,
  type PlannerSaleInput,
} from '../lib/reconciliation/reconcile'
import { matchVoucherType, TRANSFER_PARSE_SPEC, VOUCHER_PARSE_SPEC } from '../lib/reconciliation/parser'
import { APP_VOUCHER_RULE, CARD_RULE, CASH_RULE, PAPER_VOUCHER_RULE, channelExpectsDeposit, expectedDepositDate, expectedNet, TRANSFER_RULE, type ChannelRule } from '../lib/reconciliation/channel-rules'
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

// ── Fixture helpers ────────────────────────────────────────────────────────

function sale(
  id: string,
  date: string,
  gross: number,
  channelId: string | null = 'ch-transfer',
  expectedNetAmount: number | null = null
): PlannerSaleInput {
  return {
    id,
    sale_date: date,
    gross_amount: gross,
    expected_net_amount: expectedNetAmount,
    channel_id: channelId,
  }
}

function deposit(id: string, date: string, amount: number, hint: string | null = null): PlannerDepositInput {
  return { id, deposit_date: date, actual_amount: amount, channel_hint: hint }
}

// ── Matcher tests ──────────────────────────────────────────────────────────

function runMatcherTests(): void {
  console.log('\n══ reconcile matcher: planTransferReconciliations() ══')
  const totalBefore = totalCount
  const failBefore = failCount

  // ── Case 1: exact 1:1 amount match → matched ──────────────────────────────
  {
    const sales = [sale('s1', '2026-08-01', 50000)]
    const deposits = [deposit('d1', '2026-08-01', 50000)]
    const { plans, summary } = planTransferReconciliations({ sales, deposits })

    assert(plans.length === 1, 'Case 1: exactly one planned reconciliation')
    assert(plans[0]?.status === 'matched', 'Case 1: status is matched')
    assert(plans[0]?.discrepancyAmount === 0, 'Case 1: discrepancy is 0')
    assert(
      plans[0]?.pairs.length === 1 &&
        plans[0]?.pairs[0]?.sale_id === 's1' &&
        plans[0]?.pairs[0]?.deposit_id === 'd1',
      'Case 1: single pair links s1 ↔ d1'
    )
    assert(summary.matched === 1, 'Case 1: summary.matched === 1')
    assert(summary.sales_considered === 1 && summary.deposits_considered === 1, 'Case 1: summary considers 1 sale + 1 deposit')
  }

  // ── Case 2: N:M batch, sums equal → matched with cross-links ─────────────
  {
    const sales = [sale('s2', '2026-08-02', 30000), sale('s3', '2026-08-02', 20000)]
    const deposits = [deposit('d2', '2026-08-02', 45000), deposit('d3', '2026-08-02', 5000)]
    const { plans, summary } = planTransferReconciliations({ sales, deposits })

    assert(plans.length === 1, 'Case 2: exactly one planned reconciliation (batch)')
    assert(plans[0]?.status === 'matched', 'Case 2: batch status is matched (sums equal)')
    assert(plans[0]?.discrepancyAmount === 0, 'Case 2: batch discrepancy is 0')
    const pairKeys = new Set((plans[0]?.pairs ?? []).map((p) => `${p.sale_id}:${p.deposit_id}`))
    assert(pairKeys.size === 4, 'Case 2: 4 cross-linked pairs (2 sales × 2 deposits)')
    for (const s of ['s2', 's3']) {
      for (const d of ['d2', 'd3']) {
        assert(pairKeys.has(`${s}:${d}`), `Case 2: cross-link ${s} ↔ ${d} present`)
      }
    }
    assert(summary.matched === 1, 'Case 2: summary.matched === 1')
  }

  // ── Case 3: batch, sums differ → amount_mismatch ──────────────────────────
  {
    const sales = [sale('s4', '2026-08-03', 30000), sale('s5', '2026-08-03', 20000)]
    const deposits = [deposit('d4', '2026-08-03', 40000)]
    const { plans, summary } = planTransferReconciliations({ sales, deposits })

    assert(plans.length === 1, 'Case 3: exactly one planned reconciliation (batch)')
    assert(plans[0]?.status === 'amount_mismatch', 'Case 3: batch status is amount_mismatch (sums differ)')
    assert(plans[0]?.discrepancyAmount === 10000, 'Case 3: discrepancy is expected(50000) - actual(40000) = 10000')
    assert(plans[0]?.pairs.length === 2, 'Case 3: 2 pairs (2 sales × 1 deposit)')
    assert(summary.amount_mismatch === 1 && summary.matched === 0, 'Case 3: summary counts 1 amount_mismatch, 0 matched')
  }

  // ── Case 4: sale with no deposit → missing_deposit ────────────────────────
  {
    const sales = [sale('s6', '2026-08-04', 10000)]
    const deposits: PlannerDepositInput[] = []
    const { plans, summary } = planTransferReconciliations({ sales, deposits })

    assert(plans.length === 1, 'Case 4: exactly one planned reconciliation')
    assert(plans[0]?.status === 'missing_deposit', 'Case 4: status is missing_deposit')
    assert(plans[0]?.discrepancyAmount === 10000, 'Case 4: discrepancy equals expected net amount')
    assert(
      plans[0]?.pairs.length === 1 && plans[0]?.pairs[0]?.sale_id === 's6' && plans[0]?.pairs[0]?.deposit_id === null,
      'Case 4: one-sided pair (sale_id set, deposit_id null)'
    )
    assert(summary.missing_deposit === 1, 'Case 4: summary.missing_deposit === 1')
  }

  // ── Case 5: re-run idempotency — already-linked rows are excluded ────────
  {
    const sales = [sale('s1', '2026-08-01', 50000)]
    const deposits = [deposit('d1', '2026-08-01', 50000)]

    // First run: no prior matches, s1/d1 get matched (same as Case 1).
    const first = planTransferReconciliations({ sales, deposits })
    assert(first.plans.length === 1, 'Case 5: first run plans 1 reconciliation')

    // Re-run with the SAME rows, but now s1/d1 are already linked by a prior
    // reconciliation_matches row (as reconcileTransfers() would report via
    // alreadyMatchedIds()). The planner must exclude them — no double-create.
    const rerun = planTransferReconciliations({
      sales,
      deposits,
      alreadyMatchedSaleIds: new Set(['s1']),
      alreadyMatchedDepositIds: new Set(['d1']),
    })
    assert(rerun.plans.length === 0, 'Case 5: re-run plans 0 reconciliations (already matched)')
    assert(rerun.summary.sales_considered === 0, 'Case 5: re-run considers 0 sales (s1 excluded)')
    assert(rerun.summary.deposits_considered === 0, 'Case 5: re-run considers 0 deposits (d1 excluded)')
    assert(rerun.summary.matched === 0, 'Case 5: re-run summary.matched === 0 (no double-create)')

    // Partial exclusion: only the sale is already matched (its deposit is
    // not, e.g. it settles a different sale). The excluded sale's date-group
    // must not wrongly consume that leftover deposit; a separate open sale on
    // a different date with no deposit of its own must still be flagged.
    const partial = planTransferReconciliations({
      sales: [sale('s1', '2026-08-01', 50000), sale('s7', '2026-08-05', 12345)],
      deposits: [deposit('d1', '2026-08-01', 50000)],
      alreadyMatchedSaleIds: new Set(['s1']),
    })
    assert(partial.plans.length === 1, 'Case 5 (partial): only s7 is planned (s1 excluded)')
    assert(
      partial.plans[0]?.status === 'missing_deposit' && partial.plans[0]?.pairs[0]?.sale_id === 's7',
      'Case 5 (partial): s7 (different date, no deposit) → missing_deposit'
    )
    assert(
      partial.summary.deposits_left_open === 1,
      'Case 5 (partial): d1 (excluded sale\'s date, no open sale left) → left open, not re-matched'
    )
  }

  const total = totalCount - totalBefore
  const pass = total - (failCount - failBefore)
  console.log(`\n  ${pass}/${total} passed${failCount > failBefore ? ` — ${failCount - failBefore} FAILED` : ' ✅'}`)
}

// ── App-voucher reuse: SAME planner, a different channel_id + rule ────────
//
// STAGE 2 requirement: app-voucher reconciliation must reuse the transfer
// matcher with "minimal new decision logic". Since planTransferReconciliations
// has zero channel-type awareness (a channel is just a string key into the
// rule map), an app-voucher fixture set proves matched / amount_mismatch /
// missing_deposit all work identically — no new planner code exists to test.
function runAppVoucherReuseTests(): void {
  console.log('\n══ app-voucher reuse of planTransferReconciliations() ══')
  const totalBefore = totalCount
  const failBefore = failCount

  const ruleByChannelId = new Map<string, ChannelRule>([['ch-voucher', APP_VOUCHER_RULE]])
  assert(APP_VOUCHER_RULE.feeRate === 0, 'APP_VOUCHER_RULE: zero fee (direct deposit, no cut)')

  // ── matched: exact 1:1 amount match on an app_voucher channel ────────────
  {
    const sales = [sale('v1', '2026-08-20', 50000, 'ch-voucher')]
    const deposits = [deposit('vd1', '2026-08-20', 50000)]
    const { plans, summary } = planTransferReconciliations({ sales, deposits, ruleByChannelId })
    assert(plans.length === 1 && plans[0]?.status === 'matched', 'voucher matched: 탐나는전-style exact deposit')
    assert(summary.matched === 1, 'voucher matched: summary.matched === 1')
  }

  // ── amount_mismatch: deposit short of the expected face value ────────────
  {
    const sales = [sale('v2', '2026-08-21', 30000, 'ch-voucher')]
    const deposits = [deposit('vd2', '2026-08-21', 25000)]
    const { plans, summary } = planTransferReconciliations({ sales, deposits, ruleByChannelId })
    assert(plans.length === 1 && plans[0]?.status === 'amount_mismatch', 'voucher amount_mismatch: short deposit flagged')
    assert(plans[0]?.discrepancyAmount === 5000, 'voucher amount_mismatch: discrepancy is 30000 - 25000 = 5000')
    assert(summary.amount_mismatch === 1, 'voucher amount_mismatch: summary.amount_mismatch === 1')
  }

  // ── missing_deposit: sale with no matching voucher deposit at all ────────
  {
    const sales = [sale('v3', '2026-08-22', 15000, 'ch-voucher')]
    const deposits: PlannerDepositInput[] = []
    const { plans, summary } = planTransferReconciliations({ sales, deposits, ruleByChannelId })
    assert(plans.length === 1 && plans[0]?.status === 'missing_deposit', 'voucher missing_deposit: no settlement seen yet')
    assert(summary.missing_deposit === 1, 'voucher missing_deposit: summary.missing_deposit === 1')
  }

  const total = totalCount - totalBefore
  const pass = total - (failCount - failBefore)
  console.log(`\n  ${pass}/${total} passed${failCount > failBefore ? ` — ${failCount - failBefore} FAILED` : ' ✅'}`)
}

// ── Card-type: SAME planner, CARD_RULE (fee + settlement window) ──────────
//
// Card deposits arrive NET of fees, batched, on expectedDepositDate (T+2).
// The planner already compares against expectedNet / persisted
// expected_net_amount — these fixtures prove that path, including that a
// GROSS-amount deposit does NOT match.
function runCardTypeTests(): void {
  console.log('\n══ card-type reuse of planTransferReconciliations() ══')
  const totalBefore = totalCount
  const failBefore = failCount

  const ruleByChannelId = new Map<string, ChannelRule>([['ch-card', CARD_RULE]])
  assert(CARD_RULE.feeType === 'percent' && CARD_RULE.feeRate === 2.5, 'CARD_RULE: percent fee 2.5% (placeholder, data not matcher)')
  assert(CARD_RULE.settlementDays === 2, 'CARD_RULE: T+2 settlement window')

  const saleDate = '2026-08-01'
  const settleDate = expectedDepositDate(saleDate, CARD_RULE)
  assert(settleDate === '2026-08-03', `CARD_RULE expected deposit date is 2026-08-03 (got ${settleDate})`)

  const gross = 100000
  const net = expectedNet(gross, CARD_RULE)
  assert(net === 97500, `expectedNet(100000, CARD_RULE) === 97500 (got ${net})`)

  // ── matched: deposit equals NET on settlement date, not gross ────────────
  {
    const sales = [sale('c1', saleDate, gross, 'ch-card')]
    const deposits = [deposit('cd1', settleDate, net)]
    const { plans, summary } = planTransferReconciliations({
      sales,
      deposits,
      ruleByChannelId,
      flagUnmatchedDeposits: true,
    })
    assert(plans.length === 1 && plans[0]?.status === 'matched', 'card matched: net deposit on T+2')
    assert(plans[0]?.discrepancyAmount === 0, 'card matched: discrepancy is 0')
    assert(
      plans[0]?.pairs[0]?.sale_id === 'c1' && plans[0]?.pairs[0]?.deposit_id === 'cd1',
      'card matched: c1 ↔ cd1'
    )
    assert(summary.matched === 1, 'card matched: summary.matched === 1')
  }

  // ── persisted expected_net_amount wins over computed rule net ────────────
  {
    const storedNet = 97000
    const sales = [sale('c1b', saleDate, gross, 'ch-card', storedNet)]
    const deposits = [deposit('cd1b', settleDate, storedNet)]
    const { plans } = planTransferReconciliations({
      sales,
      deposits,
      ruleByChannelId,
      flagUnmatchedDeposits: true,
    })
    assert(plans.length === 1 && plans[0]?.status === 'matched', 'card persisted expected_net_amount is what gets compared')
  }

  // ── GROSS deposit must NOT match (would if matcher ignored the fee) ──────
  {
    const sales = [sale('c1c', saleDate, gross, 'ch-card')]
    const deposits = [deposit('cd1c', settleDate, gross)]
    const { plans, summary } = planTransferReconciliations({
      sales,
      deposits,
      ruleByChannelId,
      flagUnmatchedDeposits: true,
    })
    assert(plans.length === 1 && plans[0]?.status === 'amount_mismatch', 'card: gross-amount deposit is amount_mismatch, not matched')
    assert(plans[0]?.discrepancyAmount === net - gross, `card: discrepancy is net-gross = ${net - gross} (got ${plans[0]?.discrepancyAmount})`)
    assert(summary.amount_mismatch === 1 && summary.matched === 0, 'card gross-deposit: 1 amount_mismatch, 0 matched')
  }

  // ── amount_mismatch: net off beyond tolerance ────────────────────────────
  {
    const sales = [sale('c2', saleDate, gross, 'ch-card')]
    const deposits = [deposit('cd2', settleDate, 90000)]
    const { plans, summary } = planTransferReconciliations({
      sales,
      deposits,
      ruleByChannelId,
      flagUnmatchedDeposits: true,
    })
    assert(plans.length === 1 && plans[0]?.status === 'amount_mismatch', 'card amount_mismatch: net short of expected')
    assert(plans[0]?.discrepancyAmount === net - 90000, `card amount_mismatch: discrepancy ${net} - 90000 (got ${plans[0]?.discrepancyAmount})`)
    assert(summary.amount_mismatch === 1, 'card amount_mismatch: summary.amount_mismatch === 1')
  }

  // ── batch N:M with fee: two sales, one net settlement deposit ────────────
  {
    const g1 = 40000
    const g2 = 60000
    const batchNet = expectedNet(g1, CARD_RULE) + expectedNet(g2, CARD_RULE)
    const sales = [sale('c3', saleDate, g1, 'ch-card'), sale('c4', saleDate, g2, 'ch-card')]
    const deposits = [deposit('cd3', settleDate, batchNet)]
    const { plans, summary } = planTransferReconciliations({
      sales,
      deposits,
      ruleByChannelId,
      flagUnmatchedDeposits: true,
    })
    assert(plans.length === 1 && plans[0]?.status === 'matched', 'card batch N:M: two sales, one net deposit → matched')
    assert(plans[0]?.discrepancyAmount === 0, 'card batch: discrepancy is 0')
    assert(plans[0]?.pairs.length === 2, 'card batch: 2 pairs (2 sales × 1 deposit)')
    const pairKeys = new Set((plans[0]?.pairs ?? []).map((p) => `${p.sale_id}:${p.deposit_id}`))
    assert(pairKeys.has('c3:cd3') && pairKeys.has('c4:cd3'), 'card batch: both sales linked to the batched deposit')
    assert(summary.matched === 1, 'card batch: summary.matched === 1')
  }

  // ── missing_deposit: sale, no settlement deposit ─────────────────────────
  {
    const sales = [sale('c5', saleDate, gross, 'ch-card')]
    const deposits: PlannerDepositInput[] = []
    const { plans, summary } = planTransferReconciliations({
      sales,
      deposits,
      ruleByChannelId,
      flagUnmatchedDeposits: true,
    })
    assert(plans.length === 1 && plans[0]?.status === 'missing_deposit', 'card missing_deposit: no PG settlement yet')
    assert(plans[0]?.discrepancyAmount === net, `card missing_deposit: discrepancy is expected net ${net} (got ${plans[0]?.discrepancyAmount})`)
    assert(
      plans[0]?.pairs[0]?.sale_id === 'c5' && plans[0]?.pairs[0]?.deposit_id === null,
      'card missing_deposit: one-sided pair (deposit_id null)'
    )
    assert(summary.missing_deposit === 1, 'card missing_deposit: summary.missing_deposit === 1')
  }

  // ── unmatched_deposit: deposit, no sale (card flags; transfer leaves OPEN)
  {
    const sales: PlannerSaleInput[] = []
    const deposits = [deposit('cd6', settleDate, net)]
    const { plans, summary } = planTransferReconciliations({
      sales,
      deposits,
      ruleByChannelId,
      flagUnmatchedDeposits: true,
    })
    assert(plans.length === 1 && plans[0]?.status === 'unmatched_deposit', 'card unmatched_deposit: leftover settlement flagged')
    assert(
      plans[0]?.pairs[0]?.sale_id === null && plans[0]?.pairs[0]?.deposit_id === 'cd6',
      'card unmatched_deposit: one-sided pair (sale_id null)'
    )
    assert(summary.unmatched_deposit === 1 && summary.deposits_left_open === 0, 'card unmatched_deposit: counted, not left open')
  }

  const total = totalCount - totalBefore
  const pass = total - (failCount - failBefore)
  console.log(`\n  ${pass}/${total} passed${failCount > failBefore ? ` — ${failCount - failBefore} FAILED` : ' ✅'}`)
}

// ── Cash: skipped by the planner (revenue only, no deposit) ───────────────

function runCashSkipTests(): void {
  console.log('\n══ cash skip: planTransferReconciliations() never flags cash ══')
  const totalBefore = totalCount
  const failBefore = failCount

  const ruleByChannelId = new Map<string, ChannelRule>([
    ['ch-cash', CASH_RULE],
    ['ch-transfer', TRANSFER_RULE],
  ])
  assert(CASH_RULE.feeRate === 0, 'CASH_RULE: feeRate 0')
  assert(channelExpectsDeposit(CASH_RULE) === false, 'CASH_RULE: expectsDeposit is false')
  assert(channelExpectsDeposit(TRANSFER_RULE) === true, 'TRANSFER_RULE: still expects a deposit')
  assert(channelExpectsDeposit(CARD_RULE) === true, 'CARD_RULE: still expects a deposit')
  assert(expectedNet(50000, CASH_RULE) === 50000, 'expectedNet(cash) === gross')

  // ── cash sale, no deposit → NOT missing_deposit (skipped) ──────────────
  {
    const sales = [sale('cash1', '2026-08-01', 50000, 'ch-cash')]
    const { plans, summary } = planTransferReconciliations({ sales, deposits: [], ruleByChannelId })
    assert(plans.length === 0, 'cash only: zero plans (not missing_deposit)')
    assert(summary.missing_deposit === 0, 'cash only: missing_deposit === 0')
    assert(summary.sales_considered === 0, 'cash only: not counted as a sale to match')
  }

  // ── coincidental same-amount deposit must NOT match a cash sale ─────────
  {
    const sales = [sale('cash2', '2026-08-01', 50000, 'ch-cash')]
    const deposits = [deposit('d-cash', '2026-08-01', 50000)]
    const { plans, summary } = planTransferReconciliations({ sales, deposits, ruleByChannelId })
    assert(
      plans.every((p) => !p.pairs.some((pair) => pair.sale_id === 'cash2')),
      'cash sale is not paired with any deposit'
    )
    assert(summary.matched === 0, 'cash + coincidental deposit: not matched')
    assert(summary.missing_deposit === 0, 'cash + coincidental deposit: not missing_deposit')
  }

  // ── transfer alongside cash: transfer still matches; cash still skipped ─
  {
    const sales = [
      sale('t1', '2026-08-01', 30000, 'ch-transfer'),
      sale('cash3', '2026-08-01', 50000, 'ch-cash'),
    ]
    const deposits = [deposit('dt1', '2026-08-01', 30000)]
    const { plans, summary } = planTransferReconciliations({ sales, deposits, ruleByChannelId })
    assert(plans.length === 1 && plans[0]?.status === 'matched', 'transfer+cash: transfer still matched')
    assert(
      plans[0]?.pairs[0]?.sale_id === 't1' && plans[0]?.pairs[0]?.deposit_id === 'dt1',
      'transfer+cash: t1 ↔ dt1'
    )
    assert(
      plans.every((p) => !p.pairs.some((pair) => pair.sale_id === 'cash3')),
      'transfer+cash: cash sale not in any pair'
    )
    assert(summary.matched === 1 && summary.missing_deposit === 0, 'transfer+cash: 1 matched, 0 missing_deposit')
  }

  assert(channelExpectsDeposit(PAPER_VOUCHER_RULE) === false, 'PAPER_VOUCHER_RULE: expectsDeposit is false')
  assert(expectedNet(50000, PAPER_VOUCHER_RULE) === 50000, 'expectedNet(paper_voucher) === gross')
  // Persist leaves expected_deposit_date null (bank date unknown). No
  // reconcilePaperVouchers() — a sale-date matcher would false-flag missing_deposit.
  {
    const pvRules = new Map<string, ChannelRule>([
      ['ch-paper', PAPER_VOUCHER_RULE],
      ['ch-transfer', TRANSFER_RULE],
    ])
    const sales = [sale('pv1', '2026-08-01', 40000, 'ch-paper')]
    const { plans, summary } = planTransferReconciliations({ sales, deposits: [], ruleByChannelId: pvRules })
    assert(plans.length === 0, 'paper_voucher only: zero plans (not missing_deposit)')
    assert(summary.missing_deposit === 0, 'paper_voucher only: missing_deposit === 0')
  }

  const total = totalCount - totalBefore
  const pass = total - (failCount - failBefore)
  console.log(`\n  ${pass}/${total} passed${failCount > failBefore ? ` — ${failCount - failBefore} FAILED` : ' ✅'}`)
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
  runMatcherTests()
  runAppVoucherReuseTests()
  runCardTypeTests()
  runCashSkipTests()
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
