/**
 * 대사기 Stage 0 — row shapes + allowed value sets.
 *
 * These types are the contract between the DAL and API routes.
 * They do not import Supabase. Safe to share with a future UI.
 */

export const SOURCE_TYPES = [
  'sms',
  'kakao',
  'email',
  'receipt_image',
  'handwritten',
  'excel',
  'manual',
] as const
export type SourceType = (typeof SOURCE_TYPES)[number]

export const PARSE_STATUSES = ['pending', 'parsing', 'parsed', 'failed'] as const
export type ParseStatus = (typeof PARSE_STATUSES)[number]

export const CONFIRM_STATUSES = ['pending', 'confirmed', 'edited'] as const
export type ConfirmStatus = (typeof CONFIRM_STATUSES)[number]

export const FEE_TYPES = ['percent', 'fixed', 'tiered'] as const
export type FeeType = (typeof FEE_TYPES)[number]

export const RECON_STATUSES = [
  'matched',
  'missing_deposit',
  'amount_mismatch',
  'date_anomaly',
  'unmatched_deposit',
] as const
export type ReconStatus = (typeof RECON_STATUSES)[number]

export const SECURITY_FLAGS = ['none', 'fake_deposit_suspected', 'anomaly'] as const
export type SecurityFlag = (typeof SECURITY_FLAGS)[number]

export const SALE_KINDS = [
  'card',
  'app_voucher',
  'paper_voucher',
  'cash',
  'manual_total',
] as const
export type SaleKind = (typeof SALE_KINDS)[number]

/** Cash and paper vouchers are excluded from automatic deposit matchers. */
export function saleKindExemptFromReconcile(kind: string): boolean {
  return kind === 'cash' || kind === 'paper_voucher'
}

export const ENTRY_SOURCES = ['pos_import', 'voucher_tally', 'manual'] as const
export type EntrySource = (typeof ENTRY_SOURCES)[number]

// ── Step-2 redesign: methods, issuers, proposals ─────────────────────────────

/**
 * payment_method_defs.code values (Step-1 schema). is_reconciled=true → 대사
 * (matched against bank deposits); false → 정산 전용 (monthly closing only,
 * never missing_deposit, never a reconciliation row).
 */
export const RECONCILED_METHOD_CODES = [
  'card',
  'app_voucher',
  'barcode_pay',
  'delivery_app',
  'foreign_pay',
  'tax_free',
] as const
export const SETTLEMENT_ONLY_METHOD_CODES = ['cash', 'transfer', 'paper_voucher'] as const
export type MethodCode =
  | (typeof RECONCILED_METHOD_CODES)[number]
  | (typeof SETTLEMENT_ONLY_METHOD_CODES)[number]

export type PaymentMethodDef = {
  code: string
  label_ko: string
  label_en: string
  is_reconciled: boolean
  sort_order: number
  notes: string | null
}

/** Per-user card issuer master (card_issuers). fee_rate is a FRACTION: 0.0015 = 0.15%. */
export type CardIssuer = {
  id: string
  user_id: string
  name: string
  /** FRACTION of gross (0.0015 = 0.15%) — NOT percent. See lib/reconciliation/fees.ts. */
  fee_rate: number
  settlement_days: number
  /** Deposits accepted in [sale_date, sale_date + settlement_days + settlement_window_days]. */
  settlement_window_days: number
  /** Bank-memo fragments identifying this issuer ("NH15524303" → NH). Learning store. */
  memo_aliases: string[]
  is_active: boolean
  display_order: number
  created_at: string
  updated_at: string
}

/** Who resolved a deposit's issuer. 'ai' requires the Step-2 CHECK widening migration. */
export const ISSUER_SOURCES = ['parser', 'user', 'ai'] as const
export type IssuerSource = (typeof ISSUER_SOURCES)[number]

/** Where a reconciliation row came from: deterministic engine or owner-confirmed AI proposal. */
export const RECON_SOURCES = ['deterministic', 'ai_confirmed'] as const
export type ReconSource = (typeof RECON_SOURCES)[number]

export const PROPOSAL_STATUSES = ['pending', 'approved', 'rejected', 'superseded'] as const
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number]

/** One model's vote in match inference: which candidate sales this deposit represents. */
export type ProposalModelVote = {
  model: string
  sale_ids: string[]
  confidence: AdvisoryConfidence
  reasoning: string
}

