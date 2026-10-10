import { NextResponse } from 'next/server'
import { CRISIS_DEEP_CREDITS, CRISIS_DEEP_MODULE, creditsForCrisisDeep } from '@/lib/crisis/credits'
import { requireCrisisUser } from '@/lib/crisis/public/auth'
import { chargeCrisis } from '@/lib/crisis/public/charge'
import { decideDeepAction, DEEP_WAIT_COPY } from '@/lib/crisis/public/policy'
import {
  cardFromRunId,
  findFreshRun,
  hasUnlock,
  loadOwnRequest,
  queueDeepRequest,
  recordUnlock,
} from '@/lib/crisis/public/store'
import { supabaseAdmin } from '@/lib/supabase/server'

async function deepPayload(userId: string, regionId: number, now: Date) {
  const own = await loadOwnRequest(supabaseAdmin, userId, regionId)
  const fresh = await findFreshRun(supabaseAdmin, regionId, now)
  const ownCard = own?.run_id ? await cardFromRunId(supabaseAdmin, own.run_id) : null
  const action = decideDeepAction({
    ownStatus: own?.status ?? null,
    ownHasCard: Boolean(ownCard),
    freshPublicAt: fresh?.at ?? null,
    now,
  })
  return { action, own, fresh, ownCard }
}

export async function GET(req: Request) {
  const auth = await requireCrisisUser(req)
  if ('response' in auth) return auth.response
  const regionId = Number(new URL(req.url).searchParams.get('regionId'))
  if (!Number.isInteger(regionId) || regionId <= 0) {
    return NextResponse.json({ error: 'regionId is required' }, { status: 400 })
  }
  try {
    const now = new Date()
    const { action, own, ownCard, fresh } = await deepPayload(auth.userId, regionId, now)
    if (action === 'pending') {
      return NextResponse.json({
        status: 'pending',
        message: DEEP_WAIT_COPY,
        requestId: own?.id ?? null,
        price: creditsForCrisisDeep(),
      })
    }
    if (action === 'replay' && ownCard) {
      return NextResponse.json({ status: 'ready', cached: true, charged: 0, card: ownCard, price: creditsForCrisisDeep() })
    }
    if (action === 'cache' && fresh) {
      const unlocked = await hasUnlock(supabaseAdmin, { userId: auth.userId, kind: 'deep', regionId })
      if (unlocked) {
        const card = await cardFromRunId(supabaseAdmin, fresh.id)
        return NextResponse.json({ status: 'ready', cached: true, charged: 0, card, price: creditsForCrisisDeep() })
      }
    }
    return NextResponse.json({ status: 'idle', price: creditsForCrisisDeep() })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load deep analysis'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function POST(req: Request) {
  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const auth = await requireCrisisUser(req, body)
  if ('response' in auth) return auth.response
  const regionId = typeof body.regionId === 'number' ? body.regionId : Number(body.regionId)
  if (!Number.isInteger(regionId) || regionId <= 0) {
    return NextResponse.json({ error: 'regionId is required' }, { status: 400 })
  }

  try {
    const now = new Date()
    const own = await loadOwnRequest(supabaseAdmin, auth.userId, regionId)
    const fresh = await findFreshRun(supabaseAdmin, regionId, now)
    const ownCard = own?.run_id ? await cardFromRunId(supabaseAdmin, own.run_id) : null
    const action = decideDeepAction({
      ownStatus: own?.status ?? null,
      ownHasCard: Boolean(ownCard),
      freshPublicAt: fresh?.at ?? null,
      now,
    })

    if (action === 'pending') {
      return NextResponse.json({
        status: 'pending',
        message: DEEP_WAIT_COPY,
        requestId: own?.id ?? null,
        charged: 0,
      })
    }
    if (action === 'replay' && ownCard) {
      return NextResponse.json({ status: 'ready', cached: true, charged: 0, card: ownCard })
    }

    const already = await hasUnlock(supabaseAdmin, { userId: auth.userId, kind: 'deep', regionId })
    if (!already) {
      const charged = await chargeCrisis(auth.userId, CRISIS_DEEP_CREDITS, CRISIS_DEEP_MODULE)
      if (!charged.ok) return charged.response
    }

    if (action === 'cache' && fresh) {
      const card = await cardFromRunId(supabaseAdmin, fresh.id)
      if (card) {
        await recordUnlock(supabaseAdmin, { userId: auth.userId, kind: 'deep', runId: fresh.id, regionId })
        return NextResponse.json({
          status: 'ready',
          cached: true,
          charged: already ? 0 : CRISIS_DEEP_CREDITS,
          card,
        })
      }
    }

    const request = await queueDeepRequest(supabaseAdmin, regionId, auth.userId)
    await recordUnlock(supabaseAdmin, { userId: auth.userId, kind: 'deep', regionId, runId: null })
    return NextResponse.json({
      status: 'pending',
      message: DEEP_WAIT_COPY,
      requestId: request.id,
      charged: already ? 0 : CRISIS_DEEP_CREDITS,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Deep analysis failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
