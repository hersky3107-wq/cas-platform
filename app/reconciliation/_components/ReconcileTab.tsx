'use client'

/**
 * 대사 — "판 돈이 통장에 들어왔나?"만 다루는 화면.
 *
 * - 나중에 들어오는 돈만 나온다: 카드(카드사별) · 앱상품권 · 바코드 · 배달앱 ·
 *   알리·위챗 · 택스프리. 현금/계좌이체/종이상품권은 여기 절대 안 나온다
 *   (정산 탭 소관). 엔진이 새로 만들지도 않고, 화면도 카드사·대사방법이 없는
 *   과거 행은 걸러낸다.
 * - 카드사별로 묶어서 보여준다: "NH: 9/1 매출 31,500 → 9/3 입금 31,453 (수수료 47)".
 * - AI 제안 카드가 맨 위 — 자동 대사가 못 푼 입금에 대해 AI 여러 개가 낸 답,
 *   근거, 몇 개가 같은 답인지까지 보여주고 사장님이 승인/수정/거절한다.
 *   승인 없이 확정되는 일은 없다.
 */

import { useMemo, useState } from 'react'
import {
  RECONCILED_METHOD_CODES,
  type CardIssuer,
  type DepositRecord,
  type DiscrepancyAdvisory,
  type ReconciliationWithMatches,
  type SalesRecord,
} from '@/lib/reconciliation/types'
import {
  agreementKo,
  apiJson,
  BADGE_AI,
  BTN_GHOST,
  BTN_PRIMARY,
  CARD,
  CONFIDENCE_BADGE,
  confidenceKo,
  dateKo,
  ERROR_TEXT,
  INPUT,
  METHOD_KO,
  STATUS_BADGE,
  STATUS_BADGE_DEFAULT,
  STATUS_KO,
  won,
  type ProposalView,
} from '../_lib/ui'

/* ── AI 제안 카드 ─────────────────────────────────────────────────────────── */

