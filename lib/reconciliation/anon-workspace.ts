import 'server-only'

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { supabaseAdmin } from '@/lib/supabase/server'
import {
  isReconPublic,
  issueWorkspaceCookieValue,
  parseWorkspaceCookie,
  reconWsCookieOptions,
  RECON_WS_COOKIE,
} from '@/lib/reconciliation/public-access'
import {
  ANON_AI_ASK_PER_DAY,
  ANON_AI_CLASSIFY_PER_DAY,
  ANON_AI_INFER_PER_DAY,
  ANON_WORKSPACES_PER_DAY,
} from '@/lib/reconciliation/config'

/**
 * Anonymous workspace mint + daily AI caps for contest public access.
 *
 * Cookie is issued in middleware (no DB) so the HTML response already carries
 * it before the client fires parallel GETs. This module registers the id on
 * first API call and enforces the two caps. No-op when RECONCILIATION_PUBLIC
 * is not 'true'.
 */

const TABLE = 'reconciliation_anon_workspaces'
const MIGRATION_HINT =
  '익명 장부 테이블이 없습니다 — 심사 공개용 SQL을 먼저 실행해 주세요.'

export type AnonFail = { ok: false; response: NextResponse }
export type AnonOk = { ok: true; workspaceId: string }

export type AnonAiKind = 'classify' | 'infer' | 'ask'

function kstDate(): string {
  return new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10)
}

function fail(status: number, error: string): AnonFail {
  return { ok: false, response: NextResponse.json({ error }, { status }) }
}

async function stampCookie(value: string): Promise<void> {
  const jar = await cookies()
  jar.set(RECON_WS_COOKIE, value, reconWsCookieOptions())
}

/**
 * Resolve (or mint) the anonymous workspace id for this request, persist the
 * mint row (daily global cap), and refresh the httpOnly cookie if we issued a
 * new one. When public mode is off the caller must not use this.
 */
export async function ensureAnonWorkspace(cookieHeaderValue: string | undefined): Promise<AnonOk | AnonFail> {
  const today = kstDate()
  let id = await parseWorkspaceCookie(cookieHeaderValue)
  let issued: string | null = null
  if (!id) {
    issued = await issueWorkspaceCookieValue()
    id = issued ? await parseWorkspaceCookie(issued) : null
    if (!id || !issued) {
      return fail(503, '서버 설정이 빠졌습니다 (RECONCILIATION_PUBLIC_SECRET).')
    }
  }

  const existing = await supabaseAdmin.from(TABLE).select('id').eq('id', id).maybeSingle()
  if (existing.error) {
    if (existing.error.code === '42P01') return fail(503, MIGRATION_HINT)
    console.error('[reconciliation:anon] lookup failed:', existing.error.message)
    return fail(500, 'Database error')
  }
  if (existing.data) {
    if (issued) await stampCookie(issued)
    return { ok: true, workspaceId: id }
  }

  const minted = await supabaseAdmin
    .from(TABLE)
    .select('id', { count: 'exact', head: true })
    .eq('created_kst_date', today)
  if (minted.error) {
    if (minted.error.code === '42P01') return fail(503, MIGRATION_HINT)
    console.error('[reconciliation:anon] mint count failed:', minted.error.message)
    return fail(500, 'Database error')
  }
  if ((minted.count ?? 0) >= ANON_WORKSPACES_PER_DAY) {
    return fail(429, '오늘은 체험 자리가 가득 찼어요. 내일 다시 열어 주세요.')
  }

  const ins = await supabaseAdmin.from(TABLE).insert({
    id,
    created_kst_date: today,
    usage_kst_date: today,
    classify_count: 0,
    infer_count: 0,
    ask_count: 0,
  })
  if (ins.error) {
    if (ins.error.code === '23505') {
      // Parallel first-load inserts of the same cookie id — one won.
      if (issued) await stampCookie(issued)
      return { ok: true, workspaceId: id }
    }
    if (ins.error.code === '42P01') return fail(503, MIGRATION_HINT)
    console.error('[reconciliation:anon] mint insert failed:', ins.error.message)
    return fail(500, 'Database error')
  }
  if (issued) await stampCookie(issued)
  return { ok: true, workspaceId: id }
}

const COL: Record<AnonAiKind, 'classify_count' | 'infer_count' | 'ask_count'> = {
  classify: 'classify_count',
  infer: 'infer_count',
  ask: 'ask_count',
}

const CAP: Record<AnonAiKind, number> = {
  classify: ANON_AI_CLASSIFY_PER_DAY,
  infer: ANON_AI_INFER_PER_DAY,
  ask: ANON_AI_ASK_PER_DAY,
}

/**
 * Consume one AI-call unit for this workspace. No-op when public mode is off
 * (logged-in owners keep unlimited use). Returns a 429 with a Korean message
 * when the daily cap is hit.
 */
export async function consumeAnonAi(
  workspaceId: string,
  kind: AnonAiKind
): Promise<{ ok: true } | AnonFail> {
  if (!isReconPublic()) return { ok: true }

  const today = kstDate()
  const col = COL[kind]
  const cap = CAP[kind]

  const { data, error } = await supabaseAdmin.from(TABLE).select('*').eq('id', workspaceId).maybeSingle()
  if (error) {
    if (error.code === '42P01') return fail(503, MIGRATION_HINT)
    console.error('[reconciliation:anon] usage read failed:', error.message)
    return fail(500, 'Database error')
  }
  if (!data) return fail(500, 'Database error')

  if (data.usage_kst_date !== today) {
    const reset = await supabaseAdmin
      .from(TABLE)
      .update({ usage_kst_date: today, classify_count: 0, infer_count: 0, ask_count: 0 })
      .eq('id', workspaceId)
    if (reset.error) {
      console.error('[reconciliation:anon] usage reset failed:', reset.error.message)
      return fail(500, 'Database error')
    }
  }

  const current = data.usage_kst_date === today ? Number(data[col] ?? 0) : 0
  if (current >= cap) {
    return fail(429, '오늘 이 기능은 충분히 쓰셨어요. 내일 다시 써 주세요.')
  }

  const bumped = await supabaseAdmin
    .from(TABLE)
    .update({ [col]: current + 1, usage_kst_date: today })
    .eq('id', workspaceId)
    .eq('usage_kst_date', today)
    .lt(col, cap)
    .select('id')
  if (bumped.error) {
    console.error('[reconciliation:anon] usage bump failed:', bumped.error.message)
    return fail(500, 'Database error')
  }
  if (!bumped.data || bumped.data.length === 0) {
    return fail(429, '오늘 이 기능은 충분히 쓰셨어요. 내일 다시 써 주세요.')
  }
  return { ok: true }
}

export async function cookieValueFromRequest(req: Request): Promise<string | undefined> {
  const header = req.headers.get('cookie')
  if (header) {
    for (const part of header.split(';')) {
      const trimmed = part.trim()
      if (!trimmed.startsWith(`${RECON_WS_COOKIE}=`)) continue
      try {
        return decodeURIComponent(trimmed.slice(RECON_WS_COOKIE.length + 1))
      } catch {
        return trimmed.slice(RECON_WS_COOKIE.length + 1)
      }
    }
  }
  try {
    const jar = await cookies()
    return jar.get(RECON_WS_COOKIE)?.value
  } catch {
    return undefined
  }
}
