import 'server-only'

import { encryptText, decryptText } from '@/lib/db/crypto'
import { supabaseAdmin } from '@/lib/supabase/server'
import type { OwnedScope } from '@/lib/reconciliation/scope'
import {
  CHANNEL_PRESETS,
  channelExpectsDeposit,
  channelPresetById,
  expectedDepositDate as computeExpectedDepositDate,
  expectedNet as computeExpectedNet,
  ruleForChannelType,
  ruleFromRow,
  type ChannelPreset,
  type ChannelRule,
} from '@/lib/reconciliation/channel-rules'
import {
  CONFIRM_STATUSES,
  ENTRY_SOURCES,
  FEE_TYPES,
  PARSE_STATUSES,
  RECON_STATUSES,
  SALE_KINDS,
  SECURITY_FLAGS,
  SOURCE_TYPES,
  type ConfirmStatus,
  type DalResult,
  type DepositRecord,
  type DiscrepancyAdvisory,
  type FeeType,
  type PaymentChannel,
  type RawDocument,
  type Reconciliation,
  type ReconciliationMatch,
  type ReconciliationRule,
  type ReconciliationWithMatches,
  type SaleKind,
  type SalesRecord,
  type SecurityFlag,
} from '@/lib/reconciliation/types'

/**
 * 대사기 server DAL.
 *
 * CONTRACT:
 * - supabaseAdmin only. Never the browser/anon client (lib/db/supabase.ts).
 * - Every function takes OwnedScope from withOwnedScope(). There is no
 *   userId: string parameter that a route could fill from the request body.
 * - user-owned tables: every SELECT/UPDATE/DELETE is `.eq('user_id', scope.userId)`.
 *   Inserts stamp user_id from the scope and ignore any client-supplied owner.
 * - Child tables (rules, matches) have no user_id: ownership is checked via
 *   the parent row (channel / reconciliation) belonging to the scope.
 * - RLS is defense-in-depth. This module is the authorization gate.
 */

const RAW_TEXT_PREFIX = 'enc:v1:'
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function dalOk<T>(data: T): DalResult<T> {
  return { ok: true, data }
}

function dalErr(status: number, error: string): DalResult<never> {
  return { ok: false, status, error }
}

function fromSbError(error: { message: string; code?: string }): DalResult<never> {
  if (error.code === '23505') return dalErr(409, 'Already exists')
  if (error.code === '23503') return dalErr(400, 'Referenced record not found')
  if (error.code === '23514') return dalErr(400, 'Invalid value')
  console.error('[reconciliation] db error:', error.message)
  return dalErr(500, 'Database error')
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value)
}

function asUuid(value: unknown, field: string): DalResult<string> {
  if (!isUuid(value)) return dalErr(400, `${field} must be a uuid`)
  return dalOk(value)
}

function asOptionalUuid(value: unknown, field: string): DalResult<string | null> {
  if (value == null || value === '') return dalOk(null)
  return asUuid(value, field)
}

function asDate(value: unknown, field: string): DalResult<string> {
  if (typeof value !== 'string' || !DATE_RE.test(value)) {
    return dalErr(400, `${field} must be YYYY-MM-DD`)
  }
  return dalOk(value)
}

function asOptionalDate(value: unknown, field: string): DalResult<string | null> {
  if (value == null || value === '') return dalOk(null)
  return asDate(value, field)
}

function asNumber(value: unknown, field: string): DalResult<number> {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  if (!Number.isFinite(n)) return dalErr(400, `${field} must be a number`)
  return dalOk(n)
}

function asOptionalNumber(value: unknown, field: string): DalResult<number | null> {
  if (value == null || value === '') return dalOk(null)
  return asNumber(value, field)
}

function asInt(value: unknown, field: string, fallback?: number): DalResult<number> {
  if (value == null || value === '') {
    if (fallback !== undefined) return dalOk(fallback)
    return dalErr(400, `${field} is required`)
  }
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isInteger(n)) return dalErr(400, `${field} must be an integer`)
  return dalOk(n)
}

function asOptionalString(value: unknown): string | null {
  if (value == null) return null
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], field: string): DalResult<T> {
  if (typeof value === 'string' && (allowed as readonly string[]).includes(value)) {
    return dalOk(value as T)
  }
  return dalErr(400, `${field} must be one of: ${allowed.join(', ')}`)
}

function optionalOneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
  field: string
): DalResult<T | null> {
  if (value == null || value === '') return dalOk(null)
  return oneOf(value, allowed, field)
}

function encryptRawText(plain: string): string {
  return RAW_TEXT_PREFIX + encryptText(plain)
}

function decryptRawText(stored: string | null): string | null {
  if (stored == null) return null
  if (!stored.startsWith(RAW_TEXT_PREFIX)) return stored
  try {
    return decryptText(stored.slice(RAW_TEXT_PREFIX.length))
  } catch (e) {
    console.error('[reconciliation] raw_text decrypt failed:', e instanceof Error ? e.message : e)
    return null
  }
}

function decodeDocument(row: RawDocument): RawDocument {
  return { ...row, raw_text: decryptRawText(row.raw_text) }
}

function stripOwner(input: Record<string, unknown>): Record<string, unknown> {
  const { user_id: _a, userId: _b, ...rest } = input
  return rest
}

function filterOwned<T extends { user_id: string }>(rows: T[], scope: OwnedScope): T[] {
  return rows.filter((row) => row.user_id === scope.userId)
}

function requireReturnedOwner<T extends { user_id: string }>(
  row: T | null,
  scope: OwnedScope
): DalResult<T> {
  if (!row || row.user_id !== scope.userId) return dalErr(404, 'Not found')
  return dalOk(row)
}

async function requireOwnedRow(
  table: 'raw_documents' | 'payment_channels' | 'sales_records' | 'deposit_records' | 'reconciliations',
  scope: OwnedScope,
  id: string,
  label: string
): Promise<DalResult<{ id: string }>> {
  const { data, error } = await supabaseAdmin
    .from(table)
    .select('id')
    .eq('id', id)
    .eq('user_id', scope.userId)
    .maybeSingle()
  if (error) return fromSbError(error)
  if (!data) return dalErr(404, `${label} not found`)
  return dalOk(data)
}

async function requireOwnedChannel(
  scope: OwnedScope,
  channelId: string
): Promise<DalResult<{ id: string }>> {
  return requireOwnedRow('payment_channels', scope, channelId, 'Channel')
}