function ProposalCard({
  proposal,
  issuers,
  onDecided,
}: {
  proposal: ProposalView
  issuers: CardIssuer[]
  onDecided: () => void
}) {
  const [checked, setChecked] = useState<Set<string>>(new Set(proposal.proposed_sale_ids))
  const [busy, setBusy] = useState<'approve' | 'reject' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [rejecting, setRejecting] = useState(false)
  const [note, setNote] = useState('')
  const [correctedIssuer, setCorrectedIssuer] = useState('')

  const votes = proposal.per_model ?? []
  const votesDisagree =
    votes.length > 1 &&
    new Set(votes.map((v) => JSON.stringify([...v.sale_ids].sort()))).size > 1

  const toggle = (id: string) => {
    setChecked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const approve = async () => {
    setBusy('approve')
    setError(null)
    try {
      const ids = [...checked]
      const edited =
        JSON.stringify(ids.sort()) !== JSON.stringify([...proposal.proposed_sale_ids].sort())
      await apiJson(`/api/reconciliation/proposals/${proposal.id}`, {
        method: 'POST',
        json: { action: 'approve', ...(edited ? { sale_ids: ids } : {}) },
      })
      onDecided()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setBusy(null)
    }
  }

  const reject = async () => {
    setBusy('reject')
    setError(null)
    try {
      await apiJson(`/api/reconciliation/proposals/${proposal.id}`, {
        method: 'POST',
        json: {
          action: 'reject',
          note: note.trim() || null,
          corrected_issuer_id: correctedIssuer || null,
        },
      })
      onDecided()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setBusy(null)
    }
  }

  const dep = proposal.deposit
  const checkedTotal = proposal.proposed_sales
    .filter((s) => checked.has(s.id))
    .reduce((a, s) => a + s.gross_amount, 0)

  return (
    <li className="rounded-2xl border border-sky-300 bg-sky-50/50 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className={BADGE_AI}>AI 제안 — 확정 아님</span>
        <span className={CONFIDENCE_BADGE[proposal.confidence]}>믿을만함: {confidenceKo(proposal.confidence)}</span>
        {agreementKo(proposal.agreement) ? (
          <span className="text-xs font-semibold text-sky-800">{agreementKo(proposal.agreement)}</span>
        ) : null}
      </div>

      <p className="mt-2.5 text-[15px] font-bold text-slate-900">
        {dep ? (
          <>
            {dateKo(dep.deposit_date)} 입금 {won(dep.actual_amount)}
            {proposal.issuer_name ? ` (${proposal.issuer_name})` : ''}
            {dep.memo ? <span className="ml-1 text-xs font-normal text-slate-500">메모 {dep.memo}</span> : null}
          </>
        ) : (
          `입금 ${won(proposal.deposit_amount)}`
        )}
      </p>
      <p className="mt-0.5 text-sm text-slate-600">이 입금이 아래 매출들 돈 같아요:</p>

      <ul className="mt-2 space-y-1.5">
        {proposal.proposed_sales.map((s) => (
          <li key={s.id}>
            <label className="flex min-h-10 cursor-pointer items-center gap-2.5 rounded-lg bg-white px-3 py-1.5">
              <input
                type="checkbox"
                checked={checked.has(s.id)}
                onChange={() => toggle(s.id)}
                className="h-5 w-5 rounded border-slate-300"
              />
              <span className="text-sm font-medium text-slate-800">
                {dateKo(s.sale_date)} 매출 {won(s.gross_amount)}
                {s.gross_amount < 0 ? ' (환불)' : ''}
              </span>
            </label>
          </li>
        ))}
      </ul>

      <p className="mt-2 text-xs leading-relaxed text-slate-600">
        고른 매출 합 {won(checkedTotal)}
        {proposal.expected_net_total != null ? <> · 수수료 빼면 약 {won(proposal.expected_net_total)}</> : null}
        {' · '}입금 {won(proposal.deposit_amount)}
        {proposal.residual_won != null && Math.abs(proposal.residual_won) > 0 ? (
          <> · 차이 {won(Math.abs(proposal.residual_won))}</>
        ) : null}
      </p>

      {proposal.reasoning ? (
        <p className="mt-2 rounded-lg bg-white/80 px-3 py-2 text-sm leading-relaxed text-slate-700">
          {proposal.reasoning}
        </p>
      ) : null}

      {votesDisagree ? (
        <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
          <p className="text-xs font-bold text-amber-800">AI끼리 답이 갈렸어요 — 각자 이렇게 봤어요:</p>
          <ul className="mt-1.5 space-y-1.5">
            {votes.map((v, i) => (
              <li key={v.model} className="text-xs leading-relaxed text-slate-700">
                <span className="font-semibold text-slate-500">AI {i + 1}</span> → 매출 {v.sale_ids.length}건 (믿을만함{' '}
                {confidenceKo(v.confidence)}) {v.reasoning ? `· ${v.reasoning.slice(0, 120)}` : ''}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {error ? <p className={ERROR_TEXT}>{error}</p> : null}

      {!rejecting ? (
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            className={`${BTN_PRIMARY} flex-1`}
            disabled={busy != null || checked.size === 0}
            onClick={() => void approve()}
          >
            {busy === 'approve' ? '확인 중…' : '맞아요, 이대로 확인'}
          </button>
          <button type="button" className={BTN_GHOST} disabled={busy != null} onClick={() => setRejecting(true)}>
            아니에요
          </button>
        </div>
      ) : (
        <div className="mt-3 rounded-xl border border-slate-200 bg-white p-3">
          <p className="text-sm font-semibold text-slate-800">왜 아닌지 알려주시면 다음엔 더 잘 맞춰요 (선택)</p>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="예: 이건 8월 말 매출 돈이에요"
            className={`${INPUT} mt-2 text-sm`}
          />
          <select
            value={correctedIssuer}
            onChange={(e) => setCorrectedIssuer(e.target.value)}
            className={`${INPUT} mt-2 text-sm`}
          >
            <option value="">카드사는 맞아요 / 모르겠어요</option>
            {issuers
              .filter((i) => i.is_active)
              .map((i) => (
                <option key={i.id} value={i.id}>
                  사실 이 입금은 {i.name} 거예요
                </option>
              ))}
          </select>
          <div className="mt-2 flex gap-2">
            <button type="button" className={`${BTN_PRIMARY} flex-1`} disabled={busy != null} onClick={() => void reject()}>
              {busy === 'reject' ? '기록 중…' : '거절하기'}
            </button>
            <button type="button" className={BTN_GHOST} disabled={busy != null} onClick={() => setRejecting(false)}>
              돌아가기
            </button>
          </div>
        </div>
      )}
    </li>
  )
}

/* ── 대사 결과 한 줄 ──────────────────────────────────────────────────────── */

function ResultLine({
  result,
  salesById,
  depositsById,
}: {
  result: ReconciliationWithMatches
  salesById: Map<string, SalesRecord>
  depositsById: Map<string, DepositRecord>
}) {
  const [advisory, setAdvisory] = useState<DiscrepancyAdvisory | null>(result.discrepancy_advisory)
  const [explaining, setExplaining] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const sales = result.matches
    .map((m) => (m.sales_record_id ? salesById.get(m.sales_record_id) : undefined))
    .filter((s): s is SalesRecord => s != null)
  const deposits = result.matches
    .map((m) => (m.deposit_record_id ? depositsById.get(m.deposit_record_id) : undefined))
    .filter((d): d is DepositRecord => d != null)

  const grossTotal = sales.reduce((a, s) => a + s.gross_amount, 0)
  const depositTotal = deposits.reduce((a, d) => a + d.actual_amount, 0)

  const saleSide =
    sales.length === 0
      ? null
      : sales.length === 1
        ? `${dateKo(sales[0]!.sale_date)} 매출 ${won(sales[0]!.gross_amount)}`
        : `${dateKo(sales[sales.length - 1]!.sale_date)}~${dateKo(sales[0]!.sale_date)} 매출 ${sales.length}건 ${won(grossTotal)}`
  const depositSide =
    deposits.length === 0
      ? null
      : deposits.length === 1
        ? `${dateKo(deposits[0]!.deposit_date)} 입금 ${won(deposits[0]!.actual_amount)}`
        : `입금 ${deposits.length}건 ${won(depositTotal)}`

  let line: string
  if (result.status === 'matched' && saleSide && depositSide) {
    const fee = grossTotal - depositTotal
    line = `${saleSide} → ${depositSide}${fee !== 0 ? ` (수수료 ${won(fee)})` : ''}`
  } else if (result.status === 'missing_deposit' && saleSide) {
    const expected = result.discrepancy_amount != null ? Math.abs(result.discrepancy_amount) : null
    line = `${saleSide} → 아직 안 들어옴${expected != null ? ` · 들어올 돈 약 ${won(expected)}` : ''}`
  } else if (result.status === 'unmatched_deposit' && depositSide) {
    line = `${depositSide} → 어떤 매출 돈인지 아직 몰라요`
  } else if (result.status === 'amount_mismatch' && saleSide && depositSide) {
    const diff = result.discrepancy_amount != null ? Math.abs(result.discrepancy_amount) : null
    line = `${saleSide} → ${depositSide}${diff != null ? ` · ${won(diff)} 차이` : ''}`
  } else {
    line = result.discrepancy_reason ?? STATUS_KO[result.status] ?? result.status
  }

  const explain = async () => {
    setExplaining(true)
    setError(null)
    try {
      const res = await apiJson<{ advisory?: DiscrepancyAdvisory } & Record<string, unknown>>(
        '/api/reconciliation/explain-discrepancy',
        { method: 'POST', json: { reconciliation_id: result.id } }
      )
      const adv =
        (res.advisory as DiscrepancyAdvisory | undefined) ??
        ((res as { discrepancy_advisory?: DiscrepancyAdvisory }).discrepancy_advisory ?? null)
      setAdvisory(adv)
      if (!adv) setError('설명을 받지 못했어요 — 잠시 후 다시 시도해 주세요.')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setExplaining(false)
    }
  }

  return (
    <li className="py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className={STATUS_BADGE[result.status] ?? STATUS_BADGE_DEFAULT}>
          {STATUS_KO[result.status] ?? result.status}
        </span>
        {result.source === 'ai_confirmed' ? <span className={BADGE_AI}>AI 제안을 사장님이 승인</span> : null}
      </div>
      <p className="mt-1 text-sm leading-relaxed text-slate-800">{line}</p>

      {result.status === 'amount_mismatch' ? (
        <div className="mt-1.5">
          {advisory ? (
            <div className="rounded-lg border border-indigo-200 bg-indigo-50/60 px-3 py-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className={BADGE_AI}>AI 추정 원인</span>
                <span className={CONFIDENCE_BADGE[advisory.final_confidence ?? advisory.confidence]}>
                  믿을만함: {confidenceKo(advisory.final_confidence ?? advisory.confidence)}
                </span>
                {agreementKo(advisory.agreement) ? (
                  <span className="text-[11px] font-semibold text-indigo-800">{agreementKo(advisory.agreement)}</span>
                ) : null}
              </div>
              <p className="mt-1 text-sm font-medium text-slate-800">
                {advisory.consensus_cause ?? advisory.estimated_cause}
              </p>
              <p className="mt-0.5 text-xs leading-relaxed text-slate-600">{advisory.reasoning}</p>
            </div>
          ) : (
            <button
              type="button"
              className="text-xs font-semibold text-indigo-700 underline underline-offset-2"
              disabled={explaining}
              onClick={() => void explain()}
            >
              {explaining ? 'AI가 살펴보는 중…' : '왜 다른지 AI에게 물어보기'}
            </button>
          )}
          {error ? <p className="mt-1 text-xs font-medium text-rose-700">{error}</p> : null}
        </div>
      ) : null}
    </li>
  )
}

/* ── 탭 본체 ──────────────────────────────────────────────────────────────── */

const STATUS_ORDER: Record<string, number> = {
  amount_mismatch: 0,
  missing_deposit: 1,
  unmatched_deposit: 2,
  date_anomaly: 3,
  matched: 4,
}

export default function ReconcileTab({
  results,
  proposals,
  issuers,
  salesById,
  depositsById,
  month,
  onChanged,
  onRunPipeline,
  busyLabel,
}: {
  results: ReconciliationWithMatches[]
  proposals: ProposalView[]
  issuers: CardIssuer[]
  salesById: Map<string, SalesRecord>
  depositsById: Map<string, DepositRecord>
  month: string
  onChanged: () => void
  onRunPipeline: () => void
  busyLabel: string | null
}) {
  const issuerNameById = useMemo(() => new Map(issuers.map((i) => [i.id, i.name])), [issuers])

  // 대사 화면 자격: 카드사(카드)거나, 대사 대상 방법이거나. 현금/이체/종이상품권과
  // 어느 쪽도 아닌 옛날 행은 여기 안 나온다.
  const visible = useMemo(() => {
    const inMonth = (r: ReconciliationWithMatches): boolean => {
      const dates: string[] = []
      for (const m of r.matches) {
        const s = m.sales_record_id ? salesById.get(m.sales_record_id) : undefined
        const d = m.deposit_record_id ? depositsById.get(m.deposit_record_id) : undefined
        if (s) dates.push(s.sale_date)
        if (d) dates.push(d.deposit_date)
      }
      if (dates.length === 0) return true // 날짜를 모르면 숨기지 않는다
      return dates.some((d) => d.startsWith(month))
    }
    return results.filter((r) => {
      const reconciled =
        r.issuer_id != null ||
        (r.method_code != null && (RECONCILED_METHOD_CODES as readonly string[]).includes(r.method_code))
      if (!reconciled) return false
      // 문제 행은 달과 무관하게 항상, 확인됨은 이번 달 것만.
      return r.status === 'matched' ? inMonth(r) : true
    })
  }, [results, salesById, depositsById, month])

  const groups = useMemo(() => {
    const map = new Map<string, ReconciliationWithMatches[]>()
    for (const r of visible) {
      const label = r.issuer_id
        ? (issuerNameById.get(r.issuer_id) ?? '카드')
        : (METHOD_KO[r.method_code ?? ''] ?? r.method_code ?? '기타')
      const list = map.get(label) ?? []
      list.push(r)
      map.set(label, list)
    }
    for (const list of map.values()) {
      list.sort(
        (a, b) => (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9) || b.created_at.localeCompare(a.created_at)
      )
    }
    // 문제가 있는 묶음 먼저.
    return [...map.entries()].sort((a, b) => {
      const worst = (list: ReconciliationWithMatches[]) => Math.min(...list.map((r) => STATUS_ORDER[r.status] ?? 9))
      return worst(a[1]) - worst(b[1]) || a[0].localeCompare(b[0], 'ko')
    })
  }, [visible, issuerNameById])

  const counts = useMemo(() => {
    const c = { matched: 0, missing_deposit: 0, amount_mismatch: 0, unmatched_deposit: 0 }
    for (const r of visible) {
      if (r.status in c) c[r.status as keyof typeof c]++
    }
    return c
  }, [visible])

  return (
    <div className="flex flex-col gap-4">
      {/* 실행 줄 */}
      <section className={CARD}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-slate-900">입금 확인 (대사)</h2>
            <p className="mt-0.5 text-xs leading-relaxed text-slate-500">
              카드·앱상품권·바코드·배달앱·알리위챗·택스프리처럼 <b>나중에 들어오는 돈</b>만 여기서 맞춰요.
              현금·계좌이체·종이상품권은 「정산」에 있어요.
            </p>
          </div>
          <button type="button" className={BTN_PRIMARY} disabled={busyLabel != null} onClick={onRunPipeline}>
            {busyLabel ?? '지금 맞춰보기'}
          </button>
        </div>
        <div className="mt-3 flex flex-wrap gap-2 text-xs font-semibold">
          <span className={STATUS_BADGE.matched}>확인됨 {counts.matched}</span>
          <span className={STATUS_BADGE.missing_deposit}>아직 안 들어옴 {counts.missing_deposit}</span>
          <span className={STATUS_BADGE.amount_mismatch}>금액 다름 {counts.amount_mismatch}</span>
          <span className={STATUS_BADGE.unmatched_deposit}>주인 모를 입금 {counts.unmatched_deposit}</span>
          {proposals.length > 0 ? <span className={BADGE_AI}>AI 제안 {proposals.length}건 대기</span> : null}
        </div>
      </section>

      {/* AI 제안 — 화면의 중심 */}
      {proposals.length > 0 ? (
        <section>
          <h3 className="mb-2 px-1 text-sm font-bold text-slate-900">AI 제안 — 사장님 확인이 필요해요</h3>
          <ul className="space-y-3">
            {proposals.map((p) => (
              <ProposalCard key={p.id} proposal={p} issuers={issuers} onDecided={onChanged} />
            ))}
          </ul>
        </section>
      ) : null}

      {/* 카드사/방법별 결과 */}
      {groups.length === 0 ? (
        <section className={CARD}>
          <p className="text-sm leading-relaxed text-slate-500">
            아직 맞춘 결과가 없어요. 「넣기」에서 매출과 입금을 넣으면 자동으로 맞춰드려요.
          </p>
        </section>
      ) : (
        groups.map(([label, list]) => (
          <section key={label} className={CARD}>
            <h3 className="text-sm font-bold text-slate-900">
              {label} <span className="font-normal text-slate-400">({list.length}건)</span>
            </h3>
            <ul className="mt-1 divide-y divide-slate-100">
              {list.map((r) => (
                <ResultLine key={r.id} result={r} salesById={salesById} depositsById={depositsById} />
              ))}
            </ul>
          </section>
        ))
      )}
      <p className="px-1 text-[11px] leading-relaxed text-slate-400">
        「확인됨」은 이번 달 것만 보여요. 「AI 제안」과 문제 있는 건은 달과 상관없이 다 보여요.
      </p>
    </div>
  )
}
