'use client'

/**
 * 정산 — "이번 달 진짜 얼마 팔았고, 빠진 것 없나?"의 화면.
 *
 * 현금·계좌이체·종이상품권까지 전부 포함한다 (대사 화면과 반대).
 * 월 선택, 월 합계, 결제방법별·카드사별 나눔, 할인 합계, 환불은 빨간
 * 마이너스 줄로. 종이상품권은 은행에 언제 넣을지 사장님 마음이라
 * "입금 대기" 금액을 따로 보여준다.
 */

import { useMemo, useState } from 'react'
import type {
  CardIssuer,
  DepositRecord,
  MonthlyReconciliationSummary,
  PaymentChannel,
  SalesRecord,
} from '@/lib/reconciliation/types'
import {
  apiJson,
  BTN_GHOST,
  CARD,
  dateKo,
  ERROR_TEXT,
  METHOD_KO,
  won,
} from '../_lib/ui'

/** 매출 한 건의 결제방법 라벨 — 카드사(카드) > 채널 유형 > 옛 sale_kind 순서로 판단. */
function methodLabelOf(
  s: SalesRecord,
  issuerNameById: Map<string, string>,
  channelById: Map<string, PaymentChannel>
): { group: string; sub: string | null } {
  if (s.issuer_id) return { group: '카드', sub: issuerNameById.get(s.issuer_id) ?? '카드사 미상' }
  const ch = s.channel_id ? channelById.get(s.channel_id) : undefined
  if (ch && METHOD_KO[ch.channel_type]) {
    if (ch.channel_type === 'card') return { group: '카드', sub: '카드사 미상' }
    return { group: METHOD_KO[ch.channel_type]!, sub: null }
  }
  if (s.sale_kind === 'card') return { group: '카드', sub: '카드사 미상' }
  if (METHOD_KO[s.sale_kind]) return { group: METHOD_KO[s.sale_kind]!, sub: null }
  return { group: '직접 적음', sub: null }
}

