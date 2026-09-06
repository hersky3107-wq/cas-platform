'use client'

/**
 * 장부 화면 공용 모듈 — Korean-only labels, class tokens, fetch helper, and
 * CLIENT-SAFE mirrors of server route response shapes.
 *
 * The server modules (classify.ts / ask.ts / proposals-db.ts) import
 * 'server-only', so their exported types cannot be imported here — the view
 * types below mirror the route JSON contracts instead.
 */

import { authenticatedFetch } from '@/lib/api/authenticated-fetch'
import type {
  AdvisoryConfidence,
  DepositRecord,
  MatchProposal,
  SalesRecord,
} from '@/lib/reconciliation/types'

/* ── fetch ────────────────────────────────────────────────────────────────── */

export async function apiJson<T>(url: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const method = init?.method ?? 'GET'
  const res = await authenticatedFetch(url, { ...init, cache: 'no-store' })
  const text = await res.text()
  let parsed: unknown = null
  let isJson = false
  if (text) {
    try {
      parsed = JSON.parse(text) as unknown
      isJson = true
    } catch {
      isJson = false
    }
  } else {
    isJson = true
  }
  if (!res.ok || !isJson) {
    const fromBody =
      isJson && parsed && typeof parsed === 'object' && 'error' in parsed
        ? String((parsed as { error: unknown }).error)
        : null
    console.error('[장부] request failed', { method, url, status: res.status, body: text.slice(0, 200) })
    throw new Error(fromBody || `요청이 실패했어요 (HTTP ${res.status})`)
  }
  return parsed as T
}

/* ── view types mirroring server route JSON ──────────────────────────────── */

export type ClassifiedRowView = {
  kind: 'sale' | 'deposit'
  method_code: string | null
  issuer_id: string | null
  issuer_name: string | null
  date: string | null
  amount: number
  memo: string | null
  confidence: number
  needs_review: boolean
  agreement: string
}

export type ClassifyResponse = {
  document_id: string
  source_kind: 'text' | 'image' | 'spreadsheet'
  rows: ClassifiedRowView[]
  models_responded: number
}

export type ProposalView = MatchProposal & {
  deposit: Pick<DepositRecord, 'id' | 'deposit_date' | 'actual_amount' | 'memo' | 'issuer_id'> | null
  issuer_name: string | null
  proposed_sales: Pick<SalesRecord, 'id' | 'sale_date' | 'gross_amount' | 'issuer_id' | 'sale_kind'>[]
}

export type AskResponse = {
  answer: string
  confidence: AdvisoryConfidence
  citations: { ref: string; text: string }[]
  month: string
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

export type EngineSummaryView = {
  created: number
  matched: number
  missing_deposit: number
  unmatched_deposit: number
  deposits_left_open: number
  sales_left_open: number
  unassigned_deposits: number
  unassigned_sales: number
}

/* ── formatting ──────────────────────────────────────────────────────────── */

export function won(n: number): string {
  return `${Math.round(n).toLocaleString('ko-KR')}원`
}

/** '2026-09-01' → '9/1' (장부는 한 해 안에서 읽는 화면이라 연도는 생략). */
export function dateKo(iso: string | null | undefined): string {
  if (!iso) return '날짜 없음'
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return iso
  return `${Number(m[2])}/${Number(m[3])}`
}

export function currentMonthString(): string {
  const d = new Date(Date.now() + 9 * 3_600_000) // KST
  return d.toISOString().slice(0, 7)
}

export function shiftMonth(monthStr: string, delta: number): string {
  const [y, m] = monthStr.split('-').map(Number)
  if (!y || !m) return currentMonthString()
  const date = new Date(Date.UTC(y, m - 1 + delta, 1))
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}

export function addDaysIsoClient(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const date = new Date(Date.UTC(y!, m! - 1, d! + days))
  return date.toISOString().slice(0, 10)
}

/* ── domain labels (plain shop Korean — no jargon, no English) ───────────── */

export const METHOD_KO: Record<string, string> = {
  card: '카드',
  app_voucher: '앱상품권',
  barcode_pay: '바코드결제',
  delivery_app: '배달앱',
  foreign_pay: '알리·위챗페이',
  tax_free: '택스프리',
  cash: '현금',
  transfer: '계좌이체',
  paper_voucher: '종이상품권',
  manual_total: '직접 적음',
}

export function confidenceKo(c: AdvisoryConfidence): string {
  if (c === 'high') return '높음'
  if (c === 'medium') return '중간'
  return '낮음'
}

/** '3/3' → 'AI 3개 중 3개가 같은 답'. */
export function agreementKo(agreement: string | null | undefined): string | null {
  const m = agreement?.match(/^(\d+)\/(\d+)$/)
  if (!m) return null
  return `AI ${m[2]}개 중 ${m[1]}개가 같은 답`
}

export const STATUS_KO: Record<string, string> = {
  matched: '확인됨',
  missing_deposit: '아직 안 들어옴',
  amount_mismatch: '금액 다름',
  unmatched_deposit: '주인 모를 입금',
  date_anomaly: '날짜 이상',
}

/* ── class tokens (기존 디자인 언어: slate-50 캔버스, 흰 rounded-2xl 카드, slate-900 버튼) ── */

export const CARD = 'rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5'
export const INPUT =
  'w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-base text-slate-900 ' +
  'placeholder:text-slate-400 focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-200'
export const BTN_PRIMARY =
  'inline-flex min-h-12 items-center justify-center rounded-xl bg-slate-900 px-5 text-base ' +
  'font-semibold text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50'
export const BTN_GHOST =
  'inline-flex min-h-12 items-center justify-center rounded-xl border border-slate-300 bg-white px-4 ' +
  'text-base font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50'
export const ERROR_TEXT = 'mt-3 rounded-xl bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700'

export const BADGE_AI =
  'inline-flex items-center gap-1 rounded-full border border-sky-300 bg-sky-50 px-2 py-0.5 text-[11px] font-bold text-sky-800'
export const BADGE_WARN =
  'inline-flex items-center rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-bold text-amber-800'

export const CONFIDENCE_BADGE: Record<AdvisoryConfidence, string> = {
  high: 'inline-flex items-center rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-800',
  medium:
    'inline-flex items-center rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-bold text-amber-800',
  low: 'inline-flex items-center rounded-full border border-rose-300 bg-rose-50 px-2 py-0.5 text-[11px] font-bold text-rose-800',
}

export const STATUS_BADGE: Record<string, string> = {
  matched:
    'inline-flex items-center rounded-full border border-emerald-300 bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-800',
  missing_deposit:
    'inline-flex items-center rounded-full border border-amber-300 bg-amber-50 px-2.5 py-1 text-xs font-bold text-amber-800',
  amount_mismatch:
    'inline-flex items-center rounded-full border border-rose-300 bg-rose-50 px-2.5 py-1 text-xs font-bold text-rose-800',
  unmatched_deposit:
    'inline-flex items-center rounded-full border border-violet-300 bg-violet-50 px-2.5 py-1 text-xs font-bold text-violet-800',
}
export const STATUS_BADGE_DEFAULT =
  'inline-flex items-center rounded-full border border-slate-300 bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-700'
