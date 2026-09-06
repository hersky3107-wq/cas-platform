import 'server-only'

import type { OwnedScope } from '@/lib/reconciliation/scope'
import { askModelsJson } from '@/lib/reconciliation/ai-ask'
import {
  ADVISORY_MODELS,
  CLASSIFY_MAX_COMPLETION_TOKENS,
  CLASSIFY_MAX_TEXT_CHARS,
} from '@/lib/reconciliation/config'
import { listIssuers } from '@/lib/reconciliation/issuers-db'
import { todayKst } from '@/lib/reconciliation/reconcile'
import {
  RECONCILED_METHOD_CODES,
  SETTLEMENT_ONLY_METHOD_CODES,
  type DalResult,
} from '@/lib/reconciliation/types'

/**
 * UNIFIED INGEST CLASSIFICATION (AI-owned, Step-2 req. a).
 *
 * The owner throws in anything — pasted SMS, a handwritten day list typed
 * out, POS text, a bank app copy — and the AI decides per row: sale or
 * deposit? which payment method? which card issuer? what date, what amount
 * (signed: refunds negative)? The owner should choose almost nothing.
 *
 * Cross-check: the two strongest ADVISORY_MODELS answer independently. Rows
 * that BOTH models produce (same kind + date + amount) are 'agreed' —
 * confidence raised; rows only one model saw are kept but flagged
 * needs_review with capped confidence. Nothing is auto-committed: the route
 * returns candidate rows for the review UI, which commits via the existing
 * POST /sales and /deposits endpoints.
 *
 * (Images keep their existing dedicated AI routes — parse-sales-image /
 * parse-deposit-image — which already run vision models with HITL commit.)
 */

export type ClassifiedRow = {
  kind: 'sale' | 'deposit'
  method_code: string | null
  issuer_id: string | null
  issuer_name: string | null
  date: string | null
  /** Signed won. Negative = refund/cancellation (sales only). */
  amount: number
  memo: string | null
  confidence: number
  /** true when only one model produced the row, or the models disagreed on details. */
  needs_review: boolean
  agreement: string
}

export type ClassifyResult = {
  rows: ClassifiedRow[]
  model_timings: { model: string; elapsed_ms: number; ok: boolean }[]
  models_responded: number
}

function dalOk<T>(data: T): DalResult<T> {
  return { ok: true, data }
}
function dalErr(status: number, error: string): DalResult<never> {
  return { ok: false, status, error }
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

const METHOD_CODES = [...RECONCILED_METHOD_CODES, ...SETTLEMENT_ONLY_METHOD_CODES] as readonly string[]

function buildSystemPrompt(issuerNames: string[], today: string): string {
  return [
    'You classify a Korean clothing-store owner\'s raw text into structured sales (매출) and bank deposits (입금).',
    'A SALE row is something the store sold: has a payment method and, for card sales, a card issuer. A refund/cancellation is a sale row with a NEGATIVE amount.',
    'A DEPOSIT row is money arriving in the bank account (입금 알림, 통장 내역).',
    `Payment method codes: card(카드), app_voucher(앱상품권: 탐나는전/온누리 앱), barcode_pay(바코드결제), delivery_app(배달앱), foreign_pay(알리페이/위챗), tax_free(택스프리), cash(현금), transfer(계좌이체), paper_voucher(지류상품권). Use null when the method is not stated.`,
    `Card issuers at this store: ${issuerNames.join(', ')}. Use the exact name; null when not identifiable.`,
    `Dates: YYYY-MM-DD. Today is ${today} (KST) — resolve MM/DD without a year against it (never a future date). Use null when no date is given.`,
    'Amounts: integer won, signed (refund → negative). Skip balance lines (잔액), totals that duplicate itemized rows, and non-transactional text.',
    'Respond with ONLY a compact JSON array, no prose:',
    '[{"kind":"sale"|"deposit","method":"<code or null>","issuer":"<name or null>","date":"YYYY-MM-DD or null","amount":<signed won>,"memo":"<short source snippet>","confidence":<0..1>}]',
    'Do not invent rows that are not in the text. An empty array is a valid answer.',
  ].join(' ')
}

type RawRow = {
  kind: 'sale' | 'deposit'
  method: string | null
  issuer: string | null
  date: string | null
  amount: number
  memo: string | null
  confidence: number
}

function parseModelRows(json: unknown): RawRow[] {
  if (!Array.isArray(json)) return []
  const out: RawRow[] = []
  for (const item of json) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const row = item as Record<string, unknown>
    const kind = row.kind === 'sale' || row.kind === 'deposit' ? row.kind : null
    const amount = typeof row.amount === 'number' ? Math.round(row.amount) : NaN
    if (!kind || !Number.isFinite(amount) || amount === 0) continue
    if (kind === 'deposit' && amount < 0) continue // bank deposits are positive rows
    const method =
      typeof row.method === 'string' && METHOD_CODES.includes(row.method) ? row.method : null
    const issuer = typeof row.issuer === 'string' && row.issuer.trim() ? row.issuer.trim() : null
    const date = typeof row.date === 'string' && DATE_RE.test(row.date) ? row.date : null
    const memo = typeof row.memo === 'string' && row.memo.trim() ? row.memo.trim().slice(0, 200) : null
    const confidence =
      typeof row.confidence === 'number' && row.confidence >= 0 && row.confidence <= 1
        ? row.confidence
        : 0.5
    out.push({ kind, method, issuer, date, amount, memo, confidence })
  }
  return out
}

