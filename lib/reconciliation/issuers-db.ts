import 'server-only'

import { supabaseAdmin } from '@/lib/supabase/server'
import type { OwnedScope } from '@/lib/reconciliation/scope'
import type { CardIssuer, DalResult } from '@/lib/reconciliation/types'

/**
 * card_issuers DAL — per-user issuer master (신한/삼성/NH/하나/…).
 *
 * Same contract as db.ts: OwnedScope only, supabaseAdmin server-side, every
 * query filtered by user_id. fee_rate is a FRACTION (0.0015 = 0.15%) — the
 * DB CHECK (>= 0, < 1) plus validation here both reject percent-style entry.
 *
 * memo_aliases is the LEARNING STORE for memo → issuer resolution: a hint
 * list the deterministic pass and the AI prompt both read, appended to when
 * the owner corrects a resolution (learnMemoAlias). It is not the mechanism —
 * the AI decides unresolved cases; aliases just make known answers free.
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function dalOk<T>(data: T): DalResult<T> {
  return { ok: true, data }
}
function dalErr(status: number, error: string): DalResult<never> {
  return { ok: false, status, error }
}
function fromSbError(error: { message: string; code?: string }): DalResult<never> {
  if (error.code === '42P01') {
    return dalErr(503, 'card_issuers 테이블이 없습니다 — Step-1 마이그레이션 SQL을 먼저 실행하세요.')
  }
  if (error.code === '23505') return dalErr(409, '같은 이름의 카드사가 이미 있습니다.')
  if (error.code === '23514') return dalErr(400, 'Invalid value (fee_rate는 0 이상 1 미만의 소수 — 0.0015 = 0.15%)')
  if (error.code === '23503') return dalErr(409, '매출/입금/대사 기록이 참조 중인 카드사입니다.')
  console.error('[reconciliation:issuers] db error:', error.message)
  return dalErr(500, 'Database error')
}

/**
 * Seed rows for a user who has none yet (same list as the Step-1 SQL seed,
 * which only covered users that already had payment_channels). ESTIMATES —
 * the owner corrects fee/lag from real card-company statements.
 */
const DEFAULT_ISSUERS: readonly { name: string; aliases: string[]; ord: number }[] = [
  { name: '신한', aliases: ['신한', '신한카드', 'SHINHAN'], ord: 10 },
  { name: '삼성', aliases: ['삼성', '삼성카드', 'SAMSUNG'], ord: 20 },
  { name: 'NH', aliases: ['NH', '농협', 'NH농협', '엔에이치'], ord: 30 },
  { name: '하나', aliases: ['하나', '하나카드', 'HANA'], ord: 40 },
  { name: '국민', aliases: ['국민', 'KB', 'KB국민', '케이비'], ord: 50 },
  { name: 'BC', aliases: ['BC', '비씨', 'BC카드', '비씨카드'], ord: 60 },
  { name: '롯데', aliases: ['롯데', '롯데카드', 'LOTTE'], ord: 70 },
  { name: '현대', aliases: ['현대', '현대카드', 'HYUNDAI'], ord: 80 },
  { name: '우리', aliases: ['우리', '우리카드', 'WOORI'], ord: 90 },
  { name: '씨티', aliases: ['씨티', '시티', 'CITI', '씨티카드'], ord: 100 },
  { name: '카카오뱅크', aliases: ['카카오뱅크', '카뱅'], ord: 110 },
]

const DEFAULT_FEE_FRACTION = 0.0015
const DEFAULT_SETTLEMENT_DAYS = 2
const DEFAULT_WINDOW_DAYS = 3

/** List the user's issuers, seeding the defaults on first touch (app-layer seeding for new users). */
export async function listIssuers(
  scope: OwnedScope,
  opts?: { includeInactive?: boolean }
): Promise<DalResult<CardIssuer[]>> {
  const load = async (): Promise<DalResult<CardIssuer[]>> => {
    let q = supabaseAdmin
      .from('card_issuers')
      .select('*')
      .eq('user_id', scope.userId)
      .order('display_order', { ascending: true })
      .order('name', { ascending: true })
    if (!opts?.includeInactive) q = q.eq('is_active', true)
    const { data, error } = await q
    if (error) return fromSbError(error)
    return dalOk(((data ?? []) as CardIssuer[]).filter((r) => r.user_id === scope.userId))
  }

  const first = await load()
  if (!first.ok) return first
  if (first.data.length > 0) return first

  // No rows at all (also check inactive before seeding to avoid resurrection).
  const { count, error: countErr } = await supabaseAdmin
    .from('card_issuers')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', scope.userId)
  if (countErr) return fromSbError(countErr)
  if ((count ?? 0) > 0) return first // has rows, all inactive — respect that

  const seedRows = DEFAULT_ISSUERS.map((s) => ({
    user_id: scope.userId,
    name: s.name,
    fee_rate: DEFAULT_FEE_FRACTION,
    settlement_days: DEFAULT_SETTLEMENT_DAYS,
    settlement_window_days: DEFAULT_WINDOW_DAYS,
    memo_aliases: s.aliases,
    display_order: s.ord,
  }))
  const { error: seedErr } = await supabaseAdmin.from('card_issuers').insert(seedRows)
  // A concurrent seed (23505) is fine — reload either way.
  if (seedErr && seedErr.code !== '23505') return fromSbError(seedErr)
  return load()
}

