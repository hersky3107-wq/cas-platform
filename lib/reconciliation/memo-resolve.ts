import 'server-only'

import { supabaseAdmin } from '@/lib/supabase/server'
import type { OwnedScope } from '@/lib/reconciliation/scope'
import { askModelsJson } from '@/lib/reconciliation/ai-ask'
import {
  ADVISORY_MODELS,
  MEMO_RESOLVE_MAX_COMPLETION_TOKENS,
  MEMO_RESOLVE_MAX_PER_RUN,
} from '@/lib/reconciliation/config'
import { listIssuers, resolveIssuerByAlias } from '@/lib/reconciliation/issuers-db'
import type { CardIssuer, DalResult, DepositRecord } from '@/lib/reconciliation/types'

/**
 * MEMO RESOLUTION (AI-owned, Step-2 req. b): "하나90343621" → 하나,
 * "NH15524303" → NH, "제민신협(체크기)" → not a card settlement at all.
 *
 * Order of authority:
 *   1. memo_aliases — deterministic, FREE, and the learning store the owner's
 *      corrections feed (issuers-db.learnMemoAlias). A hint, not the mechanism.
 *   2. Multi-model AI for everything aliases can't answer. ALL unresolved
 *      memos of a run are batched into ONE prompt per model (≤ 60 rows), so
 *      a run costs exactly |ADVISORY_MODELS| calls — bounded regardless of
 *      deposit count. Models vote per row; majority resolves, disagreement
 *      or "not a card settlement" leaves the row unresolved and SAYS SO.
 *
 * Persisted per deposit: issuer_id + issuer_confidence + issuer_source
 * ('parser' for alias hits, 'ai' for model consensus — 'ai' needs the Step-2
 * CHECK widening; a clear 503 tells the operator to run the SQL).
 * Rows the owner already fixed (issuer_source='user') are never touched.
 */

export type MemoResolution = {
  deposit_id: string
  memo: string | null
  issuer_id: string | null
  issuer_name: string | null
  confidence: number
  source: 'parser' | 'ai'
  /** e.g. "3/3" for the AI path; null for alias hits. */
  agreement: string | null
}

export type MemoResolveResult = {
  considered: number
  resolved: MemoResolution[]
  /** AI consensus: this memo is NOT a card settlement (voucher operator, person, device transfer…). */
  not_card: { deposit_id: string; memo: string | null; agreement: string }[]
  /** No alias hit and no model majority — surfaced, never guessed. */
  unresolved: { deposit_id: string; memo: string | null; model_views: string[] }[]
  model_timings: { model: string; elapsed_ms: number; ok: boolean }[]
}

function dalOk<T>(data: T): DalResult<T> {
  return { ok: true, data }
}
function dalErr(status: number, error: string): DalResult<never> {
  return { ok: false, status, error }
}

const SYSTEM_PROMPT = [
  'You resolve Korean bank-deposit memos (적요) to the card issuer that sent the settlement.',
  'You get a list of the store\'s card issuers (with known memo aliases) and a numbered list of memos.',
  'Card settlements usually look like an issuer name followed by digits ("하나90343621" → 하나, "NH15524303" → NH).',
  'A memo naming a person, a credit union / device transfer ("제민신협(체크기)"), a voucher operator (탐나는전, 온누리), or a delivery app is NOT a card-company settlement — answer null for it.',
  'Respond with ONLY a compact JSON array, no prose:',
  '[{"i":<memo index>,"issuer":"<exact issuer name from the list, or null>","confidence":"high"|"medium"|"low"}]',
  'Every input index must appear exactly once. Never invent an issuer that is not in the list.',
].join(' ')

type AiVote = { issuer: string | null; confidence: string }

function parseModelVotes(json: unknown, memoCount: number): Map<number, AiVote> | null {
  if (!Array.isArray(json)) return null
  const map = new Map<number, AiVote>()
  for (const item of json) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const row = item as Record<string, unknown>
    const i = typeof row.i === 'number' ? row.i : Number(row.i)
    if (!Number.isInteger(i) || i < 0 || i >= memoCount) continue
    const issuer =
      typeof row.issuer === 'string' && row.issuer.trim() && row.issuer.trim().toLowerCase() !== 'null'
        ? row.issuer.trim()
        : null
    const confidence = typeof row.confidence === 'string' ? row.confidence : 'low'
    map.set(i, { issuer, confidence })
  }
  return map.size > 0 ? map : null
}