async function requireOwnedDocument(
  scope: OwnedScope,
  documentId: string
): Promise<DalResult<{ id: string }>> {
  return requireOwnedRow('raw_documents', scope, documentId, 'Document')
}

async function requireOwnedSale(
  scope: OwnedScope,
  saleId: string
): Promise<DalResult<{ id: string }>> {
  return requireOwnedRow('sales_records', scope, saleId, 'Sales record')
}

async function requireOwnedDeposit(
  scope: OwnedScope,
  depositId: string
): Promise<DalResult<{ id: string }>> {
  return requireOwnedRow('deposit_records', scope, depositId, 'Deposit record')
}

async function requireOwnedReconciliation(
  scope: OwnedScope,
  reconId: string
): Promise<DalResult<{ id: string }>> {
  return requireOwnedRow('reconciliations', scope, reconId, 'Reconciliation')
}

async function requireOwnedRule(
  scope: OwnedScope,
  ruleId: string
): Promise<DalResult<ReconciliationRule>> {
  const idCheck = asUuid(ruleId, 'id')
  if (!idCheck.ok) return idCheck
  const { data, error } = await supabaseAdmin
    .from('reconciliation_rules')
    .select('*')
    .eq('id', ruleId)
    .maybeSingle()
  if (error) return fromSbError(error)
  if (!data) return dalErr(404, 'Rule not found')
  const owned = await requireOwnedChannel(scope, data.channel_id as string)
  if (!owned.ok) return dalErr(404, 'Rule not found')
  return dalOk(data as ReconciliationRule)
}

// ── documents ────────────────────────────────────────────────────────────────

export async function listDocuments(
  scope: OwnedScope,
  filters?: { parse_status?: string | null }
): Promise<DalResult<Omit<RawDocument, 'raw_text'>[]>> {
  let q = supabaseAdmin
    .from('raw_documents')
    .select('id, user_id, source_type, storage_path, parse_status, parse_error, uploaded_at')
    .eq('user_id', scope.userId)
    .order('uploaded_at', { ascending: false })

  if (filters?.parse_status) {
    const status = oneOf(filters.parse_status, PARSE_STATUSES, 'parse_status')
    if (!status.ok) return status
    q = q.eq('parse_status', status.data)
  }

  const { data, error } = await q
  if (error) return fromSbError(error)
  return dalOk(filterOwned((data ?? []) as Omit<RawDocument, 'raw_text'>[], scope))
}

export async function getDocument(scope: OwnedScope, id: string): Promise<DalResult<RawDocument>> {
  const idCheck = asUuid(id, 'id')
  if (!idCheck.ok) return idCheck
  const { data, error } = await supabaseAdmin
    .from('raw_documents')
    .select('*')
    .eq('id', id)
    .eq('user_id', scope.userId)
    .maybeSingle()
  if (error) return fromSbError(error)
  const owned = requireReturnedOwner(data as RawDocument | null, scope)
  if (!owned.ok) return owned
  return dalOk(decodeDocument(owned.data))
}

export async function createDocument(
  scope: OwnedScope,
  input: Record<string, unknown>
): Promise<DalResult<RawDocument>> {
  const fields = stripOwner(input)
  const source = oneOf(fields.source_type, SOURCE_TYPES, 'source_type')
  if (!source.ok) return source

  const rawText = asOptionalString(fields.raw_text)
  const storagePath = asOptionalString(fields.storage_path)
  if (!rawText && !storagePath) {
    return dalErr(400, 'raw_text or storage_path is required')
  }

  const { data, error } = await supabaseAdmin
    .from('raw_documents')
    .insert({
      user_id: scope.userId,
      source_type: source.data,
      raw_text: rawText ? encryptRawText(rawText) : null,
      storage_path: storagePath,
      parse_status: 'pending',
    })
    .select('*')
    .single()
  if (error) return fromSbError(error)
  const owned = requireReturnedOwner(data as RawDocument, scope)
  if (!owned.ok) return owned
  return dalOk(decodeDocument(owned.data))
}

export async function updateDocument(
  scope: OwnedScope,
  id: string,
  input: Record<string, unknown>
): Promise<DalResult<RawDocument>> {
  const idCheck = asUuid(id, 'id')
  if (!idCheck.ok) return idCheck
  const fields = stripOwner(input)
  const patch: Record<string, unknown> = {}

  if ('source_type' in fields) {
    const source = oneOf(fields.source_type, SOURCE_TYPES, 'source_type')
    if (!source.ok) return source
    patch.source_type = source.data
  }
  if ('parse_status' in fields) {
    const status = oneOf(fields.parse_status, PARSE_STATUSES, 'parse_status')
    if (!status.ok) return status
    patch.parse_status = status.data
  }
  if ('parse_error' in fields) {
    patch.parse_error = asOptionalString(fields.parse_error)
  }
  if ('storage_path' in fields) {
    patch.storage_path = asOptionalString(fields.storage_path)
  }
  if ('raw_text' in fields) {
    const rawText = asOptionalString(fields.raw_text)
    patch.raw_text = rawText ? encryptRawText(rawText) : null
  }
  if (Object.keys(patch).length === 0) return dalErr(400, 'No fields to update')

  const { data, error } = await supabaseAdmin
    .from('raw_documents')
    .update(patch)
    .eq('id', id)
    .eq('user_id', scope.userId)
    .select('*')
    .maybeSingle()
  if (error) return fromSbError(error)
  const owned = requireReturnedOwner(data as RawDocument | null, scope)
  if (!owned.ok) return owned
  return dalOk(decodeDocument(owned.data))
}

export async function deleteDocument(scope: OwnedScope, id: string): Promise<DalResult<{ deleted: true }>> {
  const idCheck = asUuid(id, 'id')
  if (!idCheck.ok) return idCheck
  const { data, error } = await supabaseAdmin
    .from('raw_documents')
    .delete()
    .eq('id', id)
    .eq('user_id', scope.userId)
    .select('id')
    .maybeSingle()
  if (error) return fromSbError(error)
  if (!data) return dalErr(404, 'Not found')
  return dalOk({ deleted: true })
}

// ── channels ─────────────────────────────────────────────────────────────────

export async function listChannels(scope: OwnedScope): Promise<DalResult<PaymentChannel[]>> {
  const { data, error } = await supabaseAdmin
    .from('payment_channels')
    .select('*')
    .eq('user_id', scope.userId)
    .order('created_at', { ascending: true })
  if (error) return fromSbError(error)
  return dalOk(filterOwned((data ?? []) as PaymentChannel[], scope))
}

