'use client'

/**
 * 대사기 — manual sales entry + Stage 1 transfer reconciliation UI.
 *
 * Proves the ingest → parse → review → reconcile loop end-to-end.
 * All strings come from lib/reconciliation/ui-labels.ts; no literal Korean/English
 * copy is inlined here (matches lib/synod/ui-labels.ts's ui-pack pattern).
 *
 * Styling: Tailwind v4 utilities only, matching the league hub look
 * (slate-50 canvas, white rounded cards, slate-900 primary buttons).
 * Presentation only — every handler, endpoint, and field is unchanged.
 */

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/db/supabase'
import { authenticatedFetch } from '@/lib/api/authenticated-fetch'
import {
  getReconciliationUiPack,
  normalizeReconciliationLocale,
  type ReconciliationUiPack,
} from '@/lib/reconciliation/ui-labels'
import {
  SALE_KINDS,
  type AdvisoryConfidence,
  type DepositRecord,
  type DiscrepancyAdvisory,
  type PaymentChannel,
  type ReconciliationWithMatches,
  type SaleKind,
  type SalesRecord,
} from '@/lib/reconciliation/types'

const TRANSFER_CHANNEL_NAME = 'Transfer'
const LOW_CONFIDENCE_THRESHOLD = 0.7

type ReconcileSummary = {
  created: number
  matched: number
  missing_deposit: number
  amount_mismatch: number
  sales_considered: number
  deposits_considered: number
  deposits_left_open: number
}

async function apiJson<T>(url: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const res = await authenticatedFetch(url, init)
  const text = await res.text()
  const body = text ? JSON.parse(text) : null
  if (!res.ok) {
    const message =
      body && typeof body === 'object' && 'error' in body ? String(body.error) : res.statusText
    throw new Error(message)
  }
  return body as T
}

/* ── shared class shorthands (presentation only) ─────────────────────────── */

const CARD = 'rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6'
const FIELD_LABEL = 'mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500'
const INPUT =
  'w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 ' +
  'placeholder:text-slate-400 focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-200'
const BTN_PRIMARY =
  'inline-flex min-h-11 items-center justify-center rounded-xl bg-slate-900 px-5 py-2.5 text-sm ' +
  'font-semibold text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50'
const BTN_GHOST =
  'inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-2 ' +
  'text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50'
const BTN_FILE =
  'inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed ' +
  'border-slate-300 bg-slate-50 px-4 py-2.5 text-sm font-semibold text-slate-700 transition ' +
  'hover:border-slate-400 hover:bg-slate-100 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50'
const HINT = 'mt-1.5 text-xs leading-relaxed text-slate-500'
const ERROR_TEXT = 'mt-3 rounded-xl bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700'
const BADGE_WARN =
  'inline-flex items-center rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 ' +
  'text-[11px] font-bold uppercase tracking-wide text-amber-800'
const BADGE_AI =
  'inline-flex items-center rounded-full border border-sky-300 bg-sky-50 px-2 py-0.5 ' +
  'text-[11px] font-bold uppercase tracking-wide text-sky-800'

const STATUS_TONE: Record<string, { badge: string; border: string }> = {
  matched: {
    badge:
      'inline-flex items-center rounded-full border border-emerald-300 bg-emerald-50 px-2.5 py-1 ' +
      'text-xs font-bold text-emerald-800',
    border: 'border-l-emerald-500',
  },
  missing_deposit: {
    badge:
      'inline-flex items-center rounded-full border border-amber-300 bg-amber-50 px-2.5 py-1 ' +
      'text-xs font-bold text-amber-800',
    border: 'border-l-amber-500',
  },
  amount_mismatch: {
    badge:
      'inline-flex items-center rounded-full border border-rose-300 bg-rose-50 px-2.5 py-1 ' +
      'text-xs font-bold text-rose-800',
    border: 'border-l-rose-500',
  },
}
const DEFAULT_STATUS_TONE = {
  badge:
    'inline-flex items-center rounded-full border border-slate-300 bg-slate-100 px-2.5 py-1 ' +
    'text-xs font-bold text-slate-700',
  border: 'border-l-slate-300',
}

const CONFIDENCE_BADGE: Record<AdvisoryConfidence, string> = {
  high:
    'inline-flex items-center rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 ' +
    'text-[11px] font-bold text-emerald-800',
  medium:
    'inline-flex items-center rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 ' +
    'text-[11px] font-bold text-amber-800',
  low:
    'inline-flex items-center rounded-full border border-rose-300 bg-rose-50 px-2 py-0.5 ' +
    'text-[11px] font-bold text-rose-800',
}

function statusLabel(pack: ReconciliationUiPack, status: string): string {
  if (status === 'matched') return pack.statusMatched
  if (status === 'missing_deposit') return pack.statusMissingDeposit
  if (status === 'amount_mismatch') return pack.statusAmountMismatch
  return pack.statusOther
}

function saleKindLabel(pack: ReconciliationUiPack, kind: SaleKind): string {
  if (kind === 'app_voucher') return pack.saleKindAppVoucher
  if (kind === 'manual_total') return pack.saleKindManualTotal
  if (kind === 'cash') return pack.saleKindCash
  return pack.saleKindCard
}