export async function getIssuer(scope: OwnedScope, id: string): Promise<DalResult<CardIssuer>> {
  if (!UUID_RE.test(id)) return dalErr(400, 'id must be a uuid')
  const { data, error } = await supabaseAdmin
    .from('card_issuers')
    .select('*')
    .eq('id', id)
    .eq('user_id', scope.userId)
    .maybeSingle()
  if (error) return fromSbError(error)
  if (!data || (data as CardIssuer).user_id !== scope.userId) return dalErr(404, 'Issuer not found')
  return dalOk(data as CardIssuer)
}

function validateFeeFraction(value: unknown): DalResult<number> {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n) || n < 0 || n >= 1) {
    return dalErr(400, 'fee_rate는 FRACTION입니다 (0.0015 = 0.15%). 0 이상 1 미만이어야 합니다 — 2.5처럼 퍼센트 단위를 넣지 마세요.')
  }
  return dalOk(n)
}

function validateAliases(value: unknown): DalResult<string[]> {
  if (!Array.isArray(value)) return dalErr(400, 'memo_aliases must be an array of strings')
  const out: string[] = []
  const seen = new Set<string>()
  for (const item of value) {
    if (typeof item !== 'string') return dalErr(400, 'memo_aliases must be an array of strings')
    const t = item.trim()
    if (t.length < 1 || t.length > 40) continue
    const key = t.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(t)
  }
  return dalOk(out)
}

export async function createIssuer(
  scope: OwnedScope,
  input: Record<string, unknown>
): Promise<DalResult<CardIssuer>> {
  const name = typeof input.name === 'string' ? input.name.trim() : ''
  if (!name || name.length > 40) return dalErr(400, 'name is required (≤ 40 chars)')

  const fee = input.fee_rate != null ? validateFeeFraction(input.fee_rate) : dalOk(DEFAULT_FEE_FRACTION)
  if (!fee.ok) return fee
  const settle = input.settlement_days != null ? Number(input.settlement_days) : DEFAULT_SETTLEMENT_DAYS
  const window = input.settlement_window_days != null ? Number(input.settlement_window_days) : DEFAULT_WINDOW_DAYS
  if (!Number.isInteger(settle) || settle < 0 || settle > 60) return dalErr(400, 'settlement_days must be an integer 0..60')
  if (!Number.isInteger(window) || window < 0 || window > 60) return dalErr(400, 'settlement_window_days must be an integer 0..60')
  const aliases = input.memo_aliases != null ? validateAliases(input.memo_aliases) : dalOk<string[]>([name])
  if (!aliases.ok) return aliases

  const { data, error } = await supabaseAdmin
    .from('card_issuers')
    .insert({
      user_id: scope.userId,
      name,
      fee_rate: fee.data,
      settlement_days: settle,
      settlement_window_days: window,
      memo_aliases: aliases.data,
      display_order: typeof input.display_order === 'number' ? input.display_order : 100,
    })
    .select('*')
    .single()
  if (error) return fromSbError(error)
  return dalOk(data as CardIssuer)
}

export async function updateIssuer(
  scope: OwnedScope,
  id: string,
  input: Record<string, unknown>
): Promise<DalResult<CardIssuer>> {
  const existing = await getIssuer(scope, id)
  if (!existing.ok) return existing

  const patch: Record<string, unknown> = {}
  if ('name' in input) {
    const name = typeof input.name === 'string' ? input.name.trim() : ''
    if (!name || name.length > 40) return dalErr(400, 'name is required (≤ 40 chars)')
    patch.name = name
  }
  if ('fee_rate' in input) {
    const fee = validateFeeFraction(input.fee_rate)
    if (!fee.ok) return fee
    patch.fee_rate = fee.data
  }
  if ('settlement_days' in input) {
    const n = Number(input.settlement_days)
    if (!Number.isInteger(n) || n < 0 || n > 60) return dalErr(400, 'settlement_days must be an integer 0..60')
    patch.settlement_days = n
  }
  if ('settlement_window_days' in input) {
    const n = Number(input.settlement_window_days)
    if (!Number.isInteger(n) || n < 0 || n > 60) return dalErr(400, 'settlement_window_days must be an integer 0..60')
    patch.settlement_window_days = n
  }
  if ('memo_aliases' in input) {
    const aliases = validateAliases(input.memo_aliases)
    if (!aliases.ok) return aliases
    patch.memo_aliases = aliases.data
  }
  if ('is_active' in input) {
    if (typeof input.is_active !== 'boolean') return dalErr(400, 'is_active must be a boolean')
    patch.is_active = input.is_active
  }
  if ('display_order' in input) {
    const n = Number(input.display_order)
    if (!Number.isInteger(n)) return dalErr(400, 'display_order must be an integer')
    patch.display_order = n
  }
  if (Object.keys(patch).length === 0) return dalErr(400, 'No fields to update')
  patch.updated_at = new Date().toISOString()

  const { data, error } = await supabaseAdmin
    .from('card_issuers')
    .update(patch)
    .eq('id', id)
    .eq('user_id', scope.userId)
    .select('*')
    .maybeSingle()
  if (error) return fromSbError(error)
  if (!data) return dalErr(404, 'Issuer not found')
  return dalOk(data as CardIssuer)
}

