import 'server-only'

import { supabaseAdmin } from '@/lib/supabase/server'
import type { OwnedScope } from '@/lib/reconciliation/scope'
import { askModelJson, type ModelJsonAnswer } from '@/lib/reconciliation/ai-ask'
import {
  ADVISORY_MODELS,
  ASK_LOOKBACK_DAYS,
  ASK_MAX_COMPLETION_TOKENS,
  ASK_MAX_DEPOSIT_ROWS,
  ASK_MAX_PROPOSAL_ROWS,
  ASK_MAX_QUESTION_CHARS,
  ASK_MAX_RECON_ROWS,
  ASK_MAX_SALES_ROWS,
} from '@/lib/reconciliation/config'
import { listIssuers } from '@/lib/reconciliation/issuers-db'
import { addDaysIso } from '@/lib/reconciliation/plan-issuer'
import { getMonthDateRange } from '@/lib/reconciliation/summary'
import {
  ADVISORY_CONFIDENCES,
  type AdvisoryConfidence,
  type DalResult,
  type DepositRecord,
  type PaymentChannel,
  type Reconciliation,
  type ReconciliationMatch,
  type SalesRecord,
} from '@/lib/reconciliation/types'

/**
 * AI에게 물어보기 — grounded Q&A over the owner's OWN ledger (Part-B ask box).
 *
 * The owner types "9월에 아직 안 들어온 거 뭐야" / "하나카드로 얼마 팔았어"
 * and gets an answer derived ONLY from a bounded factual context:
 *
 *   - the asked month's sales / deposits (month start − ASK_LOOKBACK_DAYS,
 *     so "지난주" works on the 3rd of a month), capped at ASK_MAX_SALES_ROWS /
 *     ASK_MAX_DEPOSIT_ROWS newest-first — NEVER the whole table;
 *   - the latest ASK_MAX_RECON_ROWS reconciliation results;
 *   - pending AI proposals (count + first ASK_MAX_PROPOSAL_ROWS);
 *   - the issuer fee/lag table and month totals computed here (not by the model).
 *
 * Every row carries a citation ref (S1/D2/R3/P1). The model must answer from
 * the context alone, cite the refs it used, and say plainly when the answer
 * is not in the context — inventing figures is prompt-forbidden AND
 * post-checked (refs not in the table are dropped).
 *
 * ONE model per question (first ADVISORY slot, fallback to the second on
 * failure) — this is a latency-sensitive surface; the multi-model
 * cross-check stays on match inference where being wrong silently is
 * expensive. The answer is ALWAYS labelled an AI estimate with confidence.
 */

export type AskCitation = { ref: string; text: string }

export type AskResult = {
  answer: string
  confidence: AdvisoryConfidence
  /** Refs the model claims it used — every one verified to exist in context. */
  citations: AskCitation[]
  month: string
  from: string
  to: string
  model: string
  bounds: {
    sales_rows: number
    deposit_rows: number
    recon_rows: number
    proposal_rows: number
    sales_truncated: boolean
    deposits_truncated: boolean
  }
}

function dalOk<T>(data: T): DalResult<T> {
  return { ok: true, data }
}
function dalErr(status: number, error: string): DalResult<never> {
  return { ok: false, status, error }
}

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/

const won = (n: number): string => `${Math.round(n).toLocaleString('ko-KR')}원`

const STATUS_KO: Record<string, string> = {
  matched: '확인됨(입금 도착)',
  missing_deposit: '아직 안 들어옴',
  amount_mismatch: '금액 다름',
  unmatched_deposit: '어느 매출인지 모르는 입금',
  date_anomaly: '날짜 이상',
}

function buildSystemPrompt(): string {
  return [
    'You answer a Korean clothing-store owner\'s questions about her OWN sales/deposit ledger.',
    'The user message contains (1) her question and (2) the ONLY facts you may use: rows with refs like S1 (매출), D1 (입금), R1 (대사 결과), P1 (AI 제안), plus issuer fee/lag rows and month totals.',
    'Rules, all hard:',
    '- Use ONLY those facts. If the answer is not derivable from them, say so plainly (e.g. "이 자료만으로는 확인이 안 돼요") — NEVER invent or extrapolate a figure.',
    '- Arithmetic on the given rows is allowed (sums, differences). Show the resulting number in 원 with thousands separators.',
    '- Answer in plain, warm Korean shop language (해요체), 1–5 short sentences. No accounting jargon, no English, no markdown.',
    '- The facts may be truncated (노트에 표시됨). If truncation could change the answer, say the answer may be incomplete.',
    '- confidence: high = directly read off the rows; medium = derived/summed across rows; low = partially answerable or truncation may matter.',
    'Respond with ONLY compact JSON, no prose outside it:',
    '{"answer":"<Korean answer>","confidence":"low"|"medium"|"high","refs":["S1","D2"]}',
    'refs lists ONLY the rows the answer actually rests on (max 12).',
  ].join(' ')
}