export async function getChannel(scope: OwnedScope, id: string): Promise<DalResult<PaymentChannel>> {
  const idCheck = asUuid(id, 'id')
  if (!idCheck.ok) return idCheck
  const { data, error } = await supabaseAdmin
    .from('payment_channels')
    .select('*')
    .eq('id', id)
    .eq('user_id', scope.userId)
    .maybeSingle()
  if (error) return fromSbError(error)
  return requireReturnedOwner(data as PaymentChannel | null, scope)
}

/**
 * Look up a channel by exact name (channels are unique per user by name —
 * `payment_channels_user_name_uniq`). Returns null, not an error, when there
 * is no such channel yet, so a caller can decide whether to create one.
 */
export async function findChannelByName(
  scope: OwnedScope,
  name: string
): Promise<DalResult<PaymentChannel | null>> {
  const { data, error } = await supabaseAdmin
    .from('payment_channels')
    .select('*')
    .eq('user_id', scope.userId)
    .eq('name', name)
    .maybeSingle()
  if (error) return fromSbError(error)
  return dalOk((data as PaymentChannel | null) ?? null)
}

/**
 * Find-or-create by name, for parse paths that name a channel from extracted
 * text (e.g. a voucher_type) rather than a caller-supplied channel_id.
 */
export async function findOrCreateChannel(
  scope: OwnedScope,
  name: string,
  channelType: string
): Promise<DalResult<PaymentChannel>> {
  const existing = await findChannelByName(scope, name)
  if (!existing.ok) return existing
  if (existing.data) return dalOk(existing.data)
  return createChannel(scope, { name, channel_type: channelType })
}

export async function createChannel(
  scope: OwnedScope,
  input: Record<string, unknown>
): Promise<DalResult<PaymentChannel>> {
  const fields = stripOwner(input)

  // Optional preset (배달앱/해외간편결제 등): resolves name/channel_type and
  // seeds the initial reconciliation_rules row. Preset channel types always
  // reuse an existing engine (all current presets are card-type), so this is
  // data only — reconcile-card picks the channel up like any other card.
  let preset: ChannelPreset | null = null
  if (fields.preset != null) {
    const presetId = asOptionalString(fields.preset)
    preset = presetId ? channelPresetById(presetId) : null
    if (!preset) {
      const valid = CHANNEL_PRESETS.map((p) => p.id).join(', ')
      return dalErr(400, `Unknown preset — valid presets: ${valid}`)
    }
  }

  const name = asOptionalString(fields.name) ?? preset?.name ?? null
  const explicitType = asOptionalString(fields.channel_type)
  if (preset && explicitType && explicitType !== preset.channelType) {
    return dalErr(
      400,
      `preset '${preset.id}' is channel_type '${preset.channelType}' — omit channel_type or pass the matching one`
    )
  }
  const channelType = explicitType ?? preset?.channelType ?? null
  if (!name) return dalErr(400, 'name is required')
  if (!channelType) return dalErr(400, 'channel_type is required')

  const { data, error } = await supabaseAdmin
    .from('payment_channels')
    .insert({ user_id: scope.userId, name, channel_type: channelType })
    .select('*')
    .single()
  if (error) return fromSbError(error)
  const owned = requireReturnedOwner(data as PaymentChannel, scope)
  if (!owned.ok || !preset) return owned

  // Seed the preset's rule as a normal per-channel row — from here on it is
  // user-adjustable data exactly like a card rule (PATCH /rules, new rows).
  const { error: ruleError } = await supabaseAdmin.from('reconciliation_rules').insert({
    channel_id: owned.data.id,
    fee_type: preset.feeType,
    fee_rate: preset.feeRate,
    settlement_days: preset.settlementDays,
    tolerance_won: preset.toleranceWon,
    tolerance_days: preset.toleranceDays,
    effective_from: new Date().toISOString().slice(0, 10),
    effective_to: null,
    notes: preset.notes,
  })
  if (ruleError) {
    // Keep channel+rule creation atomic from the caller's view: roll the
    // channel back rather than leaving a preset channel on CARD_RULE 2.5%.
    await supabaseAdmin.from('payment_channels').delete().eq('id', owned.data.id)
    return fromSbError(ruleError)
  }
  return owned
}

export async function updateChannel(
  scope: OwnedScope,
  id: string,
  input: Record<string, unknown>
): Promise<DalResult<PaymentChannel>> {
  const idCheck = asUuid(id, 'id')
  if (!idCheck.ok) return idCheck
  const fields = stripOwner(input)
  const patch: Record<string, unknown> = {}
  if ('name' in fields) {
    const name = asOptionalString(fields.name)
    if (!name) return dalErr(400, 'name is required')
    patch.name = name
  }
  if ('channel_type' in fields) {
    const channelType = asOptionalString(fields.channel_type)
    if (!channelType) return dalErr(400, 'channel_type is required')
    patch.channel_type = channelType
  }
  if (Object.keys(patch).length === 0) return dalErr(400, 'No fields to update')

  const { data, error } = await supabaseAdmin
    .from('payment_channels')
    .update(patch)
    .eq('id', id)
    .eq('user_id', scope.userId)
    .select('*')
    .maybeSingle()
  if (error) return fromSbError(error)
  return requireReturnedOwner(data as PaymentChannel | null, scope)
}

export async function deleteChannel(scope: OwnedScope, id: string): Promise<DalResult<{ deleted: true }>> {
  const idCheck = asUuid(id, 'id')
  if (!idCheck.ok) return idCheck
  const { data, error } = await supabaseAdmin
    .from('payment_channels')
    .delete()
    .eq('id', id)
    .eq('user_id', scope.userId)
    .select('id')
    .maybeSingle()
  if (error) return fromSbError(error)
  if (!data) return dalErr(404, 'Not found')
  return dalOk({ deleted: true })
}

// ── rules (owned via channel) ────────────────────────────────────────────────