export default function ClosingTab({
  month,
  onMonthChange,
  summary,
  monthSales,
  monthDeposits,
  issuers,
  channels,
  currentMonth,
  onChanged,
}: {
  month: string
  onMonthChange: (m: string) => void
  summary: MonthlyReconciliationSummary | null
  monthSales: SalesRecord[]
  monthDeposits: DepositRecord[]
  issuers: CardIssuer[]
  channels: PaymentChannel[]
  currentMonth: string
  onChanged: () => void
}) {
  const [showAll, setShowAll] = useState(false)
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const issuerNameById = useMemo(() => new Map(issuers.map((i) => [i.id, i.name])), [issuers])
  const channelById = useMemo(() => new Map(channels.map((c) => [c.id, c])), [channels])

  const breakdown = useMemo(() => {
    const groups = new Map<string, { amount: number; count: number; subs: Map<string, { amount: number; count: number }> }>()
    for (const s of monthSales) {
      const { group, sub } = methodLabelOf(s, issuerNameById, channelById)
      const g = groups.get(group) ?? { amount: 0, count: 0, subs: new Map() }
      g.amount += s.gross_amount
      g.count += 1
      if (sub) {
        const sb = g.subs.get(sub) ?? { amount: 0, count: 0 }
        sb.amount += s.gross_amount
        sb.count += 1
        g.subs.set(sub, sb)
      }
      groups.set(group, g)
    }
    return [...groups.entries()].sort((a, b) => b[1].amount - a[1].amount)
  }, [monthSales, issuerNameById, channelById])

  const refunds = useMemo(() => monthSales.filter((s) => s.gross_amount < 0), [monthSales])
  const refundTotal = refunds.reduce((a, s) => a + s.gross_amount, 0)

  const deleteSale = async (id: string) => {
    setDeletingId(id)
    setError(null)
    try {
      await apiJson(`/api/reconciliation/sales/${id}`, { method: 'DELETE' })
      setConfirmingId(null)
      onChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setDeletingId(null)
    }
  }

  const sortedSales = useMemo(
    () => [...monthSales].sort((a, b) => b.sale_date.localeCompare(a.sale_date)),
    [monthSales]
  )

  return (
    <div className="flex flex-col gap-4">
      {/* 월 선택 */}
      <section className={CARD}>
        <div className="flex items-center justify-between gap-2">
          <button type="button" className={BTN_GHOST} onClick={() => onMonthChange(shift(month, -1))} aria-label="지난달">
            ←
          </button>
          <div className="text-center">
            <p className="text-lg font-bold tracking-tight text-slate-900">
              {Number(month.slice(0, 4))}년 {Number(month.slice(5))}월
            </p>
            {month !== currentMonth ? (
              <button
                type="button"
                className="text-xs font-semibold text-slate-500 underline underline-offset-2"
                onClick={() => onMonthChange(currentMonth)}
              >
                이번 달로
              </button>
            ) : (
              <p className="text-xs text-slate-400">이번 달</p>
            )}
          </div>
          <button type="button" className={BTN_GHOST} onClick={() => onMonthChange(shift(month, 1))} aria-label="다음달">
            →
          </button>
        </div>

        {/* 합계 타일 */}
        <div className="mt-4 grid grid-cols-2 gap-2.5">
          <div className="rounded-xl border border-slate-100 bg-slate-50 p-3.5">
            <p className="text-xs font-semibold text-slate-500">이번 달 판 돈</p>
            <p className="mt-1 text-xl font-bold tracking-tight text-slate-900">
              {summary ? won(summary.total_sales) : '—'}
            </p>
          </div>
          <div className="rounded-xl border border-slate-100 bg-slate-50 p-3.5">
            <p className="text-xs font-semibold text-slate-500">통장에 들어온 돈</p>
            <p className="mt-1 text-xl font-bold tracking-tight text-slate-900">
              {summary ? won(summary.deposits.total_amount) : '—'}
            </p>
          </div>
          <div className="rounded-xl border border-slate-100 bg-slate-50 p-3.5">
            <p className="text-xs font-semibold text-slate-500">할인해 준 것</p>
            <p className="mt-1 text-xl font-bold tracking-tight text-slate-900">
              {summary ? won(summary.total_discount) : '—'}
            </p>
          </div>
          <div className="rounded-xl border border-slate-100 bg-slate-50 p-3.5">
            <p className="text-xs font-semibold text-slate-500">환불해 준 것</p>
            <p className={`mt-1 text-xl font-bold tracking-tight ${refundTotal < 0 ? 'text-rose-700' : 'text-slate-900'}`}>
              {refundTotal < 0 ? won(refundTotal) : '없음'}
            </p>
          </div>
        </div>

        {summary && summary.paper_voucher_pending_amount > 0 ? (
          <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800">
            종이상품권 {won(summary.paper_voucher_pending_amount)}은 아직 은행에 안 넣은 걸로 보여요 — 넣으실 때
            입금으로 잡히면 돼요.
          </p>
        ) : null}
      </section>

      {/* 방법별 · 카드사별 */}
      <section className={CARD}>
        <h3 className="text-sm font-bold text-slate-900">무엇으로 팔았나</h3>
        {breakdown.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">이 달에 넣은 매출이 없어요.</p>
        ) : (
          <ul className="mt-2 space-y-1.5">
            {breakdown.map(([label, g]) => (
              <li key={label} className="rounded-xl bg-slate-50 px-3 py-2.5">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-semibold text-slate-800">{label}</span>
                  <span className={`font-bold tabular-nums ${g.amount < 0 ? 'text-rose-700' : 'text-slate-900'}`}>
                    {won(g.amount)} <span className="text-xs font-normal text-slate-500">({g.count}건)</span>
                  </span>
                </div>
                {g.subs.size > 0 ? (
                  <ul className="mt-1.5 space-y-1 border-t border-slate-200/70 pt-1.5">
                    {[...g.subs.entries()]
                      .sort((a, b) => b[1].amount - a[1].amount)
                      .map(([sub, v]) => (
                        <li key={sub} className="flex items-center justify-between text-xs text-slate-600">
                          <span>{sub}</span>
                          <span className={`tabular-nums font-semibold ${v.amount < 0 ? 'text-rose-700' : ''}`}>
                            {won(v.amount)} ({v.count}건)
                          </span>
                        </li>
                      ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {refunds.length > 0 ? (
          <div className="mt-3 border-t border-slate-100 pt-3">
            <h4 className="text-xs font-bold text-rose-700">환불 {refunds.length}건</h4>
            <ul className="mt-1 space-y-0.5">
              {refunds.map((r) => (
                <li key={r.id} className="flex items-center justify-between text-xs text-slate-600">
                  <span>
                    {dateKo(r.sale_date)} {methodLabelOf(r, issuerNameById, channelById).sub ?? methodLabelOf(r, issuerNameById, channelById).group}
                  </span>
                  <span className="font-semibold tabular-nums text-rose-700">{won(r.gross_amount)}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      {/* 전체 내역 (접힘) */}
      <section className={CARD}>
        <button
          type="button"
          className="flex w-full items-center justify-between text-left"
          onClick={() => setShowAll((v) => !v)}
        >
          <h3 className="text-sm font-bold text-slate-900">
            이 달 전체 내역 <span className="font-normal text-slate-400">(매출 {monthSales.length} · 입금 {monthDeposits.length})</span>
          </h3>
          <span className="text-slate-400">{showAll ? '접기 ▲' : '펼치기 ▼'}</span>
        </button>
        {error ? <p className={ERROR_TEXT}>{error}</p> : null}
        {showAll ? (
          <div className="mt-3 space-y-4">
            <div>
              <h4 className="text-xs font-bold uppercase tracking-wide text-slate-500">매출</h4>
              <ul className="mt-1 divide-y divide-slate-100">
                {sortedSales.map((s) => (
                  <li key={s.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                    <span className="text-slate-500">{dateKo(s.sale_date)}</span>
                    <span className={`font-semibold tabular-nums ${s.gross_amount < 0 ? 'text-rose-700' : 'text-slate-900'}`}>
                      {won(s.gross_amount)}
                    </span>
                    <span className="text-xs text-slate-500">
                      {(() => {
                        const m = methodLabelOf(s, issuerNameById, channelById)
                        return m.sub ? `${m.group}·${m.sub}` : m.group
                      })()}
                    </span>
                    {s.discount_amount ? (
                      <span className="text-xs text-slate-400">할인 {won(s.discount_amount)}</span>
                    ) : null}
                    <span className="ml-auto">
                      {confirmingId === s.id ? (
                        <span className="flex gap-1.5">
                          <button
                            type="button"
                            className="rounded-lg bg-rose-600 px-2.5 py-1 text-xs font-bold text-white disabled:opacity-50"
                            disabled={deletingId === s.id}
                            onClick={() => void deleteSale(s.id)}
                          >
                            {deletingId === s.id ? '지우는 중…' : '정말 지우기'}
                          </button>
                          <button
                            type="button"
                            className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-semibold text-slate-600"
                            onClick={() => setConfirmingId(null)}
                          >
                            취소
                          </button>
                        </span>
                      ) : (
                        <button
                          type="button"
                          className="text-xs font-semibold text-slate-400 underline underline-offset-2"
                          onClick={() => setConfirmingId(s.id)}
                        >
                          지우기
                        </button>
                      )}
                    </span>
                  </li>
                ))}
                {sortedSales.length === 0 ? <li className="py-2 text-sm text-slate-400">없음</li> : null}
              </ul>
            </div>
            <div>
              <h4 className="text-xs font-bold uppercase tracking-wide text-slate-500">입금</h4>
              <ul className="mt-1 divide-y divide-slate-100">
                {[...monthDeposits]
                  .sort((a, b) => b.deposit_date.localeCompare(a.deposit_date))
                  .map((d) => (
                    <li key={d.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                      <span className="text-slate-500">{dateKo(d.deposit_date)}</span>
                      <span className="font-semibold tabular-nums text-slate-900">{won(d.actual_amount)}</span>
                      {d.issuer_id ? (
                        <span className="text-xs text-slate-500">{issuerNameById.get(d.issuer_id) ?? ''}</span>
                      ) : null}
                      {d.memo ? <span className="text-xs text-slate-400">{d.memo}</span> : null}
                    </li>
                  ))}
                {monthDeposits.length === 0 ? <li className="py-2 text-sm text-slate-400">없음</li> : null}
              </ul>
            </div>
          </div>
        ) : null}
      </section>
    </div>
  )
}

function shift(monthStr: string, delta: number): string {
  const [y, m] = monthStr.split('-').map(Number)
  if (!y || !m) return monthStr
  const date = new Date(Date.UTC(y, m - 1 + delta, 1))
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}
