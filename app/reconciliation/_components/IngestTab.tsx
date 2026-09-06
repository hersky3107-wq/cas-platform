'use client'

/**
 * 넣기 — 상자 하나. 문자·통장내역·손으로 적은 것 붙여넣기, 사진, 엑셀 전부
 * 여기로. 매출인지 입금인지, 무슨 결제인지, 어느 카드사인지 사장님이 미리
 * 고르지 않는다 — AI(모델 2개 교차확인)가 읽고, 사장님은 틀린 것만 고쳐서
 * 저장한다.
 *
 * 고친 것은 학습된다: 입금 행에서 카드사를 고치면 그 메모가 카드사 별칭으로
 * 저장돼 다음부터는 자동으로 맞는다 (서버 createDeposit → learnMemoAlias).
 * 저장이 끝나면 자동으로 대사 파이프라인(주인 찾기 → 자동 맞추기 → AI 제안)이
 * 돈다 — 사장님이 누를 버튼이 없다.
 */

import { useMemo, useRef, useState } from 'react'
import { prepareImageForUpload } from '@/lib/reconciliation/prepare-image-upload'
import { annotateDuplicates } from '@/lib/reconciliation/deposit-duplicates'
import type { CardIssuer, DepositRecord, PaymentChannel, SaleKind } from '@/lib/reconciliation/types'
import {
  apiJson,
  BADGE_AI,
  BADGE_WARN,
  BTN_GHOST,
  BTN_PRIMARY,
  CARD,
  ERROR_TEXT,
  INPUT,
  METHOD_KO,
  type ClassifiedRowView,
  type ClassifyResponse,
} from '../_lib/ui'

const LOW_CONFIDENCE = 0.7

/** 검토 행 — AI가 읽은 그대로 + 사장님의 수정 상태. */
type ReviewRow = {
  key: string
  kind: 'sale' | 'deposit'
  date: string
  amount: string
  memo: string
  /** '' | 'issuer:<id>' | 'method:<code>' */
  tag: string
  originalTag: string
  confidence: number
  needsReview: boolean
  agreement: string
  edited: boolean
  duplicate: boolean
  skip: boolean
  saveError: string | null
}

const METHOD_OPTIONS = [
  'app_voucher',
  'barcode_pay',
  'delivery_app',
  'foreign_pay',
  'tax_free',
  'cash',
  'transfer',
  'paper_voucher',
] as const

/** 엔진이 채널로 묶는 방법들 — 저장 시 해당 유형의 채널을 자동으로 만들어 붙인다. */
const CHANNEL_METHODS = new Set(['app_voucher', 'barcode_pay', 'delivery_app', 'foreign_pay', 'tax_free', 'transfer'])

function saleKindFor(tag: string): SaleKind {
  if (tag.startsWith('issuer:')) return 'card'
  const code = tag.replace(/^method:/, '')
  if (code === 'app_voucher') return 'app_voucher'
  if (code === 'cash') return 'cash'
  if (code === 'paper_voucher') return 'paper_voucher'
  if (code === 'barcode_pay' || code === 'delivery_app' || code === 'foreign_pay' || code === 'tax_free') {
    return 'card' // 카드망으로 정산되는 방법 — 묶음은 채널이 담당
  }
  return 'manual_total'
}

function rowFromClassified(row: ClassifiedRowView, i: number): ReviewRow {
  const tag = row.issuer_id ? `issuer:${row.issuer_id}` : row.method_code ? `method:${row.method_code}` : ''
  return {
    key: `r${i}-${row.date ?? 'x'}-${row.amount}`,
    kind: row.kind,
    date: row.date ?? '',
    amount: String(row.amount),
    memo: row.memo ?? '',
    tag,
    originalTag: tag,
    confidence: row.confidence,
    needsReview: row.needs_review,
    agreement: row.agreement,
    edited: false,
    duplicate: false,
    skip: false,
    saveError: null,
  }
}