export async function listRules(
  scope: OwnedScope,
  filters?: { channel_id?: string | null }
): Promise<DalResult<ReconciliationRule[]>> {
  let channelIds: string[]
  if (filters?.channel_id) {
    const idCheck = asUuid(filters.channel_id, 'channel_id')
    if (!idCheck.ok) return idCheck
    const owned = await requireOwnedChannel(scope, idCheck.data)
    if (!owned.ok) return owned
    channelIds = [owned.data.id]
  } else {
    const { data, error } = await supabaseAdmin
      .from('payment_channels')
      .select('id')
      .eq('user_id', scope.userId)
    if (error) return fromSbError(error)
    channelIds = ((data ?? []) as { id: string }[]).map((row) => row.id)
  }
  if (channelIds.length === 0) return dalOk([])

  const { data, error } = await supabaseAdmin
    .from('reconciliation_rules')
    .select('*')
    .in('channel_id', channelIds)
    .order('effective_from', { ascending: false })
  if (error) return fromSbError(error)
  const allowed = new Set(channelIds)
  return dalOk(((data ?? []) as ReconciliationRule[]).filter((row) => allowed.has(row.channel_id)))
}

export async function getRule(scope: OwnedScope, id: string): Promise<DalResult<ReconciliationRule>> {
  return requireOwnedRule(scope, id)
}

export async function createRule(
  scope: OwnedScope,
  input: Record<string, unknown>
): Promise<DalResult<ReconciliationRule>> {
  const fields = stripOwner(input)
  const channelId = asUuid(fields.channel_id, 'channel_id')
  if (!channelId.ok) return channelId
  const owned = await requireOwnedChannel(scope, channelId.data)
  if (!owned.ok) return owned

  const feeType = fields.fee_type
    ? oneOf(fields.fee_type, FEE_TYPES, 'fee_type')
    : dalOk<FeeType>('percent')
  if (!feeType.ok) return feeType
  const feeRate = asOptionalNumber(fields.fee_rate, 'fee_rate')
  if (!feeRate.ok) return feeRate
  const settlementDays = asInt(fields.settlement_days, 'settlement_days', 0)
  if (!settlementDays.ok) return settlementDays
  const toleranceWon = asInt(fields.tolerance_won, 'tolerance_won', 0)
  if (!toleranceWon.ok) return toleranceWon
  const toleranceDays = asInt(fields.tolerance_days, 'tolerance_days', 0)
  if (!toleranceDays.ok) return toleranceDays
  const effectiveFrom = fields.effective_from
    ? asDate(fields.effective_from, 'effective_from')
    : dalOk(new Date().toISOString().slice(0, 10))
  if (!effectiveFrom.ok) return effectiveFrom
  const effectiveTo = asOptionalDate(fields.effective_to, 'effective_to')
  if (!effectiveTo.ok) return effectiveTo

  const { data, error } = await supabaseAdmin
    .from('reconciliation_rules')
    .insert({
      channel_id: owned.data.id,
      fee_type: feeType.data,
      fee_rate: feeRate.data,
      settlement_days: settlementDays.data,
      tolerance_won: toleranceWon.data,
      tolerance_days: toleranceDays.data,
      effective_from: effectiveFrom.data,
      effective_to: effectiveTo.data,
      notes: asOptionalString(fields.notes),
    })
    .select('*')
    .single()
  if (error) return fromSbError(error)
  const verify = await requireOwnedChannel(scope, (data as ReconciliationRule).channel_id)
  if (!verify.ok) return dalErr(500, 'Ownership mismatch')
  return dalOk(data as ReconciliationRule)
}

export async function updateRule(
  scope: OwnedScope,
  id: string,
  input: Record<string, unknown>
): Promise<DalResult<ReconciliationRule>> {
  const existing = await requireOwnedRule(scope, id)
  if (!existing.ok) return existing
  const fields = stripOwner(input)
  const patch: Record<string, unknown> = {}

  if ('channel_id' in fields) {
    const channelId = asUuid(fields.channel_id, 'channel_id')
    if (!channelId.ok) return channelId
    const owned = await requireOwnedChannel(scope, channelId.data)
    if (!owned.ok) return owned
    patch.channel_id = owned.data.id
  }
  if ('fee_type' in fields) {
    const feeType = oneOf(fields.fee_type, FEE_TYPES, 'fee_type')
    if (!feeType.ok) return feeType
    patch.fee_type = feeType.data
  }
  if ('fee_rate' in fields) {
    const feeRate = asOptionalNumber(fields.fee_rate, 'fee_rate')
    if (!feeRate.ok) return feeRate
    patch.fee_rate = feeRate.data
  }
  if ('settlement_days' in fields) {
    const n = asInt(fields.settlement_days, 'settlement_days')
    if (!n.ok) return n
    patch.settlement_days = n.data
  }
  if ('tolerance_won' in fields) {
    const n = asInt(fields.tolerance_won, 'tolerance_won')
    if (!n.ok) return n
    patch.tolerance_won = n.data
  }
  if ('tolerance_days' in fields) {
    const n = asInt(fields.tolerance_days, 'tolerance_days')
    if (!n.ok) return n
    patch.tolerance_days = n.data
  }
  if ('effective_from' in fields) {
    const d = asDate(fields.effective_from, 'effective_from')
    if (!d.ok) return d
    patch.effective_from = d.data
  }
  if ('effective_to' in fields) {
    const d = asOptionalDate(fields.effective_to, 'effective_to')
    if (!d.ok) return d
    patch.effective_to = d.data
  }
  if ('notes' in fields) patch.notes = asOptionalString(fields.notes)
  if (Object.keys(patch).length === 0) return dalErr(400, 'No fields to update')

  const { data, error } = await supabaseAdmin
    .from('reconciliation_rules')
    .update(patch)
    .eq('id', existing.data.id)
    .select('*')
    .maybeSingle()
  if (error) return fromSbError(error)
  if (!data) return dalErr(404, 'Rule not found')
  const verify = await requireOwnedChannel(scope, (data as ReconciliationRule).channel_id)
  if (!verify.ok) return dalErr(404, 'Rule not found')
  return dalOk(data as ReconciliationRule)
}

export async function deleteRule(scope: OwnedScope, id: string): Promise<DalResult<{ deleted: true }>> {
  const existing = await requireOwnedRule(scope, id)
  if (!existing.ok) return existing
  const { error } = await supabaseAdmin
    .from('reconciliation_rules')
    .delete()
    .eq('id', existing.data.id)
  if (error) return fromSbError(error)
  return dalOk({ deleted: true })
}

// ── sales ────────────────────────────────────────────────────────────────────

async function resolveOptionalOwnedFk(
  scope: OwnedScope,
  value: unknown,
  field: 'raw_document_id' | 'channel_id' | 'channel_hint'
): Promise<DalResult<string | null>> {
  const id = asOptionalUuid(value, field)
  if (!id.ok) return id
  if (!id.data) return dalOk(null)
  const owned =
    field === 'raw_document_id'
      ? await requireOwnedDocument(scope, id.data)
      : await requireOwnedChannel(scope, id.data)
  if (!owned.ok) return owned
  return dalOk(owned.data.id)
}

