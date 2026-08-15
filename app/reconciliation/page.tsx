'use client'

/**
 * 대사기 — Stage 1 minimal UI (bank-transfer only).
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
import type {
  DepositRecord,
  PaymentChannel,
  ReconciliationWithMatches,
  SalesRecord,
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
  const [savingSale, setSavingSale] = useState(false)

  const [depositText, setDepositText] = useState('')
  const [parsingDeposit, setParsingDeposit] = useState(false)
  const [lastParsed, setLastParsed] = useState<{ confidence: number } | null>(null)

  const [editing, setEditing] = useState<Record<string, { date: string; amount: string }>>({})
  const [savingDepositId, setSavingDepositId] = useState<string | null>(null)

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
    if (!channel) return
    setError(null)
    setSavingSale(true)
    try {
      await apiJson('/api/reconciliation/sales', {
        method: 'POST',
        json: {
          sale_date: saleDate,
          gross_amount: Number(saleAmount),
          channel_id: channel.id,
          confirm_status: 'confirmed',
        },
      })
      setSaleDate('')
      setSaleAmount('')
      await refreshLists()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSavingSale(false)
    }
  }, [channel, saleDate, saleAmount, refreshLists])

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
              />
            </div>
            <div style={rowStyle}>
              <span style={labelStyle}>{pack.saleAmountLabel}</span>
              <input
                type="number"
                value={saleAmount}
                onChange={(e) => setSaleAmount(e.target.value)}
                style={inputStyle}
              />
            </div>
            <button
              type="button"
              disabled={savingSale || !saleDate || !saleAmount}
              onClick={() => void handleAddSale()}
            >
              {savingSale ? pack.saleSubmittingBtn : pack.saleSubmitBtn}
            </button>

            <h3>{pack.saleListTitle}</h3>
            {sales.length === 0 ? (
              <p>{pack.saleListEmptyMsg}</p>
            ) : (
              <ul>
                {sales.map((s) => (
                  <li key={s.id}>
                    {s.sale_date} — {s.gross_amount.toLocaleString()} ({s.confirm_status})
                  </li>
                ))}
              </ul>
            )}
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
          </section>

          <section style={boxStyle}>
            <h2>{pack.reviewSectionTitle}</h2>
            <p>{pack.reviewTagline}</p>
            {pendingDeposits.length === 0 ? (
              <p>{pack.reviewEmptyMsg}</p>
            ) : (
              pendingDeposits.map((d) => {
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
              })
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