export default function IngestTab({
  issuers,
  channels,
  deposits,
  onSaved,
  busyLabel,
}: {
  issuers: CardIssuer[]
  channels: PaymentChannel[]
  deposits: DepositRecord[]
  /** 저장 완료 → 페이지가 목록 새로고침 + 자동 대사 파이프라인을 돈다. */
  onSaved: (message: string) => void
  /** 파이프라인 진행 라벨 (페이지 소유) — 저장 직후 여기 표시된다. */
  busyLabel: string | null
}) {
  const [text, setText] = useState('')
  const [classifying, setClassifying] = useState(false)
  const [classifyNote, setClassifyNote] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [documentId, setDocumentId] = useState<string | null>(null)
  const [rows, setRows] = useState<ReviewRow[]>([])
  const [saving, setSaving] = useState(false)
  const [savedMsg, setSavedMsg] = useState<string | null>(null)
  const channelCache = useRef(new Map<string, string>())

  const activeIssuers = useMemo(() => issuers.filter((i) => i.is_active), [issuers])
  const issuerNameById = useMemo(() => new Map(issuers.map((i) => [i.id, i.name])), [issuers])

  const applyClassifyResult = (res: ClassifyResponse) => {
    const drafts = res.rows.map(rowFromClassified)
    // 이미 저장돼 있는 입금과 겹치는지 표시 (날짜+금액+메모) — 지우지 않고 표시만.
    const depositIdx: number[] = []
    const cores = drafts
      .map((r, i) => ({ r, i }))
      .filter(({ r }) => r.kind === 'deposit')
      .map(({ r, i }) => {
        depositIdx.push(i)
        return {
          date: r.date || null,
          amount: r.amount ? Number(r.amount) : null,
          memo: r.memo || null,
          confidence: r.confidence,
          year_ambiguous: false,
          method: 'ai' as const,
          extra: null,
        }
      })
    const flagged = annotateDuplicates(
      cores,
      deposits.map((d) => ({ id: d.id, deposit_date: d.deposit_date, actual_amount: d.actual_amount, memo: d.memo }))
    )
    flagged.forEach((f, j) => {
      const target = drafts[depositIdx[j]!]!
      target.duplicate = f.duplicate_suspect
      target.skip = f.duplicate_suspect
    })
    // 확인이 필요한 행(모델 불일치·낮은 신뢰도)을 맨 위로.
    drafts.sort(
      (a, b) =>
        Number(b.needsReview || b.confidence < LOW_CONFIDENCE) - Number(a.needsReview || a.confidence < LOW_CONFIDENCE) ||
        a.confidence - b.confidence
    )
    setRows(drafts)
    setDocumentId(res.document_id)
    setClassifyNote(
      res.rows.length === 0
        ? '읽을 수 있는 매출·입금이 없었어요.'
        : `AI가 ${res.rows.length}건을 읽었어요 (모델 ${res.models_responded}개 교차확인). 맞는지 보고 저장을 누르세요.`
    )
  }

  const classify = async (payload: Record<string, unknown>) => {
    setClassifying(true)
    setError(null)
    setSavedMsg(null)
    setClassifyNote(null)
    try {
      const res = await apiJson<ClassifyResponse>('/api/reconciliation/classify', {
        method: 'POST',
        json: payload,
      })
      applyClassifyResult(res)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setClassifying(false)
    }
  }

  const handleImage = async (file: File | undefined) => {
    if (!file) return
    try {
      const prepared = await prepareImageForUpload(file)
      await classify({ image: prepared.dataUrl, media_type: prepared.mediaType })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const handleSpreadsheet = async (file: File | undefined) => {
    if (!file) return
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () =>
          typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('파일을 읽지 못했어요'))
        reader.onerror = () => reject(new Error('파일을 읽지 못했어요'))
        reader.readAsDataURL(file)
      })
      await classify({ file: dataUrl, media_type: file.type || undefined, filename: file.name })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const patchRow = (key: string, patch: Partial<ReviewRow>) => {
    setRows((prev) =>
      prev.map((r) => {
        if (r.key !== key) return r
        const next = { ...r, ...patch }
        next.edited =
          next.date !== r.date || next.amount !== r.amount || next.memo !== r.memo || next.tag !== r.tag
            ? true
            : next.edited
        return next
      })
    )
  }

  const ensureChannel = async (code: string): Promise<string> => {
    const cached = channelCache.current.get(code)
    if (cached) return cached
    const existing = channels.find((c) => c.channel_type === code)
    if (existing) {
      channelCache.current.set(code, existing.id)
      return existing.id
    }
    const created = await apiJson<PaymentChannel>('/api/reconciliation/channels', {
      method: 'POST',
      json: { name: METHOD_KO[code] ?? code, channel_type: code },
    })
    channelCache.current.set(code, created.id)
    return created.id
  }

  const save = async () => {
    const targets = rows.filter((r) => !r.skip)
    if (targets.length === 0) return
    setSaving(true)
    setError(null)
    let savedSales = 0
    let savedDeposits = 0
    const failed: ReviewRow[] = []

    for (const row of targets) {
      const amount = Number(row.amount)
      if (!row.date.trim() || !Number.isFinite(amount) || amount === 0) {
        failed.push({ ...row, saveError: '날짜와 금액을 채워 주세요' })
        continue
      }
      try {
        const confirmStatus = row.edited ? 'edited' : 'confirmed'
        if (row.kind === 'sale') {
          const kind = saleKindFor(row.tag)
          const issuerId = row.tag.startsWith('issuer:') ? row.tag.slice('issuer:'.length) : null
          const methodCode = row.tag.startsWith('method:') ? row.tag.slice('method:'.length) : null
          const channelId =
            methodCode && CHANNEL_METHODS.has(methodCode) ? await ensureChannel(methodCode) : null
          await apiJson('/api/reconciliation/sales', {
            method: 'POST',
            json: {
              sale_date: row.date.trim(),
              gross_amount: amount,
              sale_kind: kind,
              issuer_id: issuerId,
              channel_id: channelId,
              raw_document_id: documentId,
              confidence: row.confidence,
              confirm_status: confirmStatus,
              entry_source: 'manual',
            },
          })
          savedSales++
        } else {
          const issuerId = row.tag.startsWith('issuer:') ? row.tag.slice('issuer:'.length) : null
          const methodCode = row.tag.startsWith('method:') ? row.tag.slice('method:'.length) : null
          const channelHint =
            methodCode && CHANNEL_METHODS.has(methodCode) ? await ensureChannel(methodCode) : null
          const issuerCorrected = row.tag !== row.originalTag
          await apiJson('/api/reconciliation/deposits', {
            method: 'POST',
            json: {
              deposit_date: row.date.trim(),
              actual_amount: amount,
              memo: row.memo.trim() || null,
              channel_hint: channelHint,
              raw_document_id: documentId,
              confidence: row.confidence,
              confirm_status: confirmStatus,
              ...(issuerId
                ? {
                    issuer_id: issuerId,
                    // 사장님이 고른 카드사는 'user'로 저장 → 메모 별칭 학습.
                    issuer_source: issuerCorrected ? 'user' : 'ai',
                    issuer_confidence: issuerCorrected ? null : row.confidence,
                  }
                : {}),
            },
          })
          savedDeposits++
        }
      } catch (e) {
        failed.push({ ...row, saveError: e instanceof Error ? e.message : String(e) })
      }
    }

    setRows(failed)
    setSaving(false)
    if (savedSales + savedDeposits > 0) {
      const parts = [savedSales > 0 ? `매출 ${savedSales}건` : null, savedDeposits > 0 ? `입금 ${savedDeposits}건` : null]
      const msg = `${parts.filter(Boolean).join(' · ')} 저장했어요.`
      setSavedMsg(msg)
      if (failed.length === 0) {
        setText('')
        setDocumentId(null)
        setClassifyNote(null)
      }
      onSaved(msg)
    }
    if (failed.length > 0) {
      setError(`${failed.length}건은 저장하지 못했어요 — 행에 표시된 이유를 확인해 주세요.`)
    }
  }

  const pendingCount = rows.filter((r) => !r.skip).length

  return (
    <div className="flex flex-col gap-4">
      {/* ── 상자 하나 ─────────────────────────────────────────────────────── */}
      <section className={CARD}>
        <h2 className="text-base font-bold text-slate-900">아무거나 넣으세요</h2>
        <p className="mt-1 text-sm leading-relaxed text-slate-500">
          문자, 통장 내역, 오늘 판 것… 복사해서 붙여넣거나 그냥 적으세요. 사진·엑셀도 돼요. 나머지는 AI가 알아서
          읽어요.
        </p>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={5}
          placeholder={'예)\n9/1 NH카드 31,500\n하나 94,500\n[국민은행] 09/02 하나90343621 94,359원 입금'}
          className={`${INPUT} mt-3 resize-y font-mono text-sm leading-relaxed`}
        />
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            className={`${BTN_PRIMARY} flex-1 sm:flex-none`}
            disabled={classifying || !text.trim()}
            onClick={() => void classify({ raw_text: text, source_type: 'manual' })}
          >
            {classifying ? 'AI가 읽는 중…' : 'AI한테 맡기기'}
          </button>
          <label className={`${BTN_GHOST} cursor-pointer`}>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              className="sr-only"
              disabled={classifying}
              onChange={(e) => {
                const f = e.target.files?.[0]
                void handleImage(f)
                e.target.value = ''
              }}
            />
            📷 사진
          </label>
          <label className={`${BTN_GHOST} cursor-pointer`}>
            <input
              type="file"
              accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
              className="sr-only"
              disabled={classifying}
              onChange={(e) => {
                const f = e.target.files?.[0]
                void handleSpreadsheet(f)
                e.target.value = ''
              }}
            />
            📄 엑셀
          </label>
        </div>
        {error ? <p className={ERROR_TEXT}>{error}</p> : null}
        {savedMsg ? (
          <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5">
            <p className="text-sm font-semibold text-emerald-800">{savedMsg}</p>
            {busyLabel ? <p className="mt-1 text-xs text-emerald-700">{busyLabel}</p> : null}
            {!busyLabel ? (
              <p className="mt-1 text-xs text-emerald-700">자동으로 입금까지 맞춰봤어요 — 「대사」에서 확인하세요.</p>
            ) : null}
          </div>
        ) : null}
      </section>

      {/* ── AI가 읽은 것 (검토 후 저장) ───────────────────────────────────── */}
      {rows.length > 0 || classifyNote ? (
        <section className={CARD}>
          <div className="flex items-center gap-2">
            <span className={BADGE_AI}>AI가 읽은 것</span>
            {classifyNote ? <p className="text-xs leading-relaxed text-slate-500">{classifyNote}</p> : null}
          </div>

          <ul className="mt-3 space-y-2.5">
            {rows.map((row) => {
              const uncertain = row.needsReview || row.confidence < LOW_CONFIDENCE
              return (
                <li
                  key={row.key}
                  className={`rounded-xl border p-3 ${
                    row.skip
                      ? 'border-slate-200 bg-slate-50 opacity-60'
                      : uncertain
                        ? 'border-amber-300 bg-amber-50/50'
                        : 'border-slate-200 bg-white'
                  }`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    {/* 매출/입금 토글 */}
                    <div className="inline-flex overflow-hidden rounded-lg border border-slate-300">
                      {(['sale', 'deposit'] as const).map((k) => (
                        <button
                          key={k}
                          type="button"
                          className={`px-3 py-1.5 text-xs font-bold ${
                            row.kind === k ? 'bg-slate-900 text-white' : 'bg-white text-slate-600'
                          }`}
                          onClick={() => patchRow(row.key, { kind: k, edited: true })}
                        >
                          {k === 'sale' ? '매출' : '입금'}
                        </button>
                      ))}
                    </div>
                    {uncertain ? <span className={BADGE_WARN}>확인해 주세요</span> : null}
                    {row.duplicate ? <span className={BADGE_WARN}>이미 있는 입금 같아요</span> : null}
                    {row.saveError ? (
                      <span className="text-xs font-semibold text-rose-700">{row.saveError}</span>
                    ) : null}
                    <button
                      type="button"
                      className="ml-auto text-xs font-semibold text-slate-400 underline underline-offset-2"
                      onClick={() =>
                        row.skip ? patchRow(row.key, { skip: false }) : patchRow(row.key, { skip: true })
                      }
                    >
                      {row.skip ? '다시 저장할래요' : '저장 안 함'}
                    </button>
                  </div>

                  <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <input
                      type="date"
                      value={row.date}
                      onChange={(e) => patchRow(row.key, { date: e.target.value })}
                      className={`${INPUT} px-2 py-2 text-sm`}
                    />
                    <input
                      type="number"
                      inputMode="numeric"
                      value={row.amount}
                      onChange={(e) => patchRow(row.key, { amount: e.target.value })}
                      placeholder="금액 (환불은 -)"
                      className={`${INPUT} px-2 py-2 text-sm tabular-nums`}
                    />
                    <select
                      value={row.tag}
                      onChange={(e) => patchRow(row.key, { tag: e.target.value })}
                      className={`${INPUT} px-2 py-2 text-sm`}
                    >
                      <option value="">잘 모름 (AI가 나중에 찾음)</option>
                      <optgroup label="카드">
                        {activeIssuers.map((i) => (
                          <option key={i.id} value={`issuer:${i.id}`}>
                            카드 · {i.name}
                          </option>
                        ))}
                      </optgroup>
                      <optgroup label="다른 방법">
                        {METHOD_OPTIONS.map((code) => (
                          <option key={code} value={`method:${code}`}>
                            {METHOD_KO[code]}
                          </option>
                        ))}
                      </optgroup>
                    </select>
                    <input
                      type="text"
                      value={row.memo}
                      onChange={(e) => patchRow(row.key, { memo: e.target.value })}
                      placeholder="메모"
                      className={`${INPUT} px-2 py-2 text-sm`}
                    />
                  </div>

                  <p className="mt-1.5 text-[11px] text-slate-400">
                    {Number(row.amount) < 0 ? '환불로 저장돼요 · ' : ''}
                    AI 추정 · 믿을만함 {row.confidence >= 0.8 ? '높음' : row.confidence >= 0.6 ? '중간' : '낮음'} ·
                    교차확인 {row.agreement}
                    {row.originalTag !== row.tag ? ' · 직접 고침' : ''}
                    {row.tag.startsWith('issuer:') ? ` · ${issuerNameById.get(row.tag.slice(7)) ?? ''}` : ''}
                  </p>
                </li>
              )
            })}
          </ul>

          {rows.length > 0 ? (
            <button
              type="button"
              className={`${BTN_PRIMARY} mt-4 w-full`}
              disabled={saving || pendingCount === 0}
              onClick={() => void save()}
            >
              {saving ? '저장 중…' : `이대로 저장 (${pendingCount}건)`}
            </button>
          ) : null}
        </section>
      ) : null}
    </div>
  )
}