export async function listSales(
  scope: OwnedScope,
  filters?: { from?: string | null; to?: string | null; confirm_status?: string | null; channel_id?: string | null }
): Promise<DalResult<SalesRecord[]>> {
  let q = supabaseAdmin
    .from('sales_records')
    .select('*')
    .eq('user_id', scope.userId)
    .order('sale_date', { ascending: false })

  if (filters?.from) {
    const from = asDate(filters.from, 'from')
    if (!from.ok) return from
    q = q.gte('sale_date', from.data)
  }
  if (filters?.to) {
    const to = asDate(filters.to, 'to')
    if (!to.ok) return to
    q = q.lte('sale_date', to.data)
  }
  if (filters?.confirm_status) {
    const status = oneOf(filters.confirm_status, CONFIRM_STATUSES, 'confirm_status')
    if (!status.ok) return status
    q = q.eq('confirm_status', status.data)
  }
  if (filters?.channel_id) {
    const channel = await resolveOptionalOwnedFk(scope, filters.channel_id, 'channel_id')
    if (!channel.ok) return channel
    if (channel.data) q = q.eq('channel_id', channel.data)
  }

  const { data, error } = await q
  if (error) return fromSbError(error)
  return dalOk(filterOwned((data ?? []) as SalesRecord[], scope))
}

export async function getSale(scope: OwnedScope, id: string): Promise<DalResult<SalesRecord>> {
  const idCheck = asUuid(id, 'id')
  if (!idCheck.ok) return idCheck
  const { data, error } = await supabaseAdmin
    .from('sales_records')
    .select('*')
    .eq('id', id)
    .eq('user_id', scope.userId)
    .maybeSingle()
  if (error) return fromSbError(error)
  return requireReturnedOwner(data as SalesRecord | null, scope)
}

/** 0-fee, same-day — used when the channel has no stored rule and no in-code default. */
const GROSS_SAME_DAY_RULE: ChannelRule = {
  channelType: '',
  feeType: 'percent',
  feeRate: 0,
  settlementDays: 0,
  toleranceWon: 0,
  toleranceDays: 0,
}

export async function getEffectiveRuleForChannel(
  scope: OwnedScope,
  channelId: string | null
): Promise<ChannelRule> {
  if (!channelId) return GROSS_SAME_DAY_RULE
  const owned = await getChannel(scope, channelId)
  if (!owned.ok) return GROSS_SAME_DAY_RULE
  const channel = owned.data
  const inCode = ruleForChannelType(channel.channel_type)
  const today = new Date().toISOString().slice(0, 10)
  const { data } = await supabaseAdmin
    .from('reconciliation_rules')
    .select('*')
    .eq('channel_id', channel.id)
    .lte('effective_from', today)
    .order('effective_from', { ascending: false })
    .limit(1)
  const row = (data ?? [])[0] as
    | {
        fee_type?: string | null
        fee_rate?: number | null
        settlement_days?: number | null
        tolerance_won?: number | null
        tolerance_days?: number | null
        effective_to?: string | null
      }
    | undefined
  if (!row || (row.effective_to && row.effective_to < today)) {
    return inCode ?? GROSS_SAME_DAY_RULE
  }
  return ruleFromRow(row, channel.channel_type)
}

export async function createSale(
  scope: OwnedScope,
  input: Record<string, unknown>
): Promise<DalResult<SalesRecord>> {
  const fields = stripOwner(input)
  const saleDate = asDate(fields.sale_date, 'sale_date')
  if (!saleDate.ok) return saleDate
  const gross = asNumber(fields.gross_amount, 'gross_amount')
  if (!gross.ok) return gross
  const expectedNet = asOptionalNumber(fields.expected_net_amount, 'expected_net_amount')
  if (!expectedNet.ok) return expectedNet
  const expectedDeposit = asOptionalDate(fields.expected_deposit_date, 'expected_deposit_date')
  if (!expectedDeposit.ok) return expectedDeposit
  const confidence = asOptionalNumber(fields.confidence, 'confidence')
  if (!confidence.ok) return confidence
  if (confidence.data != null && (confidence.data < 0 || confidence.data > 1)) {
    return dalErr(400, 'confidence must be between 0 and 1')
  }
  const confirm = fields.confirm_status
    ? oneOf(fields.confirm_status, CONFIRM_STATUSES, 'confirm_status')
    : dalOk<ConfirmStatus>('pending')
  if (!confirm.ok) return confirm
  const doc = await resolveOptionalOwnedFk(scope, fields.raw_document_id, 'raw_document_id')
  if (!doc.ok) return doc
  const channel = await resolveOptionalOwnedFk(scope, fields.channel_id, 'channel_id')
  if (!channel.ok) return channel

  const rule = await getEffectiveRuleForChannel(scope, channel.data)
  const cashChannel = !channelExpectsDeposit(rule)

  const saleKind = fields.sale_kind
    ? oneOf(fields.sale_kind, SALE_KINDS, 'sale_kind')
    : dalOk<SaleKind>(cashChannel ? 'cash' : 'card')
  if (!saleKind.ok) return saleKind
  const entrySource = fields.entry_source
    ? oneOf(fields.entry_source, ENTRY_SOURCES, 'entry_source')
    : dalOk<(typeof ENTRY_SOURCES)[number]>('manual')
  if (!entrySource.ok) return entrySource
  const saleGroupId = asOptionalUuid(fields.sale_group_id, 'sale_group_id')
  if (!saleGroupId.ok) return saleGroupId

  // Persist expected net/date from the channel rule at insert time so a later
  // fee-rate change cannot rewrite history. Client-supplied values win.
  // Cash: expected_net = gross (0 fee), expected_deposit_date stays NULL —
  // there is no bank deposit to wait for.
  const noDeposit = cashChannel || saleKind.data === 'cash'
  let persistedNet = expectedNet.data
  let persistedSettle = expectedDeposit.data
  if (persistedNet == null) persistedNet = computeExpectedNet(gross.data, rule)
  if (persistedSettle == null) {
    persistedSettle = noDeposit ? null : computeExpectedDepositDate(saleDate.data, rule)
  }

  const { data, error } = await supabaseAdmin
    .from('sales_records')
    .insert({
      user_id: scope.userId,
      raw_document_id: doc.data,
      channel_id: channel.data,
      sale_date: saleDate.data,
      gross_amount: gross.data,
      expected_net_amount: persistedNet,
      expected_deposit_date: persistedSettle,
      confidence: confidence.data,
      confirm_status: confirm.data,
      sale_kind: saleKind.data,
      sale_group_id: saleGroupId.data,
      entry_source: entrySource.data,
    })
    .select('*')
    .single()
  if (error) return fromSbError(error)
  return requireReturnedOwner(data as SalesRecord, scope)
}