/**
 * Delete only when nothing references the issuer; otherwise 409 with a hint
 * to deactivate instead (FKs are on delete set null — a silent detach of
 * history is worse than refusing).
 */
export async function deleteIssuer(scope: OwnedScope, id: string): Promise<DalResult<{ deleted: true }>> {
  const existing = await getIssuer(scope, id)
  if (!existing.ok) return existing

  for (const table of ['sales_records', 'deposit_records', 'reconciliations'] as const) {
    const { count, error } = await supabaseAdmin
      .from(table)
      .select('id', { count: 'exact', head: true })
      .eq('user_id', scope.userId)
      .eq('issuer_id', id)
    if (error) return fromSbError(error)
    if ((count ?? 0) > 0) {
      return dalErr(409, '이 카드사를 참조하는 기록이 있어 삭제할 수 없습니다. 대신 비활성화(is_active=false)하세요.')
    }
  }

  const { data, error } = await supabaseAdmin
    .from('card_issuers')
    .delete()
    .eq('id', id)
    .eq('user_id', scope.userId)
    .select('id')
    .maybeSingle()
  if (error) return fromSbError(error)
  if (!data) return dalErr(404, 'Issuer not found')
  return dalOk({ deleted: true })
}

/**
 * Leading issuer-ish token of a bank memo: the run of Hangul/Latin letters
 * before the first digit/punctuation. "하나90343621" → "하나",
 * "NH15524303" → "NH", "제민신협(체크기)" → "제민신협".
 */
export function memoAliasCandidate(memo: string): string | null {
  const m = memo.trim().match(/^[A-Za-z가-힣]{2,20}/)
  return m ? m[0] : null
}

/**
 * LEARNING: after the owner corrects a memo → issuer resolution, persist the
 * memo's leading token as an alias on that issuer so the deterministic pass
 * resolves it for free next time. No-ops when the token is already known.
 */
export async function learnMemoAlias(
  scope: OwnedScope,
  issuerId: string,
  memo: string | null
): Promise<DalResult<{ learned: string | null }>> {
  if (!memo) return dalOk({ learned: null })
  const candidate = memoAliasCandidate(memo)
  if (!candidate) return dalOk({ learned: null })

  const issuer = await getIssuer(scope, issuerId)
  if (!issuer.ok) return issuer
  const known = new Set(issuer.data.memo_aliases.map((a) => a.toLowerCase()))
  if (known.has(candidate.toLowerCase())) return dalOk({ learned: null })

  const { error } = await supabaseAdmin
    .from('card_issuers')
    .update({
      memo_aliases: [...issuer.data.memo_aliases, candidate],
      updated_at: new Date().toISOString(),
    })
    .eq('id', issuerId)
    .eq('user_id', scope.userId)
  if (error) return fromSbError(error)
  return dalOk({ learned: candidate })
}

export type AliasHit = { issuer: CardIssuer; alias: string }

/**
 * Deterministic memo → issuer pass: longest alias wins, case-insensitive
 * substring. Returns null when no alias hits OR when aliases of two
 * different issuers hit with the same longest length (ambiguous → AI).
 */
export function resolveIssuerByAlias(memo: string | null, issuers: readonly CardIssuer[]): AliasHit | null {
  if (!memo) return null
  const hay = memo.toLowerCase()
  let best: AliasHit | null = null
  let ambiguous = false
  for (const issuer of issuers) {
    for (const alias of issuer.memo_aliases) {
      const needle = alias.trim().toLowerCase()
      if (needle.length < 2 || !hay.includes(needle)) continue
      if (!best || needle.length > best.alias.length) {
        best = { issuer, alias }
        ambiguous = false
      } else if (
        needle.length === best.alias.length &&
        issuer.id !== best.issuer.id
      ) {
        ambiguous = true
      }
    }
  }
  return ambiguous ? null : best
}