function advisoryConfidenceLabel(
  pack: ReconciliationUiPack,
  confidence: AdvisoryConfidence
): string {
  if (confidence === 'high') return pack.advisoryConfidenceHigh
  if (confidence === 'medium') return pack.advisoryConfidenceMedium
  return pack.advisoryConfidenceLow
}

function AdvisoryCard({
  pack,
  advisory,
}: {
  pack: ReconciliationUiPack
  advisory: DiscrepancyAdvisory
}) {
  const confidence = advisory.final_confidence ?? advisory.confidence
  const consensus = advisory.consensus_cause ?? advisory.estimated_cause
  return (
    <div className="mt-3 rounded-xl border border-indigo-200 bg-indigo-50/60 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-bold text-indigo-900">{pack.advisoryCardTitle}</span>
        <span className={CONFIDENCE_BADGE[confidence]}>
          {pack.advisoryConfidenceLabel}: {advisoryConfidenceLabel(pack, confidence)}
        </span>
        {advisory.agreement ? (
          <span className={BADGE_AI}>
            {pack.advisoryAgreementLabel} {advisory.agreement}
          </span>
        ) : null}
      </div>
      <p className="mt-2 text-sm font-semibold text-slate-900">
        <span className="text-slate-500">{pack.advisoryConsensusLabel}: </span>
        {consensus}
      </p>
      <p className="mt-1 text-xs leading-relaxed text-slate-600">{advisory.reasoning}</p>
      {advisory.per_model && advisory.per_model.length > 0 ? (
        <div className="mt-3 border-t border-indigo-200/70 pt-3">
          <p className="text-[11px] font-bold uppercase tracking-wide text-indigo-800">
            {pack.advisoryPerModelTitle}
          </p>
          <ul className="mt-2 space-y-2">
            {advisory.per_model.map((vote) => (
              <li key={vote.model} className="rounded-lg bg-white/80 px-3 py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs font-semibold text-slate-800">
                    {vote.model}
                  </span>
                  <span className={CONFIDENCE_BADGE[vote.confidence]}>
                    {advisoryConfidenceLabel(pack, vote.confidence)}
                  </span>
                </div>
                <p className="mt-1 text-xs font-medium text-slate-800">{vote.cause}</p>
                <p className="mt-0.5 text-xs leading-relaxed text-slate-500">{vote.reasoning}</p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}

export default function ReconciliationPage() {
  const [pack, setPack] = useState<ReconciliationUiPack>(getReconciliationUiPack('en'))
  const [userId, setUserId] = useState<string | null>(null)
  const [authLoading, setAuthLoading] = useState(true)

  const [channel, setChannel] = useState<PaymentChannel | null>(null)
  const [settingUpChannel, setSettingUpChannel] = useState(false)

  const [sales, setSales] = useState<SalesRecord[]>([])
  const [deposits, setDeposits] = useState<DepositRecord[]>([])
  const [results, setResults] = useState<ReconciliationWithMatches[]>([])

  const [saleDate, setSaleDate] = useState('')
  const [saleAmount, setSaleAmount] = useState('')
  const [saleKind, setSaleKind] = useState<SaleKind>('card')
  const [savingSale, setSavingSale] = useState(false)
  const [saleError, setSaleError] = useState<string | null>(null)
  const [lastCreatedSale, setLastCreatedSale] = useState<SalesRecord | null>(null)
  const [saleImageName, setSaleImageName] = useState('')
  const [parsingSaleImage, setParsingSaleImage] = useState(false)
  const [lastParsedSale, setLastParsedSale] = useState<{
    confidence: number
    sale_kind: SaleKind
    sale_kind_guessed: boolean
  } | null>(null)

  const [depositText, setDepositText] = useState('')
  const [depositImageName, setDepositImageName] = useState('')
  const [parsingDeposit, setParsingDeposit] = useState(false)
  const [lastParsed, setLastParsed] = useState<{ confidence: number } | null>(null)
  const [spreadsheetKind, setSpreadsheetKind] = useState<'deposits' | 'sales'>('deposits')
  const [parsingSpreadsheet, setParsingSpreadsheet] = useState(false)
  const [lastSpreadsheet, setLastSpreadsheet] = useState<{
    parsed_count: number
    needs_review_count: number
    failed_count: number
    failed_rows: { row_index: number; reason: string }[]
  } | null>(null)

  const [editing, setEditing] = useState<Record<string, { date: string; amount: string }>>({})
  const [editingSales, setEditingSales] = useState<
    Record<string, { date: string; amount: string; sale_kind: SaleKind }>
  >({})
  const [savingDepositId, setSavingDepositId] = useState<string | null>(null)
  const [savingPendingSaleId, setSavingPendingSaleId] = useState<string | null>(null)

  const [reconciling, setReconciling] = useState(false)
  const [lastSummary, setLastSummary] = useState<ReconcileSummary | null>(null)

  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setPack(getReconciliationUiPack(normalizeReconciliationLocale(navigator.language)))
  }, [])

  const refreshLists = useCallback(async () => {
    const [salesRes, depositsRes, resultsRes] = await Promise.all([
      apiJson<SalesRecord[]>('/api/reconciliation/sales'),
      apiJson<DepositRecord[]>('/api/reconciliation/deposits'),
      apiJson<ReconciliationWithMatches[]>('/api/reconciliation/results'),
    ])
    setSales(salesRes)
    setDeposits(depositsRes)
    setResults(resultsRes)
  }, [])

  const ensureTransferChannel = useCallback(async () => {
    setSettingUpChannel(true)
    try {
      const channels = await apiJson<PaymentChannel[]>('/api/reconciliation/channels')
      const existing = channels.find((c) => c.channel_type === 'transfer')
      if (existing) {
        setChannel(existing)
        return
      }
      const created = await apiJson<PaymentChannel>('/api/reconciliation/channels', {
        method: 'POST',
        json: { name: TRANSFER_CHANNEL_NAME, channel_type: 'transfer' },
      })
      setChannel(created)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSettingUpChannel(false)
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    async function init() {
      const { data } = await supabase.auth.getUser()
      if (cancelled) return
      setUserId(data.user?.id ?? null)
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

  useEffect(() => {
    if (!userId) return
    void ensureTransferChannel()
    void refreshLists().catch((e) => setError(e instanceof Error ? e.message : String(e)))
  }, [userId, ensureTransferChannel, refreshLists])

  const handleAddSale = useCallback(async () => {
    setSaleError(null)
    setLastCreatedSale(null)
    setSavingSale(true)
    try {
      const created = await apiJson<SalesRecord>('/api/reconciliation/sales', {
        method: 'POST',
        json: {
          sale_date: saleDate,
          gross_amount: Number(saleAmount),
          sale_kind: saleKind,
          entry_source: 'manual',
          confirm_status: 'confirmed',
        },
      })
      setLastCreatedSale(created)
      setSaleDate('')
      setSaleAmount('')
      setSaleKind('card')
      await refreshLists()
    } catch (e) {
      setSaleError(e instanceof Error ? e.message : String(e))
    } finally {
      setSavingSale(false)
    }
  }, [
    refreshLists,
    saleAmount,
    saleDate,
    saleKind,
  ])

  const handleParseDeposit = useCallback(async () => {
    if (!depositText.trim()) return
    setError(null)
    setParsingDeposit(true)
    setLastParsed(null)
    try {
      const result = await apiJson<{ parsed: { confidence: number } }>('/api/reconciliation/parse', {
        method: 'POST',
        json: {
          raw_text: depositText,
          source_type: 'sms',
          channel_hint: channel?.id,
        },
      })
      setLastParsed({ confidence: result.parsed.confidence })
      setDepositText('')
      await refreshLists()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setParsingDeposit(false)
    }
  }, [depositText, channel, refreshLists])

  const handleParseDepositImage = useCallback(
    async (file: File | undefined) => {
      if (!file) return
      setError(null)
      setParsingDeposit(true)
      setLastParsed(null)
      try {
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () =>
            typeof reader.result === 'string'
              ? resolve(reader.result)
              : reject(new Error('Could not read image'))
          reader.onerror = () => reject(new Error('Could not read image'))
          reader.readAsDataURL(file)
        })
        const result = await apiJson<{ parsed: { confidence: number } }>(
          '/api/reconciliation/parse-deposit-image',
          {
            method: 'POST',
            json: {
              image: dataUrl,
              media_type: file.type || undefined,
              channel_hint: channel?.id,
            },
          }
        )
        setLastParsed({ confidence: result.parsed.confidence })
        setDepositImageName('')
        await refreshLists()
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        setParsingDeposit(false)
      }
    },
    [channel, refreshLists]
  )

  const handleParseSalesImage = useCallback(
    async (file: File | undefined) => {
      if (!file) return
      setError(null)
      setSaleError(null)
      setParsingSaleImage(true)
      setLastParsedSale(null)
      try {
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () =>
            typeof reader.result === 'string'
              ? resolve(reader.result)
              : reject(new Error('Could not read image'))
          reader.onerror = () => reject(new Error('Could not read image'))
          reader.readAsDataURL(file)
        })
        const result = await apiJson<{
          sale: SalesRecord
          parsed: { confidence: number }
          sale_kind_guessed: boolean
        }>('/api/reconciliation/parse-sales-image', {
          method: 'POST',
          json: {
            image: dataUrl,
            media_type: file.type || undefined,
          },
        })
        setLastParsedSale({
          confidence: result.parsed.confidence,
          sale_kind: result.sale.sale_kind,
          sale_kind_guessed: result.sale_kind_guessed,
        })
        setSaleImageName('')
        await refreshLists()
      } catch (e) {
        setSaleError(e instanceof Error ? e.message : String(e))
      } finally {
        setParsingSaleImage(false)
      }
    },
    [refreshLists]
  )

  const handleParseSpreadsheet = useCallback(
    async (file: File | undefined) => {
      if (!file) return
      setError(null)
      setParsingSpreadsheet(true)
      setLastSpreadsheet(null)
      try {
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () =>
            typeof reader.result === 'string'
              ? resolve(reader.result)
              : reject(new Error('Could not read spreadsheet'))
          reader.onerror = () => reject(new Error('Could not read spreadsheet'))
          reader.readAsDataURL(file)
        })
        const result = await apiJson<{
          parsed_count: number
          needs_review_count: number
          failed_count: number
          failed_rows: { row_index: number; reason: string }[]
        }>('/api/reconciliation/parse-spreadsheet', {
          method: 'POST',
          json: {
            file: dataUrl,
            media_type: file.type || undefined,
            filename: file.name,
            kind: spreadsheetKind,
          },
        })
        setLastSpreadsheet({
          parsed_count: result.parsed_count,
          needs_review_count: result.needs_review_count,
          failed_count: result.failed_count,
          failed_rows: result.failed_rows ?? [],
        })
        await refreshLists()
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        setParsingSpreadsheet(false)
      }
    },
    [refreshLists, spreadsheetKind]
  )

  const startEdit = useCallback((deposit: DepositRecord) => {
    setEditing((prev) => ({
      ...prev,
      [deposit.id]: { date: deposit.deposit_date, amount: String(deposit.actual_amount) },
    }))
  }, [])

  const handleConfirmDeposit = useCallback(
    async (deposit: DepositRecord) => {
      setError(null)
      setSavingDepositId(deposit.id)
      try {
        await apiJson(`/api/reconciliation/deposits/${deposit.id}`, {
          method: 'PATCH',
          json: { confirm_status: 'confirmed' },
        })
        await refreshLists()
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        setSavingDepositId(null)
      }
    },
    [refreshLists]
  )

  const handleSaveEdit = useCallback(
    async (deposit: DepositRecord) => {
      const edit = editing[deposit.id]
      if (!edit) return
      setError(null)
      setSavingDepositId(deposit.id)
      try {
        await apiJson(`/api/reconciliation/deposits/${deposit.id}`, {
          method: 'PATCH',
          json: {
            deposit_date: edit.date,
            actual_amount: Number(edit.amount),
            confirm_status: 'edited',
          },
        })
        setEditing((prev) => {
          const next = { ...prev }
          delete next[deposit.id]
          return next
        })
        await refreshLists()
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        setSavingDepositId(null)
      }
    },
    [editing, refreshLists]
  )

  const startEditSale = useCallback((sale: SalesRecord) => {
    setEditingSales((prev) => ({
      ...prev,
      [sale.id]: {
        date: sale.sale_date,
        amount: String(sale.gross_amount),
        sale_kind: sale.sale_kind,
      },
    }))
  }, [])

  const handleConfirmSale = useCallback(
    async (sale: SalesRecord) => {
      setError(null)
      setSavingPendingSaleId(sale.id)
      try {
        await apiJson(`/api/reconciliation/sales/${sale.id}`, {
          method: 'PATCH',
          json: { confirm_status: 'confirmed' },
        })
        await refreshLists()
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        setSavingPendingSaleId(null)
      }
    },
    [refreshLists]
  )

  const handleSaveSaleEdit = useCallback(
    async (sale: SalesRecord) => {
      const edit = editingSales[sale.id]
      if (!edit) return
      setError(null)
      setSavingPendingSaleId(sale.id)
      try {
        await apiJson(`/api/reconciliation/sales/${sale.id}`, {
          method: 'PATCH',
          json: {
            sale_date: edit.date,
            gross_amount: Number(edit.amount),
            sale_kind: edit.sale_kind,
            confirm_status: 'edited',
          },
        })
        setEditingSales((prev) => {
          const next = { ...prev }
          delete next[sale.id]
          return next
        })
        await refreshLists()
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        setSavingPendingSaleId(null)
      }
    },
    [editingSales, refreshLists]
  )

  const handleReconcile = useCallback(async () => {
    setError(null)
    setReconciling(true)
    try {
      const result = await apiJson<{ created: ReconciliationWithMatches[]; summary: ReconcileSummary }>(
        '/api/reconciliation/reconcile',
        { method: 'POST', json: channel ? { channel_id: channel.id } : {} }
      )
      setLastSummary(result.summary)
      await refreshLists()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setReconciling(false)
    }
  }, [channel, refreshLists])

  if (authLoading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
        <p className="text-sm text-slate-500">{pack.checkingSessionMsg}</p>
      </main>
    )
  }

  if (!userId) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
        <div className={`${CARD} max-w-sm text-center`}>
          <h1 className="text-lg font-bold text-slate-900">{pack.signInRequiredTitle}</h1>
          <p className="mt-2 text-sm leading-relaxed text-slate-600">{pack.signInRequiredBody}</p>
        </div>
      </main>
    )
  }

  const pendingDeposits = deposits.filter((d) => d.confirm_status === 'pending')
  const pendingSales = sales.filter((s) => s.confirm_status === 'pending')
  const pendingCount = pendingDeposits.length + pendingSales.length

  return (
    <main className="min-h-screen bg-slate-50 pb-20">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 pt-6 sm:px-6">
        <header>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">{pack.pageTitle}</h1>
          <p className="mt-1 text-sm leading-relaxed text-slate-600">{pack.pageTagline}</p>
        </header>

        {settingUpChannel || !channel ? (
          <div className={CARD}>
            <p className="text-sm text-slate-500">{pack.setupChannelMsg}</p>
          </div>
        ) : (
          <>
            {/* ── 1. Sales entry ─────────────────────────────────────────── */}
            <section className={CARD}>
              <h2 className="text-base font-bold text-slate-900">{pack.saleSectionTitle}</h2>

              <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className={FIELD_LABEL}>{pack.saleDateLabel}</label>
                  <input
                    type="date"
                    value={saleDate}
                    onChange={(e) => setSaleDate(e.target.value)}
                    className={INPUT}
                    required
                  />
                </div>
                <div>
                  <label className={FIELD_LABEL}>{pack.saleAmountLabel}</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={saleAmount}
                    onChange={(e) => setSaleAmount(e.target.value)}
                    className={INPUT}
                    required
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className={FIELD_LABEL}>{pack.saleKindLabel}</label>
                  <select
                    value={saleKind}
                    onChange={(e) => {
                      const next = e.target.value as SaleKind
                      setSaleKind(next)
                    }}
                    className={INPUT}
                  >
                    <option value="card">{pack.saleKindCard}</option>
                    <option value="app_voucher">{pack.saleKindAppVoucher}</option>
                    <option value="manual_total">{pack.saleKindManualTotal}</option>
                  </select>
                  <p className={HINT}>{pack.saleKindHelper}</p>
                </div>
              </div>

              <div className="mt-4">
                <button
                  type="button"
                  className={BTN_PRIMARY}
                  disabled={savingSale || !saleDate || !saleAmount}
                  onClick={() => void handleAddSale()}
                >
                  {savingSale ? pack.saleSubmittingBtn : pack.saleSubmitBtn}
                </button>
              </div>

              {saleError ? (
                <p className={ERROR_TEXT}>
                  {pack.errorPrefix}: {saleError}
                </p>
              ) : null}
              {lastCreatedSale ? (
                <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3">
                  <p className="text-sm font-semibold text-emerald-800">{pack.saleCreatedMsg}</p>
                  <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-all rounded-lg bg-white/70 p-2 text-[11px] leading-relaxed text-slate-700">
                    {JSON.stringify(lastCreatedSale, null, 2)}
                  </pre>
                </div>
              ) : null}

              <div className="mt-5 border-t border-slate-100 pt-4">
                <label className={FIELD_LABEL}>{pack.saleImageLabel}</label>
                <div className="flex flex-wrap items-center gap-3">
                  <label className={BTN_FILE}>
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp,image/gif"
                      disabled={parsingSaleImage}
                      className="sr-only"
                      onChange={(e) => {
                        const file = e.target.files?.[0]
                        setSaleImageName(file?.name ?? '')
                        void handleParseSalesImage(file)
                        e.target.value = ''
                      }}
                    />
                    {pack.saleImageLabel}
                  </label>
                  {parsingSaleImage ? (
                    <span className="text-xs font-medium text-slate-500">
                      {pack.saleImageParsingBtn}
                    </span>
                  ) : null}
                </div>
                <p className={HINT}>{pack.saleImageHint}</p>
                {saleImageName ? (
                  <p className="mt-1 text-xs text-slate-500">{saleImageName}</p>
                ) : null}
                {lastParsedSale ? (
                  <div className="mt-2 flex flex-wrap items-center gap-2 rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-700">
                    <span className="font-semibold">{pack.saleImageParsedMsg}</span>
                    <span>
                      {pack.reviewConfidenceLabel}: {lastParsedSale.confidence}
                    </span>
                    <span>{saleKindLabel(pack, lastParsedSale.sale_kind)}</span>
                    <span className={BADGE_WARN}>
                      {lastParsedSale.sale_kind_guessed
                        ? pack.saleKindGuessBadge
                        : pack.saleKindUnknownBadge}
                    </span>
                  </div>
                ) : null}
              </div>

              <div className="mt-5 border-t border-slate-100 pt-4">
                <h3 className="text-sm font-bold text-slate-800">{pack.saleListTitle}</h3>
                {sales.length === 0 ? (
                  <p className="mt-2 text-sm text-slate-500">{pack.saleListEmptyMsg}</p>
                ) : (
                  <ul className="mt-2 divide-y divide-slate-100">
                    {sales.map((s) => (
                      <li
                        key={s.id}
                        className="flex flex-wrap items-center gap-x-2 gap-y-1 py-2 text-sm text-slate-700"
                      >
                        <span className="font-medium text-slate-900">{s.sale_date}</span>
                        <span className="font-semibold tabular-nums text-slate-900">
                          {s.gross_amount.toLocaleString()}
                        </span>
                        <span className="text-slate-500">
                          {saleKindLabel(pack, s.sale_kind)} · {s.confirm_status}
                        </span>
                        {s.confidence != null && s.confidence < LOW_CONFIDENCE_THRESHOLD ? (
                          <span className={BADGE_WARN}>{pack.reviewLowConfidenceBadge}</span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>

            {/* ── Spreadsheet import ─────────────────────────────────────── */}
            <section className={CARD}>
              <h2 className="text-base font-bold text-slate-900">
                {pack.spreadsheetSectionTitle}
              </h2>
              <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,12rem)_1fr] sm:items-end">
                <div>
                  <label className={FIELD_LABEL}>{pack.spreadsheetKindLabel}</label>
                  <select
                    value={spreadsheetKind}
                    onChange={(e) => setSpreadsheetKind(e.target.value as 'deposits' | 'sales')}
                    className={INPUT}
                    disabled={parsingSpreadsheet}
                  >
                    <option value="deposits">{pack.spreadsheetKindDeposits}</option>
                    <option value="sales">{pack.spreadsheetKindSales}</option>
                  </select>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <label className={BTN_FILE}>
                    <input
                      type="file"
                      accept=".csv,.xlsx,.xls,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                      disabled={parsingSpreadsheet}
                      className="sr-only"
                      onChange={(e) => {
                        const file = e.target.files?.[0]
                        void handleParseSpreadsheet(file)
                        e.target.value = ''
                      }}
                    />
                    {pack.spreadsheetBtn}
                  </label>
                  {parsingSpreadsheet ? (
                    <span className="text-xs font-medium text-slate-500">
                      {pack.spreadsheetParsingBtn}
                    </span>
                  ) : null}
                </div>
              </div>
              <p className={HINT}>{pack.spreadsheetHint}</p>
              {lastSpreadsheet ? (
                <div className="mt-3 rounded-xl bg-slate-50 px-3 py-2">
                  <p className="text-sm text-slate-700">
                    <span className="font-semibold">{pack.spreadsheetParsedMsg}:</span>{' '}
                    {lastSpreadsheet.parsed_count} — {lastSpreadsheet.needs_review_count}{' '}
                    {pack.spreadsheetNeedsReviewLabel} — {lastSpreadsheet.failed_count}{' '}
                    {pack.spreadsheetFailedLabel}
                  </p>
                  {lastSpreadsheet.failed_rows.length > 0 ? (
                    <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs text-rose-700">
                      {lastSpreadsheet.failed_rows.slice(0, 20).map((row) => (
                        <li key={`${row.row_index}-${row.reason}`}>
                          {row.row_index}: {row.reason}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ) : null}
            </section>

            {/* ── 2. Deposit entry ───────────────────────────────────────── */}
            <section className={CARD}>
              <h2 className="text-base font-bold text-slate-900">{pack.depositSectionTitle}</h2>
              <div className="mt-4">
                <label className={FIELD_LABEL}>{pack.depositTextLabel}</label>
                <textarea
                  value={depositText}
                  onChange={(e) => setDepositText(e.target.value)}
                  placeholder={pack.depositTextPlaceholder}
                  rows={4}
                  className={`${INPUT} resize-y`}
                />
              </div>
              <div className="mt-3">
                <button
                  type="button"
                  className={BTN_PRIMARY}
                  disabled={parsingDeposit || !depositText.trim()}
                  onClick={() => void handleParseDeposit()}
                >
                  {parsingDeposit ? pack.depositParsingBtn : pack.depositParseBtn}
                </button>
              </div>
              {lastParsed ? (
                <p className="mt-2 rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-700">
                  <span className="font-semibold">{pack.depositParsedMsg}</span> —{' '}
                  {pack.reviewConfidenceLabel}: {lastParsed.confidence}
                </p>
              ) : null}

              <div className="mt-5 border-t border-slate-100 pt-4">
                <label className={FIELD_LABEL}>{pack.depositImageLabel}</label>
                <div className="flex flex-wrap items-center gap-3">
                  <label className={BTN_FILE}>
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp,image/gif"
                      disabled={parsingDeposit}
                      className="sr-only"
                      onChange={(e) => {
                        const file = e.target.files?.[0]
                        setDepositImageName(file?.name ?? '')
                        void handleParseDepositImage(file)
                        e.target.value = ''
                      }}
                    />
                    {pack.depositImageBtn}
                  </label>
                  {parsingDeposit ? (
                    <span className="text-xs font-medium text-slate-500">
                      {pack.depositImageParsingBtn}
                    </span>
                  ) : null}
                </div>
                <p className={HINT}>{pack.depositImageHint}</p>
                {depositImageName ? (
                  <p className="mt-1 text-xs text-slate-500">{depositImageName}</p>
                ) : null}
              </div>
            </section>

            {/* ── 3. Human review ────────────────────────────────────────── */}
            <section className={CARD}>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-base font-bold text-slate-900">{pack.reviewSectionTitle}</h2>
                {pendingCount > 0 ? (
                  <span className={BADGE_WARN}>{pendingCount}</span>
                ) : null}
              </div>
              <p className="mt-1 text-sm text-slate-600">{pack.reviewTagline}</p>
              {pendingDeposits.length === 0 && pendingSales.length === 0 ? (
                <p className="mt-3 text-sm text-slate-500">{pack.reviewEmptyMsg}</p>
              ) : (
                <div className="mt-4 space-y-3">
                  {pendingSales.map((s) => {
                    const edit = editingSales[s.id]
                    const low = s.confidence == null || s.confidence < LOW_CONFIDENCE_THRESHOLD
                    return (
                      <div
                        key={s.id}
                        className={`rounded-xl border p-3 ${
                          low ? 'border-amber-300 bg-amber-50/60' : 'border-slate-200 bg-slate-50/60'
                        }`}
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          {low ? (
                            <span className={BADGE_WARN}>{pack.reviewLowConfidenceBadge}</span>
                          ) : null}
                          {s.entry_source === 'pos_import' && s.sale_kind === 'manual_total' ? (
                            <span className={BADGE_WARN}>{pack.saleKindUnknownBadge}</span>
                          ) : s.entry_source === 'pos_import' ? (
                            <span className={BADGE_WARN}>{pack.saleKindGuessBadge}</span>
                          ) : null}
                          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                            {pack.spreadsheetKindSales}
                          </span>
                          <span className="text-xs text-slate-500">
                            {pack.reviewConfidenceLabel}: {s.confidence ?? '—'}
                          </span>
                        </div>
                        {edit ? (
                          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
                            <div>
                              <label className={FIELD_LABEL}>{pack.reviewDateLabel}</label>
                              <input
                                type="date"
                                value={edit.date}
                                onChange={(e) =>
                                  setEditingSales((prev) => ({
                                    ...prev,
                                    [s.id]: { ...prev[s.id], date: e.target.value },
                                  }))
                                }
                                className={INPUT}
                              />
                            </div>
                            <div>
                              <label className={FIELD_LABEL}>{pack.reviewAmountLabel}</label>
                              <input
                                type="number"
                                value={edit.amount}
                                onChange={(e) =>
                                  setEditingSales((prev) => ({
                                    ...prev,
                                    [s.id]: { ...prev[s.id], amount: e.target.value },
                                  }))
                                }
                                className={INPUT}
                              />
                            </div>
                            <div>
                              <label className={FIELD_LABEL}>{pack.saleKindLabel}</label>
                              <select
                                value={edit.sale_kind}
                                onChange={(e) =>
                                  setEditingSales((prev) => ({
                                    ...prev,
                                    [s.id]: {
                                      ...prev[s.id],
                                      sale_kind: e.target.value as SaleKind,
                                    },
                                  }))
                                }
                                className={INPUT}
                              >
                                {SALE_KINDS.map((kind) => (
                                  <option key={kind} value={kind}>
                                    {saleKindLabel(pack, kind)}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div className="sm:col-span-3">
                              <button
                                type="button"
                                className={BTN_PRIMARY}
                                disabled={savingPendingSaleId === s.id}
                                onClick={() => void handleSaveSaleEdit(s)}
                              >
                                {savingPendingSaleId === s.id
                                  ? pack.reviewSavingBtn
                                  : pack.reviewSaveEditBtn}
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            <span className="text-sm text-slate-800">
                              <span className="font-medium">{s.sale_date}</span> —{' '}
                              <span className="font-semibold tabular-nums">
                                {s.gross_amount.toLocaleString()}
                              </span>{' '}
                              — {saleKindLabel(pack, s.sale_kind)}
                            </span>
                            <div className="flex gap-2">
                              <button
                                type="button"
                                className={BTN_PRIMARY}
                                disabled={savingPendingSaleId === s.id}
                                onClick={() => void handleConfirmSale(s)}
                              >
                                {savingPendingSaleId === s.id
                                  ? pack.reviewSavingBtn
                                  : pack.reviewConfirmBtn}
                              </button>
                              <button
                                type="button"
                                className={BTN_GHOST}
                                onClick={() => startEditSale(s)}
                              >
                                {pack.reviewSaveEditBtn}
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })}
                  {pendingDeposits.map((d) => {
                    const edit = editing[d.id]
                    const low = d.confidence == null || d.confidence < LOW_CONFIDENCE_THRESHOLD
                    return (
                      <div
                        key={d.id}
                        className={`rounded-xl border p-3 ${
                          low ? 'border-amber-300 bg-amber-50/60' : 'border-slate-200 bg-slate-50/60'
                        }`}
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          {low ? (
                            <span className={BADGE_WARN}>{pack.reviewLowConfidenceBadge}</span>
                          ) : null}
                          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                            {pack.spreadsheetKindDeposits}
                          </span>
                          <span className="text-xs text-slate-500">
                            {pack.reviewConfidenceLabel}: {d.confidence ?? '—'}
                          </span>
                        </div>
                        {edit ? (
                          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                            <div>
                              <label className={FIELD_LABEL}>{pack.reviewDateLabel}</label>
                              <input
                                type="date"
                                value={edit.date}
                                onChange={(e) =>
                                  setEditing((prev) => ({
                                    ...prev,
                                    [d.id]: { ...prev[d.id], date: e.target.value },
                                  }))
                                }
                                className={INPUT}
                              />
                            </div>
                            <div>
                              <label className={FIELD_LABEL}>{pack.reviewAmountLabel}</label>
                              <input
                                type="number"
                                value={edit.amount}
                                onChange={(e) =>
                                  setEditing((prev) => ({
                                    ...prev,
                                    [d.id]: { ...prev[d.id], amount: e.target.value },
                                  }))
                                }
                                className={INPUT}
                              />
                            </div>
                            <div className="sm:col-span-2">
                              <button
                                type="button"
                                className={BTN_PRIMARY}
                                disabled={savingDepositId === d.id}
                                onClick={() => void handleSaveEdit(d)}
                              >
                                {savingDepositId === d.id
                                  ? pack.reviewSavingBtn
                                  : pack.reviewSaveEditBtn}
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            <span className="text-sm text-slate-800">
                              <span className="font-medium">{d.deposit_date}</span> —{' '}
                              <span className="font-semibold tabular-nums">
                                {d.actual_amount.toLocaleString()}
                              </span>
                            </span>
                            <div className="flex gap-2">
                              <button
                                type="button"
                                className={BTN_PRIMARY}
                                disabled={savingDepositId === d.id}
                                onClick={() => void handleConfirmDeposit(d)}
                              >
                                {savingDepositId === d.id
                                  ? pack.reviewSavingBtn
                                  : pack.reviewConfirmBtn}
                              </button>
                              <button
                                type="button"
                                className={BTN_GHOST}
                                onClick={() => startEdit(d)}
                              >
                                {pack.reviewSaveEditBtn}
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </section>

            {/* ── Run reconciliation ─────────────────────────────────────── */}
            <section className={CARD}>
              <button
                type="button"
                className={`${BTN_PRIMARY} w-full sm:w-auto`}
                disabled={reconciling}
                onClick={() => void handleReconcile()}
              >
                {reconciling ? pack.reconcileRunningBtn : pack.reconcileBtn}
              </button>
              {lastSummary ? (
                <div className="mt-4">
                  <h3 className="text-sm font-bold text-slate-800">
                    {pack.reconcileSummaryTitle}
                  </h3>
                  {lastSummary.created === 0 ? (
                    <p className="mt-2 text-sm text-slate-500">{pack.reconcileNothingMsg}</p>
                  ) : (
                    <div className="mt-3 grid grid-cols-3 gap-2">
                      <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-center">
                        <p className="text-lg font-bold tabular-nums text-emerald-800">
                          {lastSummary.matched}
                        </p>
                        <p className="text-[11px] font-semibold text-emerald-700">
                          {pack.statusMatched}
                        </p>
                      </div>
                      <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-center">
                        <p className="text-lg font-bold tabular-nums text-amber-800">
                          {lastSummary.missing_deposit}
                        </p>
                        <p className="text-[11px] font-semibold text-amber-700">
                          {pack.statusMissingDeposit}
                        </p>
                      </div>
                      <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-center">
                        <p className="text-lg font-bold tabular-nums text-rose-800">
                          {lastSummary.amount_mismatch}
                        </p>
                        <p className="text-[11px] font-semibold text-rose-700">
                          {pack.statusAmountMismatch}
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              ) : null}
            </section>

            {/* ── 4. Results ─────────────────────────────────────────────── */}
            <section className={CARD}>
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-base font-bold text-slate-900">{pack.resultsSectionTitle}</h2>
                <button
                  type="button"
                  className={BTN_GHOST}
                  onClick={() => void refreshLists()}
                >
                  {pack.refreshBtn}
                </button>
              </div>
              {results.length === 0 ? (
                <p className="mt-3 text-sm text-slate-500">{pack.resultsEmptyMsg}</p>
              ) : (
                <ul className="mt-4 space-y-3">
                  {results.map((r) => {
                    const tone = STATUS_TONE[r.status] ?? DEFAULT_STATUS_TONE
                    return (
                      <li
                        key={r.id}
                        className={`rounded-xl border border-slate-200 border-l-4 bg-white p-4 ${tone.border}`}
                      >
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                          <span className={tone.badge}>{statusLabel(pack, r.status)}</span>
                          <span className="text-sm text-slate-700">
                            {pack.discrepancyLabel}:{' '}
                            <span className="font-semibold tabular-nums text-slate-900">
                              {(r.discrepancy_amount ?? 0).toLocaleString()}
                            </span>
                          </span>
                          <span className="text-xs text-slate-500">
                            {r.matches.length} {pack.matchesCountLabel}
                          </span>
                        </div>
                        {r.discrepancy_reason ? (
                          <p className="mt-2 text-xs leading-relaxed text-slate-500">
                            {r.discrepancy_reason}
                          </p>
                        ) : null}
                        {r.discrepancy_advisory ? (
                          <AdvisoryCard pack={pack} advisory={r.discrepancy_advisory} />
                        ) : null}
                      </li>
                    )
                  })}
                </ul>
              )}
            </section>
          </>
        )}

        {error ? (
          <p className={ERROR_TEXT}>
            {pack.errorPrefix}: {error}
          </p>
        ) : null}
      </div>
    </main>
  )
}