export async function resolveDepositIssuers(
  scope: OwnedScope,
  opts?: { depositIds?: string[]; useAi?: boolean }
): Promise<DalResult<MemoResolveResult>> {
  const issuersRes = await listIssuers(scope)
  if (!issuersRes.ok) return issuersRes
  const issuers = issuersRes.data
  const issuersByName = new Map<string, CardIssuer>()
  for (const issuer of issuers) issuersByName.set(issuer.name.toLowerCase(), issuer)

  let q = supabaseAdmin
    .from('deposit_records')
    .select('*')
    .eq('user_id', scope.userId)
    .is('issuer_id', null)
    .order('deposit_date', { ascending: false })
    .limit(MEMO_RESOLVE_MAX_PER_RUN)
  if (opts?.depositIds && opts.depositIds.length > 0) {
    q = q.in('id', opts.depositIds.slice(0, MEMO_RESOLVE_MAX_PER_RUN))
  }
  const { data, error } = await q
  if (error) {
    console.error('[reconciliation:memo-resolve] db error:', error.message)
    return dalErr(500, 'Database error')
  }
  const targets = ((data ?? []) as DepositRecord[]).filter(
    (d) => d.user_id === scope.userId && d.issuer_source !== 'user'
  )

  const result: MemoResolveResult = {
    considered: targets.length,
    resolved: [],
    not_card: [],
    unresolved: [],
    model_timings: [],
  }
  if (targets.length === 0) return dalOk(result)

  const persist = async (
    deposit: DepositRecord,
    issuer: CardIssuer,
    confidence: number,
    source: 'parser' | 'ai',
    agreement: string | null
  ): Promise<DalResult<null>> => {
    const { error: upErr } = await supabaseAdmin
      .from('deposit_records')
      .update({ issuer_id: issuer.id, issuer_confidence: confidence, issuer_source: source })
      .eq('id', deposit.id)
      .eq('user_id', scope.userId)
    if (upErr) {
      if (upErr.code === '23514' && source === 'ai') {
        return dalErr(
          503,
          "deposit_records.issuer_source가 'ai'를 아직 허용하지 않습니다 — Step-2 마이그레이션 SQL(BLOCK 1)을 먼저 실행하세요."
        )
      }
      console.error('[reconciliation:memo-resolve] persist error:', upErr.message)
      return dalErr(500, 'Database error')
    }
    result.resolved.push({
      deposit_id: deposit.id,
      memo: deposit.memo,
      issuer_id: issuer.id,
      issuer_name: issuer.name,
      confidence,
      source,
      agreement,
    })
    return dalOk(null)
  }

  // ── pass 1: deterministic aliases (free) ───────────────────────────────────
  const forAi: DepositRecord[] = []
  for (const deposit of targets) {
    const hit = resolveIssuerByAlias(deposit.memo, issuers)
    if (hit) {
      const persisted = await persist(deposit, hit.issuer, 0.95, 'parser', null)
      if (!persisted.ok) return persisted
    } else if (deposit.memo && deposit.memo.trim().length > 0) {
      forAi.push(deposit)
    } else {
      result.unresolved.push({ deposit_id: deposit.id, memo: deposit.memo, model_views: ['메모 없음'] })
    }
  }

  if (forAi.length === 0 || opts?.useAi === false) {
    for (const d of forAi) {
      result.unresolved.push({ deposit_id: d.id, memo: d.memo, model_views: ['AI 미실행'] })
    }
    return dalOk(result)
  }

  // ── pass 2: ONE batched prompt per model ───────────────────────────────────
  const userPrompt = JSON.stringify({
    issuers: issuers.map((i) => ({ name: i.name, aliases: i.memo_aliases })),
    memos: forAi.map((d, i) => ({ i, memo: d.memo, date: d.deposit_date, amount: d.actual_amount })),
  })
  const answers = await askModelsJson(
    scope,
    ADVISORY_MODELS,
    SYSTEM_PROMPT,
    userPrompt,
    MEMO_RESOLVE_MAX_COMPLETION_TOKENS
  )
  result.model_timings = answers.map((a) => ({ model: a.model, elapsed_ms: a.elapsed_ms, ok: a.ok }))

  const votesByModel = answers
    .map((a) => ({ model: a.model, votes: a.json != null ? parseModelVotes(a.json, forAi.length) : null }))
    .filter((v): v is { model: string; votes: Map<number, AiVote> } => v.votes != null)

  for (let i = 0; i < forAi.length; i++) {
    const deposit = forAi[i]!
    const rowVotes = votesByModel
      .map((v) => ({ model: v.model, vote: v.votes.get(i) }))
      .filter((v): v is { model: string; vote: AiVote } => v.vote !== undefined)

    if (rowVotes.length === 0) {
      result.unresolved.push({ deposit_id: deposit.id, memo: deposit.memo, model_views: ['모든 모델 무응답'] })
      continue
    }

    // Majority over normalized issuer-or-null. Hallucinated names (not in the
    // roster) are dropped before voting.
    const tally = new Map<string, { count: number; issuer: CardIssuer | null }>()
    for (const { vote } of rowVotes) {
      const issuer = vote.issuer ? (issuersByName.get(vote.issuer.toLowerCase()) ?? null) : null
      if (vote.issuer && !issuer) continue // hallucination guard
      const key = issuer ? issuer.id : 'null'
      const entry = tally.get(key) ?? { count: 0, issuer }
      entry.count++
      tally.set(key, entry)
    }
    let winner: { count: number; issuer: CardIssuer | null } | null = null
    for (const entry of tally.values()) {
      if (!winner || entry.count > winner.count) winner = entry
    }
    const agreement = `${winner?.count ?? 0}/${rowVotes.length}`

    if (!winner || winner.count * 2 <= rowVotes.length) {
      // No majority — surface every reading, resolve nothing.
      result.unresolved.push({
        deposit_id: deposit.id,
        memo: deposit.memo,
        model_views: rowVotes.map(({ model, vote }) => `${model}: ${vote.issuer ?? 'null'}`),
      })
      continue
    }
    if (winner.issuer === null) {
      result.not_card.push({ deposit_id: deposit.id, memo: deposit.memo, agreement })
      continue
    }
    const confidence = winner.count === rowVotes.length && rowVotes.length >= 2 ? 0.9 : 0.7
    const persisted = await persist(deposit, winner.issuer, confidence, 'ai', agreement)
    if (!persisted.ok) return persisted
  }

  return dalOk(result)
}
