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

export const SALE_KINDS = ['card', 'app_voucher', 'manual_total', 'cash'] as const
export type SaleKind = (typeof SALE_KINDS)[number]

export const ENTRY_SOURCES = ['pos_import', 'voucher_tally', 'manual'] as const
export type EntrySource = (typeof ENTRY_SOURCES)[number]

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
  created_at: string
}

export type DepositRecord = {
  id: string
  user_id: string
  raw_document_id: string | null
  deposit_date: string
  actual_amount: number
  channel_hint: string | null
  confidence: number | null
  confirm_status: ConfirmStatus
  created_at: string
}

export const ADVISORY_CONFIDENCES = ['low', 'medium', 'high'] as const
export type AdvisoryConfidence = (typeof ADVISORY_CONFIDENCES)[number]

/**
 * Single-AI estimate of why an amount_mismatch exists.
 * Advisory only — never auto-accepts or changes reconciliation status.
 */
export type DiscrepancyAdvisory = {
  estimated_cause: string
  confidence: AdvisoryConfidence
  reasoning: string
}

export function parseDiscrepancyAdvisory(value: unknown): DiscrepancyAdvisory | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const row = value as Record<string, unknown>
  const cause = typeof row.estimated_cause === 'string' ? row.estimated_cause.trim() : ''
  const reasoning = typeof row.reasoning === 'string' ? row.reasoning.trim() : ''
  const confidence = row.confidence
  if (!cause || !reasoning) return null
  if (confidence !== 'low' && confidence !== 'medium' && confidence !== 'high') return null
  return { estimated_cause: cause, confidence, reasoning }
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
