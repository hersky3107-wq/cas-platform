/**
 * GET  /api/oracle/talisman — latest (or ?session=) finished integrated reading + spec.
 * POST /api/oracle/talisman — charge then unlock all four formats for (session, purpose).
 */
import { NextResponse } from 'next/server'
import { specFromComputation, talismanStats } from '@/lib/oracle/talisman/from-computation'
import { PHYSICS_CAPTION } from '@/lib/oracle/talisman/variants'
import { createCreditsPort } from '@/lib/oracle/runner/credits'
import { createSupabaseRunnerStore } from '@/lib/oracle/runner/store'
import { TALISMAN_PRICE } from '@/lib/oracle/runner/conventions'
import { talismanFromStoredSession, talismanSerialFromEnv } from '@/lib/oracle/talisman'
import {
  parseTalismanBuyPurpose,
  talismanComputePurpose,
  talismanPriceFor,
  unlockedTalismanFormats,
} from '@/lib/oracle/talisman/entitlement'
import { purchaseTalismanUnlock } from '@/lib/oracle/talisman/purchase'
import {
  createTalismanPurchaseStore,
  createTalismanSourceStore,
  loadEligibleIntegratedSessions,
  loadIntegratedTalismanSession,
} from '@/lib/oracle/talisman/purchase-store'
import { missingSupabaseEnv, resolveRouteAuth } from '@/lib/supabase/route-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function requireUser(req: Request) {
  const missing = missingSupabaseEnv()
  if (missing) {
    return { error: NextResponse.json({ error: `Server misconfigured: missing ${missing}` }, { status: 503 }) }
  }
  const { user, error: authErr } = await resolveRouteAuth(req)
  if (authErr || !user) {
    return { error: NextResponse.json({ error: 'Invalid session' }, { status: 401 }) }
  }
  return { user }
}

export async function GET(req: Request) {
  try {
    const auth = await requireUser(req)
    if ('error' in auth) return auth.error

    const url = new URL(req.url)
    const purpose = parseTalismanBuyPurpose(url.searchParams.get('purpose'))
    const requested = url.searchParams.get('session')

    const eligibleSessions = await loadEligibleIntegratedSessions(auth.user.id)
    if (eligibleSessions.length === 0) {
      return NextResponse.json({
        ok: true,
        hasReading: false,
        purpose,
        price: talismanPriceFor(purpose),
        prices: TALISMAN_PRICE,
        purchased: false,
        isFirstIntegratedSession: false,
        unlockedFormats: [],
        sessions: [],
      })
    }

    const matched = requested ? eligibleSessions.find((s) => s.id === requested) : null
    const targetSessionId = matched ? matched.id : eligibleSessions[0]!.id

    const session = await loadIntegratedTalismanSession(auth.user.id, targetSessionId)
    if (!session) {
      return NextResponse.json({
        ok: true,
        hasReading: false,
        purpose,
        price: talismanPriceFor(purpose),
        prices: TALISMAN_PRICE,
        purchased: false,
        isFirstIntegratedSession: false,
        unlockedFormats: [],
        sessions: [],
      })
    }

    const store = createSupabaseRunnerStore()
    const [computations, consensus, purchases] = await Promise.all([
      store.listComputations(session.id),
      store.getConsensus(session.id),
      createTalismanPurchaseStore().list(auth.user.id, session.id),
    ])

    const earliestSession = eligibleSessions[eligibleSessions.length - 1]!
    const isFirst = session.id === earliestSession.id

    const result = talismanFromStoredSession({
      session,
      computations,
      deficiency: consensus?.deficiency_vector ?? null,
      purpose: talismanComputePurpose(purpose),
    })

    const [y, m, d] = session.created_at.slice(0, 10).split('-')
    const readingDateLabel = `${Number(y)}.${Number(m)}.${Number(d)} 통합 판독 기준`

    const sessions = eligibleSessions.map((s) => {
      const [sy, sm, sd] = s.created_at.slice(0, 10).split('-')
      return {
        id: s.id,
        createdAt: s.created_at,
        label: `${Number(sy)}.${Number(sm)}.${Number(sd)} 통합 판독`,
      }
    })

    const purchased = purchases.some((row) => row.purpose === purpose)
    const payload = {
      ok: true,
      hasReading: true,
      sessionId: session.id,
      purpose,
      price: talismanPriceFor(purpose),
      prices: TALISMAN_PRICE,
      purchased,
      isFirstIntegratedSession: isFirst,
      readingDateLabel,
      sessions,
      unlockedFormats: unlockedTalismanFormats({
        purchased,
        purpose,
        isFirstIntegratedSession: isFirst,
      }),
      purchasedPurposes: purchases.map((row) => row.purpose),
    }

    if (!result.computation) {
      return NextResponse.json({
        ...payload,
        hasReading: false,
        reason: result.reason,
      })
    }

    const spec = specFromComputation(result.computation, result.charts, {
      sessionId: session.id,
      dateLabel: session.created_at.slice(0, 10).replaceAll('-', '.'),
      serial: talismanSerialFromEnv(session.id),
      title: 'session',
      note: `${result.computation.centre.source} · ${result.computation.centre.mode}`,
    })

    return NextResponse.json({
      ...payload,
      spec,
      stats: talismanStats(result.computation, result.charts),
      physicsCaption: spec.physicsCaption ?? PHYSICS_CAPTION,
      arrival: result.arrival,
    })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const auth = await requireUser(req)
    if ('error' in auth) return auth.error

    const body = (await req.json().catch(() => null)) as {
      sessionId?: unknown
      purpose?: unknown
    } | null
    const sessionId = typeof body?.sessionId === 'string' ? body.sessionId : null
    const purpose = typeof body?.purpose === 'string' ? body.purpose : null

    const result = await purchaseTalismanUnlock(
      {
        credits: createCreditsPort(),
        purchases: createTalismanPurchaseStore(),
        source: createTalismanSourceStore(),
      },
      { userId: auth.user.id, sessionId, purpose },
    )

    if (!result.ok) {
      const status = result.reason === 'insufficient' ? 402 : result.reason === 'no-reading' ? 404 : 500
      return NextResponse.json(result, { status })
    }

    return NextResponse.json({
      ...result,
      unlockedFormats: unlockedTalismanFormats({
        purchased: true,
        purpose: result.purpose,
        isFirstIntegratedSession: false,
      }),
    })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