export async function askLedger(
  scope: OwnedScope,
  input: { question: string; month?: string | null }
): Promise<DalResult<AskResult>> {
  const question = (input.question ?? '').trim()
  if (!question) return dalErr(400, '질문을 입력해 주세요.')
  if (question.length > ASK_MAX_QUESTION_CHARS) {
    return dalErr(400, `질문은 ${ASK_MAX_QUESTION_CHARS}자 이하로 적어 주세요.`)
  }

  const month =
    input.month && MONTH_RE.test(input.month)
      ? input.month
      : new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 7)
  const range = getMonthDateRange(month)
  if (!range) return dalErr(400, 'month must be YYYY-MM')
  const from = addDaysIso(range.from, -ASK_LOOKBACK_DAYS)
  const to = range.to

  // ── bounded loads (newest first, hard caps — never the whole table) ────────
  const issuersRes = await listIssuers(scope)
  if (!issuersRes.ok) return issuersRes
  const issuers = issuersRes.data
  const issuerName = new Map(issuers.map((i) => [i.id, i.name]))

  const [salesQ, depositsQ, reconsQ, channelsQ] = await Promise.all([
    supabaseAdmin
      .from('sales_records')
      .select('*')
      .eq('user_id', scope.userId)
      .gte('sale_date', from)
      .lte('sale_date', to)
      .order('sale_date', { ascending: false })
      .limit(ASK_MAX_SALES_ROWS + 1),
    supabaseAdmin
      .from('deposit_records')
      .select('*')
      .eq('user_id', scope.userId)
      .gte('deposit_date', from)
      .lte('deposit_date', to)
      .order('deposit_date', { ascending: false })
      .limit(ASK_MAX_DEPOSIT_ROWS + 1),
    supabaseAdmin
      .from('reconciliations')
      .select('*')
      .eq('user_id', scope.userId)
      .order('created_at', { ascending: false })
      .limit(ASK_MAX_RECON_ROWS),
    supabaseAdmin.from('payment_channels').select('*').eq('user_id', scope.userId),
  ])
  if (salesQ.error || depositsQ.error || reconsQ.error || channelsQ.error) {
    console.error(
      '[reconciliation:ask] load error:',
      salesQ.error?.message ?? depositsQ.error?.message ?? reconsQ.error?.message ?? channelsQ.error?.message
    )
    return dalErr(500, 'Database error')
  }

  const salesTruncated = (salesQ.data ?? []).length > ASK_MAX_SALES_ROWS
  const depositsTruncated = (depositsQ.data ?? []).length > ASK_MAX_DEPOSIT_ROWS
  const sales = ((salesQ.data ?? []) as SalesRecord[])
    .filter((s) => s.user_id === scope.userId)
    .slice(0, ASK_MAX_SALES_ROWS)
  const deposits = ((depositsQ.data ?? []) as DepositRecord[])
    .filter((d) => d.user_id === scope.userId)
    .slice(0, ASK_MAX_DEPOSIT_ROWS)
  const recons = ((reconsQ.data ?? []) as Reconciliation[]).filter((r) => r.user_id === scope.userId)
  const channels = ((channelsQ.data ?? []) as PaymentChannel[]).filter((c) => c.user_id === scope.userId)
  const channelById = new Map(channels.map((c) => [c.id, c]))

  // Matches for the loaded recon rows so R-lines can point at S/D refs.
  let matches: ReconciliationMatch[] = []
  if (recons.length > 0) {
    const { data: matchRows, error: matchErr } = await supabaseAdmin
      .from('reconciliation_matches')
      .select('*')
      .in('reconciliation_id', recons.map((r) => r.id))
    if (matchErr) {
      console.error('[reconciliation:ask] match load error:', matchErr.message)
      return dalErr(500, 'Database error')
    }
    matches = (matchRows ?? []) as ReconciliationMatch[]
  }
  const matchesByRecon = new Map<string, ReconciliationMatch[]>()
  for (const m of matches) {
    const list = matchesByRecon.get(m.reconciliation_id) ?? []
    list.push(m)
    matchesByRecon.set(m.reconciliation_id, list)
  }

  // Pending proposals — count + a few lines.
  let proposalCount = 0
  let proposalLines: string[] = []
  const proposalRefs: AskCitation[] = []
  {
    const { data: props, error: propErr } = await supabaseAdmin
      .from('reconciliation_match_proposals')
      .select('id, deposit_record_id, deposit_amount, confidence, agreement, status, created_at')
      .eq('user_id', scope.userId)
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(ASK_MAX_PROPOSAL_ROWS)
    if (propErr) {
      if (propErr.code !== '42P01') {
        console.warn('[reconciliation:ask] proposals load failed:', propErr.message)
      }
    } else {
      const rows = (props ?? []) as {
        id: string
        deposit_record_id: string
        deposit_amount: number
        confidence: string
        agreement: string | null
      }[]
      proposalCount = rows.length
      proposalLines = rows.map((p, i) => {
        const dep = deposits.find((d) => d.id === p.deposit_record_id)
        const line = `P${i + 1} 입금 ${dep ? `${dep.deposit_date} ` : ''}${won(p.deposit_amount)}에 대한 AI 짝 제안 대기중 (신뢰도 ${p.confidence}${p.agreement ? `, 모델 ${p.agreement} 일치` : ''})`
        proposalRefs.push({ ref: `P${i + 1}`, text: line })
        return line
      })
    }
  }

  // ── serialize compact citation rows ────────────────────────────────────────
  const citationByRef = new Map<string, string>()

  const methodKo = (s: SalesRecord): string => {
    if (s.issuer_id) return `카드(${issuerName.get(s.issuer_id) ?? '카드사 미상'})`
    const ch = s.channel_id ? channelById.get(s.channel_id) : undefined
    if (ch) {
      const t = ch.channel_type
      if (t === 'delivery_app') return `배달앱(${ch.name})`
      if (t === 'foreign_pay') return `해외페이(${ch.name})`
      if (t === 'app_voucher') return '앱상품권'
      if (t === 'barcode_pay') return '바코드결제'
      if (t === 'tax_free') return '택스프리'
      if (t === 'transfer') return '계좌이체'
    }
    if (s.sale_kind === 'cash') return '현금'
    if (s.sale_kind === 'paper_voucher') return '지류상품권'
    if (s.sale_kind === 'app_voucher') return '앱상품권'
    if (s.sale_kind === 'card') return '카드(카드사 미상)'
    return '수단 미상'
  }

  const saleLines = sales.map((s, i) => {
    const ref = `S${i + 1}`
    const line =
      `${ref} ${s.sale_date} 매출 ${methodKo(s)} ${won(s.gross_amount)}` +
      (s.gross_amount < 0 ? ' [환불]' : '') +
      (s.discount_amount ? ` (할인 ${won(s.discount_amount)})` : '')
    citationByRef.set(ref, line)
    return line
  })
  const saleRefById = new Map(sales.map((s, i) => [s.id, `S${i + 1}`]))

  const depositLines = deposits.map((d, i) => {
    const ref = `D${i + 1}`
    const line =
      `${ref} ${d.deposit_date} 입금 ${won(d.actual_amount)}` +
      (d.issuer_id ? ` (${issuerName.get(d.issuer_id) ?? '카드사'})` : '') +
      (d.memo ? ` 메모:${d.memo.slice(0, 30)}` : '')
    citationByRef.set(ref, line)
    return line
  })
  const depositRefById = new Map(deposits.map((d, i) => [d.id, `D${i + 1}`]))

  const reconLines = recons.map((r, i) => {
    const ref = `R${i + 1}`
    const ms = matchesByRecon.get(r.id) ?? []
    const sRefs = ms.map((m) => (m.sales_record_id ? saleRefById.get(m.sales_record_id) : null)).filter(Boolean)
    const dRefs = ms
      .map((m) => (m.deposit_record_id ? depositRefById.get(m.deposit_record_id) : null))
      .filter(Boolean)
    const linked = sRefs.length || dRefs.length ? ` [${[...sRefs, ...dRefs].join(',')}]` : ''
    const issuer = r.issuer_id ? ` ${issuerName.get(r.issuer_id) ?? ''}` : ''
    const line =
      `${ref} 대사${issuer}: ${STATUS_KO[r.status] ?? r.status}` +
      (r.discrepancy_amount ? ` 차액 ${won(Math.abs(r.discrepancy_amount))}` : '') +
      (r.discrepancy_reason ? ` — ${r.discrepancy_reason.slice(0, 90)}` : '') +
      linked
    citationByRef.set(ref, line)
    return line
  })
  for (const p of proposalRefs) citationByRef.set(p.ref, p.text)

  // Month totals computed HERE (deterministic), so the model reads instead of adds.
  const inMonth = (d: string): boolean => d >= range.from && d <= range.to
  const monthSales = sales.filter((s) => inMonth(s.sale_date))
  const monthDeposits = deposits.filter((d) => inMonth(d.deposit_date))
  const totalSales = monthSales.reduce((a, s) => a + s.gross_amount, 0)
  const refunds = monthSales.filter((s) => s.gross_amount < 0)
  const totalRefund = refunds.reduce((a, s) => a + s.gross_amount, 0)
  const totalDiscount = monthSales.reduce((a, s) => a + (s.discount_amount ?? 0), 0)
  const totalDeposits = monthDeposits.reduce((a, d) => a + d.actual_amount, 0)

  const issuerLines = issuers.map(
    (i) =>
      `${i.name}: 수수료 ${(i.fee_rate * 100).toFixed(3)}%, 입금까지 보통 ${i.settlement_days}일(+여유 ${i.settlement_window_days}일)`
  )

  const context = [
    `질문: ${question}`,
    '',
    `=== ${month} 장부 요약 (기간 ${range.from}~${range.to}, 매출/입금 행은 ${from}부터 포함) ===`,
    `${month} 매출 합계 ${won(totalSales)} (${monthSales.length}건, 환불 ${refunds.length}건 ${won(totalRefund)}, 할인 합계 ${won(totalDiscount)})`,
    `${month} 입금 합계 ${won(totalDeposits)} (${monthDeposits.length}건)`,
    `확인 대기중 AI 제안 ${proposalCount}건`,
    '',
    `=== 매출 rows (${saleLines.length}건${salesTruncated ? ' — 최근 순으로 잘림, 이전 행 생략됨' : ''}) ===`,
    ...saleLines,
    '',
    `=== 입금 rows (${depositLines.length}건${depositsTruncated ? ' — 최근 순으로 잘림, 이전 행 생략됨' : ''}) ===`,
    ...depositLines,
    '',
    `=== 대사 결과 rows (최근 ${reconLines.length}건) ===`,
    ...reconLines,
    ...(proposalLines.length > 0 ? ['', '=== 확인 대기중 AI 제안 ===', ...proposalLines] : []),
    '',
    '=== 카드사 수수료/입금 소요 (사장님이 등록한 값) ===',
    ...issuerLines,
  ].join('\n')

  // ── one model, one question; fall back to the second slot ─────────────────
  const system = buildSystemPrompt()
  let answer: ModelJsonAnswer | null = null
  for (const spec of ADVISORY_MODELS.slice(0, 2)) {
    const res = await askModelJson(scope, spec, system, context, ASK_MAX_COMPLETION_TOKENS)
    if (res.ok && res.json && typeof res.json === 'object' && !Array.isArray(res.json)) {
      answer = res
      break
    }
  }
  if (!answer) return dalErr(502, 'AI가 지금 답을 만들지 못했어요 — 잠시 후 다시 물어봐 주세요.')

  const parsed = answer.json as Record<string, unknown>
  const text = typeof parsed.answer === 'string' ? parsed.answer.trim() : ''
  if (!text) return dalErr(502, 'AI 응답을 읽지 못했어요 — 다시 물어봐 주세요.')
  const confidence = (ADVISORY_CONFIDENCES as readonly string[]).includes(String(parsed.confidence))
    ? (parsed.confidence as AdvisoryConfidence)
    : 'low'
  const refs = Array.isArray(parsed.refs)
    ? parsed.refs
        .filter((r): r is string => typeof r === 'string')
        .slice(0, 12)
        .filter((r) => citationByRef.has(r)) // hallucinated refs are dropped
    : []

  return dalOk({
    answer: text,
    confidence,
    citations: refs.map((ref) => ({ ref, text: citationByRef.get(ref)! })),
    month,
    from,
    to,
    model: answer.model,
    bounds: {
      sales_rows: sales.length,
      deposit_rows: deposits.length,
      recon_rows: recons.length,
      proposal_rows: proposalCount,
      sales_truncated: salesTruncated,
      deposits_truncated: depositsTruncated,
    },
  })
}
