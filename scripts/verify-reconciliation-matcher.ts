/**
 * Unit tests for the transfer reconciliation matcher + parser regex fallback.
 *
 * DB-FREE: everything below calls a pure function with plain in-memory
 * fixtures. No supabaseAdmin, no network, no server-only side effects.
 *
 *   - planTransferReconciliations() (lib/reconciliation/reconcile.ts) is the
 *     pure decision core reconcileTransfers() delegates to — it takes plain
 *     sales/deposits arrays + a rule map + already-matched id sets and
 *     returns what *would* be created, with no I/O at all.
 *   - TRANSFER_PARSE_SPEC.regexFallback() (lib/reconciliation/parser.ts) is
 *     the deterministic fallback parseDeposit() uses when the AI path is
 *     unavailable — also pure, takes (text, todayKst) and returns {date, amount}.
 *
 * Run:
 *   npx tsx scripts/verify-reconciliation-matcher.ts
 */

import {
  planTransferReconciliations,
  type PlannerDepositInput,
  type PlannerSaleInput,
} from '../lib/reconciliation/reconcile'
import { TRANSFER_PARSE_SPEC } from '../lib/reconciliation/parser'

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

function sale(id: string, date: string, gross: number, channelId: string | null = 'ch-transfer'): PlannerSaleInput {
  return { id, sale_date: date, gross_amount: gross, expected_net_amount: null, channel_id: channelId }
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

// ── Main ──────────────────────────────────────────────────────────────────

function main(): void {
  runMatcherTests()
  runParserTests()

  if (failCount > 0) {
    console.error(`\n❌ ${failCount} assertion(s) failed`)
    process.exitCode = 1
  } else {
    console.log('\n✅ all assertions passed')
  }
}

main()
