'use client'

/**
 * 가게 장부 — Part-B 전면 재설계 화면.
 *
 * 실제 사용자(옷가게 사장님)의 스펙: "개떡같이 줘도 찰떡같이 알아먹고,
 * 알아서 분류하고, 기억해라. 나는 몇 칸만 친다."
 *
 * 세 구역 + AI 두 표면:
 *   넣기   — 상자 하나. 붙여넣기/사진/엑셀 → AI(2모델 교차확인)가 분류 →
 *            틀린 것만 고쳐 저장 → 자동으로 대사 파이프라인이 돈다.
 *   대사   — 나중에 들어오는 돈만(카드사별 묶음). 현금·이체·종이상품권은
 *            절대 안 나온다. AI 제안 카드가 중심: 승인/수정/거절은 사장님만.
 *   정산   — 전부 다(현금·이체·종이상품권 포함). 월 합계와 나눔.
 *   물어보기 — 상단 상자. 실제 데이터 안에서만 답하고 근거 행을 보여준다.
 *
 * 데이터 로딩은 전부 비동기 콜백에서 setState (react-hooks/set-state-in-effect
 * 에러 2건은 이 재작성으로 제거 — 동기 setState가 이펙트 본문에 없다).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '@/lib/db/supabase'
import { getMonthDateRange } from '@/lib/reconciliation/summary'
import type {
  CardIssuer,
  DepositRecord,
  MonthlyReconciliationSummary,
  PaymentChannel,
  ReconciliationWithMatches,
  SalesRecord,
} from '@/lib/reconciliation/types'
import AskBox from './_components/AskBox'
import IngestTab from './_components/IngestTab'
import ReconcileTab from './_components/ReconcileTab'
import ClosingTab from './_components/ClosingTab'
import {
  addDaysIsoClient,
  apiJson,
  BADGE_AI,
  CARD,
  currentMonthString,
  ERROR_TEXT,
  type EngineSummaryView,
  type ProposalView,
} from './_lib/ui'

/** 대사 줄을 그리는 데 필요한 매출/입금을 달 앞뒤로 이만큼 넓게 불러온다. */
const WIDE_WINDOW_DAYS = 45

type Tab = 'ingest' | 'recon' | 'close'

type LedgerData = {
  issuers: CardIssuer[]
  channels: PaymentChannel[]
  sales: SalesRecord[]
  deposits: DepositRecord[]
  results: ReconciliationWithMatches[]
  proposals: ProposalView[]
  summary: MonthlyReconciliationSummary | null
}

async function fetchLedger(month: string): Promise<LedgerData> {
  const range = getMonthDateRange(month)
  const from = range ? addDaysIsoClient(range.from, -WIDE_WINDOW_DAYS) : ''
  const to = range ? addDaysIsoClient(range.to, WIDE_WINDOW_DAYS) : ''
  const span = range ? `?from=${from}&to=${to}` : ''
  const [issuers, channels, sales, deposits, results, proposals, summary] = await Promise.all([
    apiJson<CardIssuer[]>('/api/reconciliation/issuers'),
    apiJson<PaymentChannel[]>('/api/reconciliation/channels'),
    apiJson<SalesRecord[]>(`/api/reconciliation/sales${span}`),
    apiJson<DepositRecord[]>(`/api/reconciliation/deposits${span}`),
    apiJson<ReconciliationWithMatches[]>('/api/reconciliation/results'),
    apiJson<ProposalView[]>('/api/reconciliation/proposals?status=pending').catch((e) => {
      // 제안 테이블 마이그레이션 전이라도 나머지 화면은 살아 있어야 한다.
      console.warn('[장부] proposals load failed:', e)
      return [] as ProposalView[]
    }),
    apiJson<MonthlyReconciliationSummary>(`/api/reconciliation/summary?month=${month}`),
  ])
  return { issuers, channels, sales, deposits, results, proposals, summary }
}

