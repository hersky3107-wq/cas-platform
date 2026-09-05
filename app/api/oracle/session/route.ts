/**
 * POST /api/oracle/session — create a reading session.
 *
 * Runs the whole calculation stage inline (12 engines + axis projection +
 * consensus, ~8ms) and returns a session the client can start polling. No AI
 * runs here; the first chunk starts on the first call to
 * POST /api/oracle/session/[id]/advance.
 *
 * One active session per user: a second create while one is in flight returns
 * the existing session instead of charging again.
 */
import { NextResponse } from 'next/server'
import { isAllowedReaderCount } from '@/lib/oracle/ai/family-roster'
import { refreshProfileCoordinates } from '@/lib/oracle/profile-coordinates'
import {
  ORACLE_READER_COUNTS,
  ORACLE_SESSION_KINDS,
  ORACLE_SESSION_SCOPES,
  type OracleReaderCount,
  type OracleSessionKind,
  type OracleSessionScope,
} from '@/lib/oracle/schema'
import { SYSTEM_IDS } from '@/lib/oracle/axes/types'
import { createOracleSession, type CreateSessionRequest } from '@/lib/oracle/runner'
import { createCreditsPort } from '@/lib/oracle/runner/credits'
import { validateSessionInputs } from '@/lib/oracle/runner/session-inputs'
import { createSupabaseRunnerStore } from '@/lib/oracle/runner/store'
import { missingSupabaseEnv, resolveRouteAuth } from '@/lib/supabase/route-auth'

export const runtime = 'nodejs'

const MAX_QUESTION_LENGTH = 2_000

type ParsedBody =
  | { ok: true; request: CreateSessionRequest }
  | { ok: false; error: string }

function parseBody(body: Record<string, unknown>): ParsedBody {
  const kind = body.kind
  if (typeof kind !== 'string' || !(ORACLE_SESSION_KINDS as readonly string[]).includes(kind)) {
    return { ok: false, error: `kind must be one of ${ORACLE_SESSION_KINDS.join(', ')}` }
  }

  const scope = body.scope
  if (typeof scope !== 'string' || !(ORACLE_SESSION_SCOPES as readonly string[]).includes(scope)) {
    return { ok: false, error: `scope must be one of ${ORACLE_SESSION_SCOPES.join(', ')}` }
  }

  const subjectProfileId = body.subjectProfileId
  if (typeof subjectProfileId !== 'string' || subjectProfileId.trim() === '') {
    return { ok: false, error: 'subjectProfileId is required' }
  }

  const partnerRaw = body.partnerProfileId
  if (partnerRaw !== undefined && partnerRaw !== null && typeof partnerRaw !== 'string') {
    return { ok: false, error: 'partnerProfileId must be a string when present' }
  }

  const readerCount = body.readerCount
  if (typeof readerCount !== 'number' || !(ORACLE_READER_COUNTS as readonly number[]).includes(readerCount)) {
    return { ok: false, error: `readerCount must be one of ${ORACLE_READER_COUNTS.join(', ')}` }
  }

  const systemsRaw = body.systems ?? []
  if (!Array.isArray(systemsRaw)) {
    return { ok: false, error: 'systems must be an array' }
  }
  const systems: string[] = []
  for (const entry of systemsRaw) {
    if (typeof entry !== 'string' || !(SYSTEM_IDS as readonly string[]).includes(entry)) {
      return { ok: false, error: `unknown system "${String(entry)}"` }
    }
    systems.push(entry)
  }

  // Single-system product rule: N ∈ {3,5,7} only (reject 9). Combined keeps 3/5/7/9.
  if (!isAllowedReaderCount(scope as OracleSessionScope, readerCount)) {
    return {
      ok: false,
      error:
        scope === 'single'
          ? 'single-system readerCount must be 3, 5, or 7'
          : `readerCount must be one of ${ORACLE_READER_COUNTS.join(', ')}`,
    }
  }

  const questionRaw = body.question
  if (questionRaw !== undefined && questionRaw !== null && typeof questionRaw !== 'string') {
    return { ok: false, error: 'question must be a string when present' }
  }
  if (typeof questionRaw === 'string' && questionRaw.length > MAX_QUESTION_LENGTH) {
    return { ok: false, error: `question must be at most ${MAX_QUESTION_LENGTH} characters` }
  }

  const sessionInputs = validateSessionInputs(body.sessionInputs)
  if (!sessionInputs.ok) {
    return { ok: false, error: sessionInputs.error }
  }

  const locale = typeof body.locale === 'string' && body.locale.trim() !== '' ? body.locale.trim() : 'ko'

  return {
    ok: true,
    request: {
      kind: kind as OracleSessionKind,
      subjectProfileId: subjectProfileId.trim(),
      partnerProfileId: typeof partnerRaw === 'string' ? partnerRaw.trim() : null,
      scope: scope as OracleSessionScope,
      systems,
      question: typeof questionRaw === 'string' ? questionRaw : null,
      sessionInputs: sessionInputs.value,
      readerCount: readerCount as OracleReaderCount,
      locale,
    },
  }
}

export async function POST(req: Request) {
  try {
    const missing = missingSupabaseEnv()
    if (missing) {
      return NextResponse.json({ error: `Server misconfigured: missing ${missing}` }, { status: 503 })
    }

    let body: Record<string, unknown>
    try {
      body = (await req.json()) as Record<string, unknown>
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }

    const { user, error: authErr } = await resolveRouteAuth(req, body)
    if (authErr || !user) {
      return NextResponse.json({ error: 'Invalid session' }, { status: 401 })
    }

    const parsed = parseBody(body)
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 })
    }

    const wantsAstro =
      parsed.request.systems.includes('astro') || parsed.request.systems.length === 0
    if (wantsAstro) {
      await refreshProfileCoordinates(user.id, parsed.request.subjectProfileId)
    }

    const outcome = await createOracleSession(user.id, parsed.request, {
      store: createSupabaseRunnerStore(),
      credits: createCreditsPort(),
    })

    if (!outcome.ok) {
      const status =
        outcome.code === 'invalid_input'
          ? 400
          : outcome.code === 'profile_not_found'
          ? 404
          : outcome.code === 'insufficient_credits'
            ? 402
            : 500
      return NextResponse.json(
        { error: outcome.message, code: outcome.code, balance: outcome.balance, sessionId: outcome.sessionId },
        { status },
      )
    }

    return NextResponse.json({
      ok: true,
      reused: outcome.reused,
      sessionId: outcome.session.id,
      status: outcome.session.status,
      nextAction: outcome.session.next_action,
      progress: outcome.session.progress,
      computations: outcome.computations,
      assumptions: outcome.assumptions,
    })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
