'use client'

/**
 * 대사기 — manual sales entry + Stage 1 transfer reconciliation UI.
 *
 * Proves the ingest → parse → review → reconcile loop end-to-end. Intentionally
 * unstyled (inline styles only, no design pass) — see the task that added this.
 * All strings come from lib/reconciliation/ui-labels.ts; no literal Korean/English
 * copy is inlined here (matches lib/synod/ui-labels.ts's ui-pack pattern).
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
  type DepositRecord,
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

const boxStyle: React.CSSProperties = {
  border: '1px solid #999',
  padding: 16,
  marginBottom: 16,
}
const rowStyle: React.CSSProperties = { display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }
const labelStyle: React.CSSProperties = { fontSize: 12, minWidth: 90, display: 'inline-block' }
const inputStyle: React.CSSProperties = { padding: 6 }
const errorStyle: React.CSSProperties = { color: '#b00', fontSize: 13, marginTop: 8 }
const badgeStyle: React.CSSProperties = {
  fontSize: 11,
  background: '#fee',
  color: '#900',
  padding: '2px 6px',
  border: '1px solid #900',
}
const statusColor: Record<string, string> = {
  matched: '#0a0',
  missing_deposit: '#b60',
  amount_mismatch: '#b00',
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
      <main style={{ padding: 40 }}>
        <p>{pack.checkingSessionMsg}</p>
      </main>
    )
  }

  if (!userId) {
    return (
      <main style={{ padding: 40 }}>
        <h1>{pack.signInRequiredTitle}</h1>
        <p>{pack.signInRequiredBody}</p>
      </main>
    )
  }

  const pendingDeposits = deposits.filter((d) => d.confirm_status === 'pending')
  const pendingSales = sales.filter((s) => s.confirm_status === 'pending')

  return (
    <main style={{ padding: 24, maxWidth: 720 }}>
      <h1>{pack.pageTitle}</h1>
      <p>{pack.pageTagline}</p>

      {settingUpChannel || !channel ? (
        <p>{pack.setupChannelMsg}</p>
      ) : (
        <>
          <section style={boxStyle}>
            <h2>{pack.saleSectionTitle}</h2>
            <div style={rowStyle}>
              <span style={labelStyle}>{pack.saleDateLabel}</span>
              <input
                type="date"
                value={saleDate}
                onChange={(e) => setSaleDate(e.target.value)}
                style={inputStyle}
                required
              />
            </div>
            <div style={rowStyle}>
              <span style={labelStyle}>{pack.saleAmountLabel}</span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={saleAmount}
                onChange={(e) => setSaleAmount(e.target.value)}
                style={inputStyle}
                required
              />
            </div>
            <div style={rowStyle}>
              <span style={labelStyle}>{pack.saleKindLabel}</span>
              <select
                value={saleKind}
                onChange={(e) => {
                  const next = e.target.value as SaleKind
                  setSaleKind(next)
                }}
                style={inputStyle}
              >
                <option value="card">{pack.saleKindCard}</option>
                <option value="app_voucher">{pack.saleKindAppVoucher}</option>
                <option value="manual_total">{pack.saleKindManualTotal}</option>
              </select>
            </div>
            <p style={{ fontSize: 12, color: '#555', lineHeight: 1.5 }}>
              {pack.saleKindHelper}
            </p>

            <button
              type="button"
              disabled={savingSale || !saleDate || !saleAmount}
              onClick={() => void handleAddSale()}
            >
              {savingSale ? pack.saleSubmittingBtn : pack.saleSubmitBtn}
            </button>

            {saleError ? (
              <p style={errorStyle}>
                {pack.errorPrefix}: {saleError}
              </p>
            ) : null}
            {lastCreatedSale ? (
              <div style={{ marginTop: 12, border: '1px solid #0a0', padding: 8 }}>
                <strong>{pack.saleCreatedMsg}</strong>
                <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', marginBottom: 0 }}>
                  {JSON.stringify(lastCreatedSale, null, 2)}
                </pre>
              </div>
            ) : null}

            <div style={{ ...rowStyle, marginTop: 12 }}>
              <span style={labelStyle}>{pack.saleImageLabel}</span>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                disabled={parsingSaleImage}
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  setSaleImageName(file?.name ?? '')
                  void handleParseSalesImage(file)
                  e.target.value = ''
                }}
              />
              {parsingSaleImage ? <span style={{ fontSize: 12 }}>{pack.saleImageParsingBtn}</span> : null}
            </div>
            <p style={{ fontSize: 12, color: '#555', lineHeight: 1.5 }}>{pack.saleImageHint}</p>
            {saleImageName ? <p style={{ fontSize: 12 }}>{saleImageName}</p> : null}
            {lastParsedSale ? (
              <p>
                {pack.saleImageParsedMsg} — {pack.reviewConfidenceLabel}: {lastParsedSale.confidence} —{' '}
                {saleKindLabel(pack, lastParsedSale.sale_kind)}{' '}
                {lastParsedSale.sale_kind_guessed ? pack.saleKindGuessBadge : pack.saleKindUnknownBadge}
              </p>
            ) : null}

            <h3>{pack.saleListTitle}</h3>
            {sales.length === 0 ? (
              <p>{pack.saleListEmptyMsg}</p>
            ) : (
              <ul>
                {sales.map((s) => (
                  <li key={s.id}>
                    {s.sale_date} — {s.gross_amount.toLocaleString()} —{' '}
                    {saleKindLabel(pack, s.sale_kind)} ({s.confirm_status})
                    {s.confidence != null && s.confidence < LOW_CONFIDENCE_THRESHOLD ? (
                      <>
                        {' '}
                        <span style={badgeStyle}>{pack.reviewLowConfidenceBadge}</span>
                      </>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section style={boxStyle}>
            <h2>{pack.spreadsheetSectionTitle}</h2>
            <div style={rowStyle}>
              <span style={labelStyle}>{pack.spreadsheetKindLabel}</span>
              <select
                value={spreadsheetKind}
                onChange={(e) => setSpreadsheetKind(e.target.value as 'deposits' | 'sales')}
                style={inputStyle}
                disabled={parsingSpreadsheet}
              >
                <option value="deposits">{pack.spreadsheetKindDeposits}</option>
                <option value="sales">{pack.spreadsheetKindSales}</option>
              </select>
              <input
                type="file"
                accept=".csv,.xlsx,.xls,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                disabled={parsingSpreadsheet}
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  void handleParseSpreadsheet(file)
                  e.target.value = ''
                }}
              />
              {parsingSpreadsheet ? <span style={{ fontSize: 12 }}>{pack.spreadsheetParsingBtn}</span> : null}
            </div>
            <p style={{ fontSize: 12, color: '#555', lineHeight: 1.5 }}>{pack.spreadsheetHint}</p>
            {lastSpreadsheet ? (
              <div style={{ marginTop: 8 }}>
                <p>
                  {pack.spreadsheetParsedMsg}: {lastSpreadsheet.parsed_count} —{' '}
                  {lastSpreadsheet.needs_review_count} {pack.spreadsheetNeedsReviewLabel} —{' '}
                  {lastSpreadsheet.failed_count} {pack.spreadsheetFailedLabel}
                </p>
                {lastSpreadsheet.failed_rows.length > 0 ? (
                  <ul style={{ fontSize: 12 }}>
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

          <section style={boxStyle}>
            <h2>{pack.depositSectionTitle}</h2>
            <div>
              <div>{pack.depositTextLabel}</div>
              <textarea
                value={depositText}
                onChange={(e) => setDepositText(e.target.value)}
                placeholder={pack.depositTextPlaceholder}
                rows={4}
                style={{ width: '100%', padding: 6 }}
              />
            </div>
            <button
              type="button"
              disabled={parsingDeposit || !depositText.trim()}
              onClick={() => void handleParseDeposit()}
            >
              {parsingDeposit ? pack.depositParsingBtn : pack.depositParseBtn}
            </button>
            {lastParsed ? (
              <p>
                {pack.depositParsedMsg} — {pack.reviewConfidenceLabel}: {lastParsed.confidence}
              </p>
            ) : null}
            <div style={{ ...rowStyle, marginTop: 12 }}>
              <span style={labelStyle}>{pack.depositImageLabel}</span>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                disabled={parsingDeposit}
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  setDepositImageName(file?.name ?? '')
                  void handleParseDepositImage(file)
                  e.target.value = ''
                }}
              />
              {parsingDeposit ? <span style={{ fontSize: 12 }}>{pack.depositImageParsingBtn}</span> : null}
            </div>
            <p style={{ fontSize: 12, color: '#555', lineHeight: 1.5 }}>{pack.depositImageHint}</p>
            {depositImageName ? <p style={{ fontSize: 12 }}>{depositImageName}</p> : null}
          </section>

          <section style={boxStyle}>
            <h2>{pack.reviewSectionTitle}</h2>
            <p>{pack.reviewTagline}</p>
            {pendingDeposits.length === 0 && pendingSales.length === 0 ? (
              <p>{pack.reviewEmptyMsg}</p>
            ) : (
              <>
                {pendingSales.map((s) => {
                  const edit = editingSales[s.id]
                  const low = s.confidence == null || s.confidence < LOW_CONFIDENCE_THRESHOLD
                  return (
                    <div key={s.id} style={{ ...rowStyle, border: '1px dashed #ccc', padding: 8 }}>
                      {low ? <span style={badgeStyle}>{pack.reviewLowConfidenceBadge}</span> : null}
                      {s.entry_source === 'pos_import' && s.sale_kind === 'manual_total' ? (
                        <span style={badgeStyle}>{pack.saleKindUnknownBadge}</span>
                      ) : s.entry_source === 'pos_import' ? (
                        <span style={badgeStyle}>{pack.saleKindGuessBadge}</span>
                      ) : null}
                      <span style={labelStyle}>{pack.spreadsheetKindSales}</span>
                      <span style={labelStyle}>{pack.reviewConfidenceLabel}</span>
                      <span>{s.confidence ?? '—'}</span>
                      {edit ? (
                        <>
                          <span style={labelStyle}>{pack.reviewDateLabel}</span>
                          <input
                            type="date"
                            value={edit.date}
                            onChange={(e) =>
                              setEditingSales((prev) => ({
                                ...prev,
                                [s.id]: { ...prev[s.id], date: e.target.value },
                              }))
                            }
                            style={inputStyle}
                          />
                          <span style={labelStyle}>{pack.reviewAmountLabel}</span>
                          <input
                            type="number"
                            value={edit.amount}
                            onChange={(e) =>
                              setEditingSales((prev) => ({
                                ...prev,
                                [s.id]: { ...prev[s.id], amount: e.target.value },
                              }))
                            }
                            style={inputStyle}
                          />
                          <span style={labelStyle}>{pack.saleKindLabel}</span>
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
                            style={inputStyle}
                          >
                            {SALE_KINDS.map((kind) => (
                              <option key={kind} value={kind}>
                                {saleKindLabel(pack, kind)}
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            disabled={savingPendingSaleId === s.id}
                            onClick={() => void handleSaveSaleEdit(s)}
                          >
                            {savingPendingSaleId === s.id ? pack.reviewSavingBtn : pack.reviewSaveEditBtn}
                          </button>
                        </>
                      ) : (
                        <>
                          <span>
                            {s.sale_date} — {s.gross_amount.toLocaleString()} — {saleKindLabel(pack, s.sale_kind)}
                          </span>
                          <button
                            type="button"
                            disabled={savingPendingSaleId === s.id}
                            onClick={() => void handleConfirmSale(s)}
                          >
                            {savingPendingSaleId === s.id ? pack.reviewSavingBtn : pack.reviewConfirmBtn}
                          </button>
                          <button type="button" onClick={() => startEditSale(s)}>
                            {pack.reviewSaveEditBtn}
                          </button>
                        </>
                      )}
                    </div>
                  )
                })}
                {pendingDeposits.map((d) => {
                const edit = editing[d.id]
                const low = d.confidence == null || d.confidence < LOW_CONFIDENCE_THRESHOLD
                return (
                  <div key={d.id} style={{ ...rowStyle, border: '1px dashed #ccc', padding: 8 }}>
                    {low ? <span style={badgeStyle}>{pack.reviewLowConfidenceBadge}</span> : null}
                    <span style={labelStyle}>{pack.reviewConfidenceLabel}</span>
                    <span>{d.confidence ?? '—'}</span>

                    {edit ? (
                      <>
                        <span style={labelStyle}>{pack.reviewDateLabel}</span>
                        <input
                          type="date"
                          value={edit.date}
                          onChange={(e) =>
                            setEditing((prev) => ({
                              ...prev,
                              [d.id]: { ...prev[d.id], date: e.target.value },
                            }))
                          }
                          style={inputStyle}
                        />
                        <span style={labelStyle}>{pack.reviewAmountLabel}</span>
                        <input
                          type="number"
                          value={edit.amount}
                          onChange={(e) =>
                            setEditing((prev) => ({
                              ...prev,
                              [d.id]: { ...prev[d.id], amount: e.target.value },
                            }))
                          }
                          style={inputStyle}
                        />
                        <button
                          type="button"
                          disabled={savingDepositId === d.id}
                          onClick={() => void handleSaveEdit(d)}
                        >
                          {savingDepositId === d.id ? pack.reviewSavingBtn : pack.reviewSaveEditBtn}
                        </button>
                      </>
                    ) : (
                      <>
                        <span>
                          {d.deposit_date} — {d.actual_amount.toLocaleString()}
                        </span>
                        <button
                          type="button"
                          disabled={savingDepositId === d.id}
                          onClick={() => void handleConfirmDeposit(d)}
                        >
                          {savingDepositId === d.id ? pack.reviewSavingBtn : pack.reviewConfirmBtn}
                        </button>
                        <button type="button" onClick={() => startEdit(d)}>
                          {pack.reviewSaveEditBtn}
                        </button>
                      </>
                    )}
                  </div>
                )
              })}
              </>
            )}
          </section>

          <section style={boxStyle}>
            <button type="button" disabled={reconciling} onClick={() => void handleReconcile()}>
              {reconciling ? pack.reconcileRunningBtn : pack.reconcileBtn}
            </button>
            {lastSummary ? (
              <div>
                <h3>{pack.reconcileSummaryTitle}</h3>
                {lastSummary.created === 0 ? (
                  <p>{pack.reconcileNothingMsg}</p>
                ) : (
                  <ul>
                    <li>
                      {pack.statusMatched}: {lastSummary.matched}
                    </li>
                    <li>
                      {pack.statusMissingDeposit}: {lastSummary.missing_deposit}
                    </li>
                    <li>
                      {pack.statusAmountMismatch}: {lastSummary.amount_mismatch}
                    </li>
                  </ul>
                )}
              </div>
            ) : null}
          </section>

          <section style={boxStyle}>
            <div style={rowStyle}>
              <h2 style={{ margin: 0 }}>{pack.resultsSectionTitle}</h2>
              <button type="button" onClick={() => void refreshLists()}>
                {pack.refreshBtn}
              </button>
            </div>
            {results.length === 0 ? (
              <p>{pack.resultsEmptyMsg}</p>
            ) : (
              <ul>
                {results.map((r) => (
                  <li key={r.id} style={{ marginBottom: 6 }}>
                    <strong style={{ color: statusColor[r.status] ?? '#333' }}>
                      {statusLabel(pack, r.status)}
                    </strong>
                    {' — '}
                    {pack.discrepancyLabel}: {(r.discrepancy_amount ?? 0).toLocaleString()}
                    {' — '}
                    {r.matches.length} {pack.matchesCountLabel}
                    {r.discrepancy_reason ? <div style={{ fontSize: 12 }}>{r.discrepancy_reason}</div> : null}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      {error ? (
        <p style={errorStyle}>
          {pack.errorPrefix}: {error}
        </p>
      ) : null}
    </main>
  )
}