export default function ReconciliationPage() {
  const [userId, setUserId] = useState<string | null>(null)
  const [authLoading, setAuthLoading] = useState(true)

  const [tab, setTab] = useState<Tab>('ingest')
  const [month, setMonth] = useState<string>(currentMonthString)
  const [data, setData] = useState<LedgerData | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  const [busyLabel, setBusyLabel] = useState<string | null>(null)
  const [pipelineError, setPipelineError] = useState<string | null>(null)
  const pipelineRunning = useRef(false)

  /* ── 인증: 구독 콜백에서만 setState (기존 패턴 유지) ─────────────────── */
  useEffect(() => {
    let cancelled = false
    async function init() {
      const { data: authData } = await supabase.auth.getUser()
      if (cancelled) return
      setUserId(authData.user?.id ?? null)
      setAuthLoading(false)
    }
    void init()
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUserId(session?.user?.id ?? null)
    })
    return () => {
      cancelled = true
      subscription.unsubscribe()
    }
  }, [])

  /* ── 데이터: await 뒤에만 setState → 동기 setState 없음 (lint 에러 2건 제거) ── */
  useEffect(() => {
    if (!userId) return
    let alive = true
    void (async () => {
      try {
        const next = await fetchLedger(month)
        if (!alive) return
        setData(next)
        setLoadError(null)
      } catch (e) {
        if (!alive) return
        setLoadError(e instanceof Error ? e.message : String(e))
      }
    })()
    return () => {
      alive = false
    }
  }, [userId, month, reloadKey])

  const reload = useCallback(() => setReloadKey((k) => k + 1), [])

  /* ── 자동 대사 파이프라인: 주인 찾기 → 자동 맞춤 → AI 제안 ───────────── */
  const runPipeline = useCallback(async () => {
    if (pipelineRunning.current) return
    pipelineRunning.current = true
    setPipelineError(null)
    try {
      setBusyLabel('입금이 누구 돈인지 찾는 중…')
      try {
        await apiJson('/api/reconciliation/resolve-issuers', { method: 'POST', json: {} })
      } catch (e) {
        console.warn('[장부] resolve-issuers failed:', e)
      }

      setBusyLabel('자동으로 맞추는 중…')
      let needAi = false
      try {
        const res = await apiJson<{ summary: EngineSummaryView }>('/api/reconciliation/reconcile', {
          method: 'POST',
          json: {},
        })
        needAi = res.summary.deposits_left_open > 0 || res.summary.unassigned_deposits > 0
      } catch (e) {
        setPipelineError(e instanceof Error ? e.message : String(e))
      }

      if (needAi) {
        setBusyLabel('어려운 건 AI 여러 개가 의논하는 중…')
        try {
          await apiJson('/api/reconciliation/infer-matches', { method: 'POST', json: {} })
        } catch (e) {
          console.warn('[장부] infer-matches failed:', e)
        }
      }
    } finally {
      pipelineRunning.current = false
      setBusyLabel(null)
      reload()
    }
  }, [reload])

  const handleSaved = useCallback(() => {
    reload()
    void runPipeline()
  }, [reload, runPipeline])

  /* ── 파생 데이터 ──────────────────────────────────────────────────────── */
  const salesById = useMemo(() => new Map((data?.sales ?? []).map((s) => [s.id, s])), [data?.sales])
  const depositsById = useMemo(() => new Map((data?.deposits ?? []).map((d) => [d.id, d])), [data?.deposits])
  const monthSales = useMemo(
    () => (data?.sales ?? []).filter((s) => s.sale_date.startsWith(month)),
    [data?.sales, month]
  )
  const monthDeposits = useMemo(
    () => (data?.deposits ?? []).filter((d) => d.deposit_date.startsWith(month)),
    [data?.deposits, month]
  )
  const attentionCount =
    (data?.proposals.length ?? 0) +
    (data?.results.filter(
      (r) =>
        (r.issuer_id != null || r.method_code != null) &&
        (r.status === 'missing_deposit' || r.status === 'amount_mismatch' || r.status === 'unmatched_deposit')
    ).length ?? 0)

  /* ── 화면 ─────────────────────────────────────────────────────────────── */
  if (authLoading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
        <p className="text-sm text-slate-500">잠시만요…</p>
      </main>
    )
  }
  if (!userId) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
        <div className={`${CARD} max-w-sm text-center`}>
          <h1 className="text-lg font-bold text-slate-900">로그인이 필요해요</h1>
          <p className="mt-2 text-sm leading-relaxed text-slate-600">
            사장님 장부는 사장님 계정에만 보여요. 로그인하고 다시 열어 주세요.
          </p>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-slate-50 pb-28">
      <div className="mx-auto flex w-full max-w-xl flex-col gap-4 px-4 pt-5">
        <header className="flex items-end justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">가게 장부</h1>
            <p className="mt-0.5 text-sm text-slate-500">넣기만 하세요 — 읽고 맞추는 건 AI가 해요.</p>
          </div>
          {busyLabel ? <span className={BADGE_AI}>{busyLabel}</span> : null}
        </header>

        {loadError ? <p className={ERROR_TEXT}>{loadError}</p> : null}
        {pipelineError ? <p className={ERROR_TEXT}>맞추기 실패: {pipelineError}</p> : null}

        <AskBox month={month} />

        {data == null && !loadError ? (
          <section className={CARD}>
            <p className="text-sm text-slate-500">장부를 여는 중…</p>
          </section>
        ) : null}

        {data ? (
          <>
            {tab === 'ingest' ? (
              <IngestTab
                issuers={data.issuers}
                channels={data.channels}
                deposits={data.deposits}
                onSaved={handleSaved}
                busyLabel={busyLabel}
              />
            ) : null}
            {tab === 'recon' ? (
              <ReconcileTab
                results={data.results}
                proposals={data.proposals}
                issuers={data.issuers}
                salesById={salesById}
                depositsById={depositsById}
                month={month}
                onChanged={reload}
                onRunPipeline={() => void runPipeline()}
                busyLabel={busyLabel}
              />
            ) : null}
            {tab === 'close' ? (
              <ClosingTab
                month={month}
                onMonthChange={setMonth}
                summary={data.summary}
                monthSales={monthSales}
                monthDeposits={monthDeposits}
                issuers={data.issuers}
                channels={data.channels}
                currentMonth={currentMonthString()}
                onChanged={reload}
              />
            ) : null}
          </>
        ) : null}
      </div>

      {/* 하단 탭 — 폰에서 엄지로 누르는 자리 */}
      <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto grid w-full max-w-xl grid-cols-3">
          {(
            [
              { id: 'ingest', label: '넣기', icon: '✏️', hint: '붙여넣기·사진·엑셀' },
              { id: 'recon', label: '대사', icon: '🔎', hint: '입금 확인' },
              { id: 'close', label: '정산', icon: '📅', hint: '월 마감' },
            ] as const
          ).map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`relative flex min-h-16 flex-col items-center justify-center gap-0.5 text-xs font-bold transition ${
                tab === t.id ? 'text-slate-900' : 'text-slate-400 hover:text-slate-600'
              }`}
            >
              <span aria-hidden className="text-lg leading-none">
                {t.icon}
              </span>
              <span>{t.label}</span>
              <span className="text-[10px] font-normal text-slate-400">{t.hint}</span>
              {t.id === 'recon' && attentionCount > 0 ? (
                <span className="absolute right-[22%] top-2 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-600 px-1 text-[10px] font-bold text-white">
                  {attentionCount}
                </span>
              ) : null}
            </button>
          ))}
        </div>
      </nav>
    </main>
  )
}