const rowKey = (r: RawRow): string => `${r.kind}|${r.date ?? '?'}|${r.amount}`

export async function classifyText(
  scope: OwnedScope,
  rawText: string
): Promise<DalResult<ClassifyResult>> {
  const text = rawText.trim().slice(0, CLASSIFY_MAX_TEXT_CHARS)
  if (!text) return dalErr(400, 'raw_text is required')

  const issuersRes = await listIssuers(scope)
  if (!issuersRes.ok) return issuersRes
  const issuers = issuersRes.data
  const issuerByName = new Map(issuers.map((i) => [i.name.toLowerCase(), i]))

  const today = todayKst()
  // Two-model cross-check: the first two ADVISORY_MODELS slots (Terra +
  // Sonnet). Classification input can be long — the third model is reserved
  // for match inference where divergence matters most.
  const panel = ADVISORY_MODELS.slice(0, 2)
  const answers = await askModelsJson(
    scope,
    panel,
    buildSystemPrompt(
      issuers.map((i) => i.name),
      today
    ),
    text,
    CLASSIFY_MAX_COMPLETION_TOKENS
  )

  const perModel = answers
    .map((a) => ({ model: a.model, rows: a.json != null ? parseModelRows(a.json) : null }))
    .filter((m): m is { model: string; rows: RawRow[] } => m.rows != null)

  if (perModel.length === 0) {
    return dalErr(502, '모든 분류 모델이 실패했습니다 — 잠시 후 다시 시도하세요.')
  }

  // Cross-check by (kind, date, amount) as MULTISETS — a text can genuinely
  // contain two identical rows (two same-amount deposits), so we align
  // occurrence-by-occurrence. A row both models produced is 'agreed'
  // (confidence raised, details merged preferring the more confident model);
  // a row only one model saw is kept but flagged needs_review with capped
  // confidence — cross-check never silently drops or invents.
  const byKey = (list: RawRow[]): Map<string, RawRow[]> => {
    const map = new Map<string, RawRow[]>()
    for (const row of list) {
      const bucket = map.get(rowKey(row)) ?? []
      bucket.push(row)
      map.set(rowKey(row), bucket)
    }
    return map
  }
  const mapA = byKey(perModel[0]!.rows)
  const mapB = perModel.length >= 2 ? byKey(perModel[1]!.rows) : new Map<string, RawRow[]>()
  const bothResponded = perModel.length >= 2

  const rows: ClassifiedRow[] = []
  for (const key of new Set([...mapA.keys(), ...mapB.keys()])) {
    const a = mapA.get(key) ?? []
    const b = mapB.get(key) ?? []
    const agreedCount = bothResponded ? Math.min(a.length, b.length) : 0
    const total = Math.max(a.length, b.length)
    for (let i = 0; i < total; i++) {
      const rowA = a[i]
      const rowB = b[i]
      const agreed = i < agreedCount
      const best =
        rowA && rowB ? (rowB.confidence > rowA.confidence ? rowB : rowA) : (rowA ?? rowB)!
      const issuer = best.issuer ? (issuerByName.get(best.issuer.toLowerCase()) ?? null) : null
      const confidence = agreed
        ? Math.min(0.95, Math.max(rowA?.confidence ?? 0, rowB?.confidence ?? 0, 0.8))
        : Math.min(bothResponded ? 0.55 : 0.65, best.confidence)
      rows.push({
        kind: best.kind,
        method_code: best.method ?? (issuer ? 'card' : null),
        issuer_id: issuer?.id ?? null,
        issuer_name: issuer?.name ?? (best.issuer || null),
        date: best.date,
        amount: best.amount,
        memo: best.memo,
        confidence,
        needs_review: !agreed || (issuer == null && best.issuer != null),
        agreement: agreed ? '2/2' : `1/${perModel.length}`,
      })
    }
  }

  rows.sort((a, b) => (a.date ?? '9999').localeCompare(b.date ?? '9999') || a.kind.localeCompare(b.kind))

  return dalOk({
    rows,
    model_timings: answers.map((a) => ({ model: a.model, elapsed_ms: a.elapsed_ms, ok: a.ok })),
    models_responded: perModel.length,
  })
}