export async function updateSale(
  scope: OwnedScope,
  id: string,
  input: Record<string, unknown>
): Promise<DalResult<SalesRecord>> {
  const idCheck = asUuid(id, 'id')
  if (!idCheck.ok) return idCheck
  const fields = stripOwner(input)
  const patch: Record<string, unknown> = {}

  if ('sale_date' in fields) {
    const d = asDate(fields.sale_date, 'sale_date')
    if (!d.ok) return d
    patch.sale_date = d.data
  }
  if ('gross_amount' in fields) {
    const n = asNumber(fields.gross_amount, 'gross_amount')
    if (!n.ok) return n
    patch.gross_amount = n.data
  }
  if ('expected_net_amount' in fields) {
    const n = asOptionalNumber(fields.expected_net_amount, 'expected_net_amount')
    if (!n.ok) return n
    patch.expected_net_amount = n.data
  }
  if ('expected_deposit_date' in fields) {
    const d = asOptionalDate(fields.expected_deposit_date, 'expected_deposit_date')
    if (!d.ok) return d
    patch.expected_deposit_date = d.data
  }
  if ('confidence' in fields) {
    const n = asOptionalNumber(fields.confidence, 'confidence')
    if (!n.ok) return n
    if (n.data != null && (n.data < 0 || n.data > 1)) return dalErr(400, 'confidence must be between 0 and 1')
    patch.confidence = n.data
  }
  if ('confirm_status' in fields) {
    const s = oneOf(fields.confirm_status, CONFIRM_STATUSES, 'confirm_status')
    if (!s.ok) return s
    patch.confirm_status = s.data
  }
  if ('raw_document_id' in fields) {
    const doc = await resolveOptionalOwnedFk(scope, fields.raw_document_id, 'raw_document_id')
    if (!doc.ok) return doc
    patch.raw_document_id = doc.data
  }
  if ('channel_id' in fields) {
    const channel = await resolveOptionalOwnedFk(scope, fields.channel_id, 'channel_id')
    if (!channel.ok) return channel
    patch.channel_id = channel.data
  }
  if ('sale_kind' in fields) {
    const kind = oneOf(fields.sale_kind, SALE_KINDS, 'sale_kind')
    if (!kind.ok) return kind
    patch.sale_kind = kind.data
  }
  if (Object.keys(patch).length === 0) return dalErr(400, 'No fields to update')

  const { data, error } = await supabaseAdmin
    .from('sales_records')
    .update(patch)
    .eq('id', id)
    .eq('user_id', scope.userId)
    .select('*')
    .maybeSingle()
  if (error) return fromSbError(error)
  return requireReturnedOwner(data as SalesRecord | null, scope)
}

export async function deleteSale(scope: OwnedScope, id: string): Promise<DalResult<{ deleted: true }>> {
  const idCheck = asUuid(id, 'id')
  if (!idCheck.ok) return idCheck
  const { data, error } = await supabaseAdmin
    .from('sales_records')
    .delete()
    .eq('id', id)
    .eq('user_id', scope.userId)
    .select('id')
    .maybeSingle()
  if (error) return fromSbError(error)
  if (!data) return dalErr(404, 'Not found')
  return dalOk({ deleted: true })
}

// ── deposits ─────────────────────────────────────────────────────────────────

export async function listDeposits(
  scope: OwnedScope,
  filters?: { from?: string | null; to?: string | null; confirm_status?: string | null }
): Promise<DalResult<DepositRecord[]>> {
  let q = supabaseAdmin
    .from('deposit_records')
    .select('*')
    .eq('user_id', scope.userId)
    .order('deposit_date', { ascending: false })

  if (filters?.from) {
    const from = asDate(filters.from, 'from')
    if (!from.ok) return from
    q = q.gte('deposit_date', from.data)
  }
  if (filters?.to) {
    const to = asDate(filters.to, 'to')
    if (!to.ok) return to
    q = q.lte('deposit_date', to.data)
  }
  if (filters?.confirm_status) {
    const status = oneOf(filters.confirm_status, CONFIRM_STATUSES, 'confirm_status')
    if (!status.ok) return status
    q = q.eq('confirm_status', status.data)
  }

  const { data, error } = await q
  if (error) return fromSbError(error)
  return dalOk(filterOwned((data ?? []) as DepositRecord[], scope))
}

export async function getDeposit(scope: OwnedScope, id: string): Promise<DalResult<DepositRecord>> {
  const idCheck = asUuid(id, 'id')
  if (!idCheck.ok) return idCheck
  const { data, error } = await supabaseAdmin
    .from('deposit_records')
    .select('*')
    .eq('id', id)
    .eq('user_id', scope.userId)
    .maybeSingle()
  if (error) return fromSbError(error)
  return requireReturnedOwner(data as DepositRecord | null, scope)
}

export async function createDeposit(
  scope: OwnedScope,
  input: Record<string, unknown>
): Promise<DalResult<DepositRecord>> {
  const fields = stripOwner(input)
  const depositDate = asDate(fields.deposit_date, 'deposit_date')
  if (!depositDate.ok) return depositDate
  const amount = asNumber(fields.actual_amount, 'actual_amount')
  if (!amount.ok) return amount
  const confidence = asOptionalNumber(fields.confidence, 'confidence')
  if (!confidence.ok) return confidence
  if (confidence.data != null && (confidence.data < 0 || confidence.data > 1)) {
    return dalErr(400, 'confidence must be between 0 and 1')
  }
  const confirm = fields.confirm_status
    ? oneOf(fields.confirm_status, CONFIRM_STATUSES, 'confirm_status')
    : dalOk<ConfirmStatus>('pending')
  if (!confirm.ok) return confirm
  const doc = await resolveOptionalOwnedFk(scope, fields.raw_document_id, 'raw_document_id')
  if (!doc.ok) return doc
  const hint = await resolveOptionalOwnedFk(scope, fields.channel_hint, 'channel_hint')
  if (!hint.ok) return hint

  const { data, error } = await supabaseAdmin
    .from('deposit_records')
    .insert({
      user_id: scope.userId,
      raw_document_id: doc.data,
      deposit_date: depositDate.data,
      actual_amount: amount.data,
      channel_hint: hint.data,
      confidence: confidence.data,
      confirm_status: confirm.data,
    })
    .select('*')
    .single()
  if (error) return fromSbError(error)
  return requireReturnedOwner(data as DepositRecord, scope)
}