/**
 * AI-inferred match PROPOSAL (reconciliation_match_proposals). Never a
 * reconciliation by itself — the owner approves/rejects/edits, and only
 * approval creates a reconciliation row (source='ai_confirmed').
 */
export type MatchProposal = {
  id: string
  user_id: string
  deposit_record_id: string
  issuer_id: string | null
  method_code: string | null
  proposed_sale_ids: string[]
  /** What the owner actually confirmed (differs from proposed when edited). */
  approved_sale_ids: string[] | null
  expected_net_total: number | null
  deposit_amount: number
  /** expected_net_total − deposit_amount at proposal time. */
  residual_won: number | null
  confidence: AdvisoryConfidence
  /** e.g. "3/3" — models proposing the winning sale set / models responding. */
  agreement: string | null
  per_model: ProposalModelVote[] | null
  reasoning: string | null
  status: ProposalStatus
  correction_note: string | null
  reconciliation_id: string | null
  created_at: string
  decided_at: string | null
}

export type RawDocument = {
  id: string
  user_id: string
  source_type: SourceType
  raw_text: string | null
  storage_path: string | null
  parse_status: ParseStatus
  parse_error: string | null
  uploaded_at: string
}

export type PaymentChannel = {
  id: string
  user_id: string
  name: string
  channel_type: string
  created_at: string
}

export type ReconciliationRule = {
  id: string
  channel_id: string
  fee_type: FeeType
  fee_rate: number | null
  settlement_days: number
  tolerance_won: number
  tolerance_days: number
  effective_from: string
  effective_to: string | null
  notes: string | null
  created_at: string
}

export type SalesRecord = {
  id: string
  user_id: string
  raw_document_id: string | null
  channel_id: string | null
  sale_date: string
  gross_amount: number
  expected_net_amount: number | null
  expected_deposit_date: string | null
  confidence: number | null
  confirm_status: ConfirmStatus
  sale_kind: SaleKind
  sale_group_id: string | null
  entry_source: EntrySource
  /** Reporting only. Never used in expected_net or matching. */
  discount_amount: number | null
  /**
   * Card issuer this sale (or refund — negative gross_amount) settles
   * through. NULL for non-card methods / unattributed legacy rows.
   */
  issuer_id: string | null
  created_at: string
}

export type DepositRecord = {
  id: string
  user_id: string
  raw_document_id: string | null
  deposit_date: string
  actual_amount: number
  /** Counterparty / 적요. Used for HITL duplicate detection. Null allowed. */
  memo: string | null
  channel_hint: string | null
  confidence: number | null
  confirm_status: ConfirmStatus
  /** Resolved card issuer (from the memo). User-correctable; never assume a fixed route. */
  issuer_id: string | null
  /** 0..1 confidence of the memo → issuer resolution. NULL when unresolved/user-set. */
  issuer_confidence: number | null
  /** 'parser' (alias hit) | 'ai' (model consensus) | 'user' (manual fix). NULL = unresolved. */
  issuer_source: string | null
  created_at: string
}

export const ADVISORY_CONFIDENCES = ['low', 'medium', 'high'] as const
export type AdvisoryConfidence = (typeof ADVISORY_CONFIDENCES)[number]

/** One model's independent vote in the multi-AI cross-verification. */
export type AdvisoryModelVote = {
  model: string
  cause: string
  confidence: AdvisoryConfidence
  reasoning: string
}

/**
 * AI estimate of why an amount_mismatch exists.
 * Advisory only — never auto-accepts or changes reconciliation status.
 *
 * estimated_cause / confidence / reasoning are the CONSENSUS values (kept
 * top-level so pre-multi-AI consumers keep working; legacy single-AI rows
 * have only these three). The optional fields carry the multi-AI
 * cross-verification breakdown.
 */
export type DiscrepancyAdvisory = {
  estimated_cause: string
  confidence: AdvisoryConfidence
  reasoning: string
  consensus_cause?: string
  final_confidence?: AdvisoryConfidence
  /** e.g. "2/3" — models agreeing on the consensus cause / models responded. */
  agreement?: string
  models_requested?: number
  models_responded?: number
  per_model?: AdvisoryModelVote[]
}

