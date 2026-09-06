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
import { crossCheckClassifications, type RawClassified } from '@/lib/reconciliation/classify-merge'
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
 * that BOTH models produce (same date + amount + kind) are 'agreed'.
 * Same date + amount but different kind (매출 vs 입금) is ONE row at
 * low confidence with kind_disputed — the owner must confirm before save.
 * Bank-statement / issuer-memo lines are forced toward deposit; 출금 is
 * dropped. Dates come from printed text (집계일시 / YY/MM/DD), never today.
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
  /** Models disagreed on 매출 vs 입금 — owner must tap the toggle before save. */
  kind_disputed: boolean
  /** Printed date missing or unreadable — never filled with today. */
  date_unreadable: boolean
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
    'SALE = money the store charged a customer (POS 승인내역, 카드매출, 현금, 상품권). A refund/cancellation is a SALE with a NEGATIVE amount.',
    'DEPOSIT = money arriving in the bank (입금 알림, 통장, 카드사 정산 입금).',
    'HARD RULES — sale vs deposit:',
    '- Text containing 입출금안내 / 입금 / 출금 / 적요 / 잔액 / 거래일자 is a BANK line → kind=deposit, NEVER sale.',
    '- A card-issuer code stuck to digits (삼성17938696, NH15524303, 하나90343621, 신한11895817) is a DEPOSIT memo, not a sale.',
    '- 출금 lines (e.g. 제민신협(체크기) 5,500 출금) must be OMITTED entirely — neither sale nor deposit.',
    '- HINT (not a hard rule): POS card sales are often round-ish thousands (31,500 / 94,500 / 176,000). Card-settlement deposits are net-of-fee with odd trailing digits (42,636 / 68,033 / 31,453). Use this as reasoning material only.',
    `Payment method codes: card(카드), app_voucher(앱상품권: 탐나는전/온누리 앱), barcode_pay(바코드결제), delivery_app(배달앱), foreign_pay(알리페이/위챗), tax_free(택스프리), cash(현금), transfer(계좌이체), paper_voucher(지류상품권). Use null when the method is not stated.`,
    `Card issuers at this store: ${issuerNames.join(', ')}. Use the exact name; null when not identifiable.`,
    'DATES: YYYY-MM-DD copied from the text. POS 승인내역 prints 집계일시, 집계기간, and per-line dates as YY/MM/DD (e.g. 26/09/05 → 2026-09-05). Never guess, never use today as the date.',
    `Today is ${today} (KST) — that is NOT a fallback date. If a date cannot be read, date=null.`,
    'Amounts: integer won, signed (refund → negative). Skip 잔액/balance lines, totals that duplicate itemized rows, and non-transactional text.',
    'Respond with ONLY a compact JSON array, no prose:',
    '[{"kind":"sale"|"deposit","method":"<code or null>","issuer":"<name or null>","date":"YYYY-MM-DD or null","amount":<signed won>,"memo":"<short source snippet>","confidence":<0..1>}]',
    'Do not invent rows that are not in the text. An empty array is a valid answer.',
  ].join(' ')
}

function parseModelRows(json: unknown): RawClassified[] {
  if (!Array.isArray(json)) return []
  const out: RawClassified[] = []
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
    .filter((m): m is { model: string; rows: RawClassified[] } => m.rows != null)

  if (perModel.length === 0) {
    return dalErr(502, '모든 분류 모델이 실패했습니다 — 잠시 후 다시 시도하세요.')
  }

  const rows = crossCheckClassifications(
    perModel[0]!.rows,
    perModel.length >= 2 ? perModel[1]!.rows : null,
    text,
    issuerByName
  )

  return dalOk({
    rows,
    model_timings: answers.map((a) => ({ model: a.model, elapsed_ms: a.elapsed_ms, ok: a.ok })),
    models_responded: perModel.length,
  })
}