export async function updateDeposit(
  scope: OwnedScope,
  id: string,
  input: Record<string, unknown>
): Promise<DalResult<DepositRecord>> {
  const idCheck = asUuid(id, 'id')
  if (!idCheck.ok) return idCheck
  const fields = stripOwner(input)
  const patch: Record<string, unknown> = {}

  if ('deposit_date' in fields) {
    const d = asDate(fields.deposit_date, 'deposit_date')
    if (!d.ok) return d
    patch.deposit_date = d.data
  }
  if ('actual_amount' in fields) {
    const n = asNumber(fields.actual_amount, 'actual_amount')
    if (!n.ok) return n
    patch.actual_amount = n.data
  }
  if ('confidence' in fields) {
    const n = asOptionalNumber(fields.confidence, 'confidence')
    if (!n.ok) return n
    if (n.data != null && (n.data < 0 || n.data > 1)) return dalErr(400, 'confidence must be between 0 and 1')
    patch.confidence = n.data
  }
  if ('confirm_status' in fields) {
    const s = oneOf(fields.confirm_status, CONFIRM_STATUSES, 'confirm_status')
    if (!s.ok) return s
    patch.confirm_status = s.data
  }
  if ('raw_document_id' in fields) {
    const doc = await resolveOptionalOwnedFk(scope, fields.raw_document_id, 'raw_document_id')
    if (!doc.ok) return doc
    patch.raw_document_id = doc.data
  }
  if ('channel_hint' in fields) {
    const hint = await resolveOptionalOwnedFk(scope, fields.channel_hint, 'channel_hint')
    if (!hint.ok) return hint
    patch.channel_hint = hint.data
  }
  if (Object.keys(patch).length === 0) return dalErr(400, 'No fields to update')

  const { data, error } = await supabaseAdmin
    .from('deposit_records')
    .update(patch)
    .eq('id', id)
    .eq('user_id', scope.userId)
    .select('*')
    .maybeSingle()
  if (error) return fromSbError(error)
  return requireReturnedOwner(data as DepositRecord | null, scope)
}

export async function deleteDeposit(scope: OwnedScope, id: string): Promise<DalResult<{ deleted: true }>> {
  const idCheck = asUuid(id, 'id')
  if (!idCheck.ok) return idCheck
  const { data, error } = await supabaseAdmin
    .from('deposit_records')
    .delete()
    .eq('id', id)
    .eq('user_id', scope.userId)
    .select('id')
    .maybeSingle()
  if (error) return fromSbError(error)
  if (!data) return dalErr(404, 'Not found')
  return dalOk({ deleted: true })
}

// ── reconciliations + matches ────────────────────────────────────────────────

async function loadMatchesFor(
  _scope: OwnedScope,
  reconIds: string[]
): Promise<DalResult<ReconciliationMatch[]>> {
  if (reconIds.length === 0) return dalOk([])
  const { data, error } = await supabaseAdmin
    .from('reconciliation_matches')
    .select('*')
    .in('reconciliation_id', reconIds)
  if (error) return fromSbError(error)
  const allowed = new Set(reconIds)
  return dalOk(
    ((data ?? []) as ReconciliationMatch[]).filter((row) => allowed.has(row.reconciliation_id))
  )
}

function parseMatchList(raw: unknown): DalResult<{ sales_record_id: string; deposit_record_id: string }[]> {
  if (raw == null) return dalOk([])
  if (!Array.isArray(raw)) return dalErr(400, 'matches must be an array')
  const out: { sales_record_id: string; deposit_record_id: string }[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return dalErr(400, 'each match must be an object')
    }
    const row = item as Record<string, unknown>
    const sale = asUuid(row.sales_record_id, 'sales_record_id')
    if (!sale.ok) return sale
    const deposit = asUuid(row.deposit_record_id, 'deposit_record_id')
    if (!deposit.ok) return deposit
    out.push({ sales_record_id: sale.data, deposit_record_id: deposit.data })
  }
  return dalOk(out)
}

async function insertOwnedMatches(
  scope: OwnedScope,
  reconciliationId: string,
  matches: { sales_record_id: string; deposit_record_id: string }[]
): Promise<DalResult<ReconciliationMatch[]>> {
  if (matches.length === 0) return dalOk([])
  for (const match of matches) {
    const sale = await requireOwnedSale(scope, match.sales_record_id)
    if (!sale.ok) return sale
    const deposit = await requireOwnedDeposit(scope, match.deposit_record_id)
    if (!deposit.ok) return deposit
  }
  const rows = matches.map((match) => ({
    reconciliation_id: reconciliationId,
    sales_record_id: match.sales_record_id,
    deposit_record_id: match.deposit_record_id,
  }))
  const { data, error } = await supabaseAdmin
    .from('reconciliation_matches')
    .insert(rows)
    .select('*')
  if (error) return fromSbError(error)
  return dalOk((data ?? []) as ReconciliationMatch[])
}

export async function listReconciliations(
  scope: OwnedScope,
  filters?: { status?: string | null; resolved?: string | null }
): Promise<DalResult<ReconciliationWithMatches[]>> {
  let q = supabaseAdmin
    .from('reconciliations')
    .select('*')
    .eq('user_id', scope.userId)
    .order('created_at', { ascending: false })

  if (filters?.status) {
    const status = oneOf(filters.status, RECON_STATUSES, 'status')
    if (!status.ok) return status
    q = q.eq('status', status.data)
  }
  if (filters?.resolved === 'true' || filters?.resolved === 'false') {
    q = q.eq('resolved', filters.resolved === 'true')
  }

  const { data, error } = await q
  if (error) return fromSbError(error)
  const rows = filterOwned((data ?? []) as Reconciliation[], scope)
  const matches = await loadMatchesFor(
    scope,
    rows.map((row) => row.id)
  )
  if (!matches.ok) return matches
  const byRecon = new Map<string, ReconciliationMatch[]>()
  for (const match of matches.data) {
    const list = byRecon.get(match.reconciliation_id) ?? []
    list.push(match)
    byRecon.set(match.reconciliation_id, list)
  }
  return dalOk(rows.map((row) => ({ ...row, matches: byRecon.get(row.id) ?? [] })))
}

