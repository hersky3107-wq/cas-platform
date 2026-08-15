import 'server-only'

import { NextResponse } from 'next/server'
import { missingSupabaseEnv, resolveRouteAuth } from '@/lib/supabase/route-auth'
import type { DalResult } from '@/lib/reconciliation/types'

/**
 * Branded owner scope for 대사기.
 *
 * The brand field cannot be constructed from a client-supplied user id.
 * DAL functions accept OwnedScope — not a raw string — so a route cannot
 * accidentally pass body.user_id into a query.
 *
 * Authorization is APP-LAYER. supabaseAdmin bypasses RLS; RLS is
 * defense-in-depth only. Every read/write must go through this scope.
 */
declare const ownedBrand: unique symbol

export type OwnedScope = {
  readonly userId: string
  readonly [ownedBrand]: true
}

function createOwnedScope(userId: string): OwnedScope {
  return { userId, [ownedBrand]: true } as OwnedScope
}

export type OwnedScopeOk = {
  ok: true
  scope: OwnedScope
  body: Record<string, unknown>
}

export type OwnedScopeFail = {
  ok: false
  response: NextResponse
}

/**
 * Authenticate the request and return a branded owner scope.
 *
 * All reconciliation API routes MUST call this before any DAL function.
 * Rejects unauthenticated callers. Does not trust a user_id in the body.
 */
export async function withOwnedScope(req: Request): Promise<OwnedScopeOk | OwnedScopeFail> {
  const missing = missingSupabaseEnv()
  if (missing) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: `Server misconfigured: missing ${missing}` },
        { status: 503 }
      ),
    }
  }

  let body: Record<string, unknown> = {}
  const text = await req.text()
  if (text.trim()) {
    try {
      const parsed: unknown = JSON.parse(text)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        body = parsed as Record<string, unknown>
      } else {
        return {
          ok: false,
          response: NextResponse.json({ error: 'JSON body must be an object' }, { status: 400 }),
        }
      }
    } catch {
      return {
        ok: false,
        response: NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }),
      }
    }
  }

  const { user, error: authErr } = await resolveRouteAuth(req, body)
  if (authErr || !user?.id) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Invalid session' }, { status: 401 }),
    }
  }

  return { ok: true, scope: createOwnedScope(user.id), body }
}

export function fromDal<T>(result: DalResult<T>, okStatus = 200): NextResponse {
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }
  return NextResponse.json(result.data, { status: okStatus })
}

export function queryParams(req: Request): URLSearchParams {
  return new URL(req.url).searchParams
}