function asAdvisoryConfidence(value: unknown): AdvisoryConfidence | null {
  if (typeof value !== 'string') return null
  const v = value.trim().toLowerCase()
  if (v === 'low' || v === '낮음' || v === '하') return 'low'
  if (v === 'medium' || v === 'med' || v === '중간' || v === '중') return 'medium'
  if (v === 'high' || v === '높음' || v === '상') return 'high'
  return null
}

export function parseDiscrepancyAdvisory(value: unknown): DiscrepancyAdvisory | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const row = value as Record<string, unknown>
  const cause = typeof row.estimated_cause === 'string' ? row.estimated_cause.trim() : ''
  const reasoning = typeof row.reasoning === 'string' ? row.reasoning.trim() : ''
  const confidence = asAdvisoryConfidence(row.confidence)
  if (!cause || !reasoning || !confidence) return null
  const advisory: DiscrepancyAdvisory = { estimated_cause: cause, confidence, reasoning }

  if (typeof row.consensus_cause === 'string' && row.consensus_cause.trim()) {
    advisory.consensus_cause = row.consensus_cause.trim()
  }
  const finalConfidence = asAdvisoryConfidence(row.final_confidence)
  if (finalConfidence) advisory.final_confidence = finalConfidence
  if (typeof row.agreement === 'string' && /^\d+\/\d+$/.test(row.agreement)) {
    advisory.agreement = row.agreement
  }
  if (typeof row.models_requested === 'number' && Number.isInteger(row.models_requested)) {
    advisory.models_requested = row.models_requested
  }
  if (typeof row.models_responded === 'number' && Number.isInteger(row.models_responded)) {
    advisory.models_responded = row.models_responded
  }
  if (Array.isArray(row.per_model)) {
    const votes: AdvisoryModelVote[] = []
    for (const item of row.per_model) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue
      const vote = item as Record<string, unknown>
      const model = typeof vote.model === 'string' ? vote.model.trim() : ''
      const voteCause = typeof vote.cause === 'string' ? vote.cause.trim() : ''
      const voteReasoning = typeof vote.reasoning === 'string' ? vote.reasoning.trim() : ''
      const voteConfidence = asAdvisoryConfidence(vote.confidence)
      if (!model || !voteCause || !voteReasoning || !voteConfidence) continue
      votes.push({ model, cause: voteCause, confidence: voteConfidence, reasoning: voteReasoning })
    }
    if (votes.length > 0) advisory.per_model = votes
  }
  return advisory
}

export type Reconciliation = {
  id: string
  user_id: string
  status: ReconStatus
  discrepancy_amount: number | null
  discrepancy_reason: string | null
  security_flag: SecurityFlag
  resolved: boolean
  created_at: string
  /** Persisted AI estimate; null until the user triggers explain-discrepancy. */
  discrepancy_advisory: DiscrepancyAdvisory | null
  /** Card issuer this result concerns (per-issuer engine). NULL for non-card / legacy rows. */
  issuer_id?: string | null
  /** payment_method_defs.code. Only is_reconciled methods ever appear here. */
  method_code?: string | null
  /** 'deterministic' | 'ai_confirmed'. Optional until the Step-2 SQL adds the column. */
  source?: string | null
}

export type ReconciliationMatch = {
  id: string
  reconciliation_id: string
  // Exactly one side may be null after the Stage-1 one-sided migration:
  //   missing_deposit  → deposit_record_id is null
  //   unmatched_deposit → sales_record_id is null
  sales_record_id: string | null
  deposit_record_id: string | null
}

export type ReconciliationWithMatches = Reconciliation & {
  matches: ReconciliationMatch[]
}

export type MonthlyReconciliationSummary = {
  month: string
  from: string
  to: string
  total_sales: number
  total_discount: number
  sales_by_kind: Record<SaleKind, { amount: number; count: number }>
  deposits: {
    total_amount: number
    total_count: number
    matched_amount: number
    matched_count: number
    unmatched_amount: number
    unmatched_count: number
  }
  counts: {
    matched: number
    missing_deposit: number
    amount_mismatch: number
    paper_voucher_pending: number
  }
  paper_voucher_pending_amount: number
}

export type DalOk<T> = { ok: true; data: T }
export type DalErr = { ok: false; status: number; error: string }
export type DalResult<T> = DalOk<T> | DalErr

export const USER_OWNED_TABLES = [
  'raw_documents',
  'payment_channels',
  'sales_records',
  'deposit_records',
  'reconciliations',
] as const
export type UserOwnedTable = (typeof USER_OWNED_TABLES)[number]