export async function getReconciliation(
  scope: OwnedScope,
  id: string
): Promise<DalResult<ReconciliationWithMatches>> {
  const idCheck = asUuid(id, 'id')
  if (!idCheck.ok) return idCheck
  const { data, error } = await supabaseAdmin
    .from('reconciliations')
    .select('*')
    .eq('id', id)
    .eq('user_id', scope.userId)
    .maybeSingle()
  if (error) return fromSbError(error)
  const owned = requireReturnedOwner(data as Reconciliation | null, scope)
  if (!owned.ok) return owned
  const matches = await loadMatchesFor(scope, [owned.data.id])
  if (!matches.ok) return matches
  return dalOk({ ...owned.data, matches: matches.data })
}

export async function createReconciliation(
  scope: OwnedScope,
  input: Record<string, unknown>
): Promise<DalResult<ReconciliationWithMatches>> {
  const fields = stripOwner(input)
  const status = oneOf(fields.status, RECON_STATUSES, 'status')
  if (!status.ok) return status
  const discrepancy = asOptionalNumber(fields.discrepancy_amount, 'discrepancy_amount')
  if (!discrepancy.ok) return discrepancy
  const flag = fields.security_flag
    ? oneOf(fields.security_flag, SECURITY_FLAGS, 'security_flag')
    : dalOk<SecurityFlag>('none')
  if (!flag.ok) return flag
  const matchesIn = parseMatchList(fields.matches)
  if (!matchesIn.ok) return matchesIn

  const { data, error } = await supabaseAdmin
    .from('reconciliations')
    .insert({
      user_id: scope.userId,
      status: status.data,
      discrepancy_amount: discrepancy.data ?? 0,
      discrepancy_reason: asOptionalString(fields.discrepancy_reason),
      security_flag: flag.data,
      resolved: fields.resolved === true,
    })
    .select('*')
    .single()
  if (error) return fromSbError(error)
  const owned = requireReturnedOwner(data as Reconciliation, scope)
  if (!owned.ok) return owned

  const matches = await insertOwnedMatches(scope, owned.data.id, matchesIn.data)
  if (!matches.ok) {
    await supabaseAdmin
      .from('reconciliations')
      .delete()
      .eq('id', owned.data.id)
      .eq('user_id', scope.userId)
    return matches
  }
  return dalOk({ ...owned.data, matches: matches.data })
}

export async function updateReconciliation(
  scope: OwnedScope,
  id: string,
  input: Record<string, unknown>
): Promise<DalResult<ReconciliationWithMatches>> {
  const idCheck = asUuid(id, 'id')
  if (!idCheck.ok) return idCheck
  const fields = stripOwner(input)
  const patch: Record<string, unknown> = {}

  if ('status' in fields) {
    const status = oneOf(fields.status, RECON_STATUSES, 'status')
    if (!status.ok) return status
    patch.status = status.data
  }
  if ('discrepancy_amount' in fields) {
    const n = asOptionalNumber(fields.discrepancy_amount, 'discrepancy_amount')
    if (!n.ok) return n
    patch.discrepancy_amount = n.data ?? 0
  }
  if ('discrepancy_reason' in fields) {
    patch.discrepancy_reason = asOptionalString(fields.discrepancy_reason)
  }
  if ('security_flag' in fields) {
    const flag = oneOf(fields.security_flag, SECURITY_FLAGS, 'security_flag')
    if (!flag.ok) return flag
    patch.security_flag = flag.data
  }
  if ('resolved' in fields) {
    if (typeof fields.resolved !== 'boolean') return dalErr(400, 'resolved must be a boolean')
    patch.resolved = fields.resolved
  }

  if (Object.keys(patch).length > 0) {
    const { data, error } = await supabaseAdmin
      .from('reconciliations')
      .update(patch)
      .eq('id', id)
      .eq('user_id', scope.userId)
      .select('*')
      .maybeSingle()
    if (error) return fromSbError(error)
    const owned = requireReturnedOwner(data as Reconciliation | null, scope)
    if (!owned.ok) return owned
  } else if (!('matches' in fields)) {
    return dalErr(400, 'No fields to update')
  } else {
    const existing = await requireOwnedReconciliation(scope, id)
    if (!existing.ok) return existing
  }

  if ('matches' in fields) {
    const owned = await requireOwnedReconciliation(scope, id)
    if (!owned.ok) return owned
    const matchesIn = parseMatchList(fields.matches)
    if (!matchesIn.ok) return matchesIn
    const { error: delErr } = await supabaseAdmin
      .from('reconciliation_matches')
      .delete()
      .eq('reconciliation_id', owned.data.id)
    if (delErr) return fromSbError(delErr)
    const inserted = await insertOwnedMatches(scope, owned.data.id, matchesIn.data)
    if (!inserted.ok) return inserted
  }

  return getReconciliation(scope, id)
}

/**
 * Persist an advisory estimate on an amount_mismatch row.
 * Updates ONLY discrepancy_advisory — status / resolved / amounts are untouched.
 */
export async function saveDiscrepancyAdvisory(
  scope: OwnedScope,
  id: string,
  advisory: DiscrepancyAdvisory
): Promise<DalResult<ReconciliationWithMatches>> {
  const idCheck = asUuid(id, 'id')
  if (!idCheck.ok) return idCheck
  const { data, error } = await supabaseAdmin
    .from('reconciliations')
    .update({ discrepancy_advisory: advisory })
    .eq('id', id)
    .eq('user_id', scope.userId)
    .eq('status', 'amount_mismatch')
    .select('id, status')
    .maybeSingle()
  if (error) return fromSbError(error)
  if (!data) return dalErr(409, 'reconciliation is not amount_mismatch')
  return getReconciliation(scope, id)
}

export async function deleteReconciliation(
  scope: OwnedScope,
  id: string
): Promise<DalResult<{ deleted: true }>> {
  const idCheck = asUuid(id, 'id')
  if (!idCheck.ok) return idCheck
  const { data, error } = await supabaseAdmin
    .from('reconciliations')
    .delete()
    .eq('id', id)
    .eq('user_id', scope.userId)
    .select('id')
    .maybeSingle()
  if (error) return fromSbError(error)
  if (!data) return dalErr(404, 'Not found')
  return dalOk({ deleted: true })
}
