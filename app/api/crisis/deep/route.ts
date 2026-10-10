import { NextResponse } from 'next/server'
import { CRISIS_DEEP_CREDITS, CRISIS_DEEP_MODULE, creditsForCrisisDeep } from '@/lib/crisis/credits'
import { getCrisisUiPack } from '@/lib/crisis/i18n/dictionary'
import { localeFromRequest } from '@/lib/crisis/i18n/from-request'
import { requireCrisisUser } from '@/lib/crisis/public/auth'
import { chargeCrisis } from '@/lib/crisis/public/charge'
import { enforceUserLimits } from '@/lib/crisis/public/limits'
import { localizeBriefCards } from '@/lib/crisis/translate/view'
import { isTimedOutRequest, refundTimedOutUserRequests, refundUserRequest } from '@/lib/crisis/public/refund'
import {
  cardFromRunId,
  findFreshRun,
  hasUnlock,
  loadDeepProgress,
  loadOwnRequest,
  queueDeepRequest,
  recordUnlock,
} from '@/lib/crisis/public/store'
import { finishRequest } from '@/lib/crisis/admin/store'
import { supabaseAdmin } from '@/lib/supabase/server'

export async function GET(req: Request) {
  const auth = await requireCrisisUser(req)
  if ('response' in auth) return auth.response
  const locale = localeFromRequest(req)
  const t = getCrisisUiPack(locale)
  const regionIdParam = new URL(req.url).searchParams.get('regionId')
  const now = new Date()

  // On page load without regionId: sweep timed-out requests and return active state
  if (!regionIdParam) {
    try {
      await refundTimedOutUserRequests(supabaseAdmin, auth.userId, now)
      const { data: active } = await supabaseAdmin
        .from('crisis_engine_requests')
        .select('id, region_id, status, created_at')
        .eq('requested_by', auth.userId)
        .in('status', ['queued', 'running'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      return NextResponse.json({
        ok: true,
        activeRegionId: active?.region_id ? Number(active.region_id) : null,
        message: active ? t.deepWait : null,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to check deep status'
      return NextResponse.json({ error: message }, { status: 500 })
    }
  }

  const regionId = Number(regionIdParam)
  if (!Number.isInteger(regionId) || regionId <= 0) {
    return NextResponse.json({ error: 'regionId is required' }, { status: 400 })
  }

  try {
    const own = await loadOwnRequest(supabaseAdmin, auth.userId, regionId)

    // Check timeout (> 60 min queued/running)
    if (own && isTimedOutRequest(own, now)) {
      await finishRequest(supabaseAdmin, own.id, { status: 'failed', error: 'timeout_60m' })
      await refundUserRequest(supabaseAdmin, own.id, auth.userId, regionId)
      return NextResponse.json({
        status: 'failed',
        message: t.deepFailed,
        error: t.deepFailed,
        refunded: true,
      })
    }

    if (own && own.status === 'failed') {
      await refundUserRequest(supabaseAdmin, own.id, auth.userId, regionId)
      return NextResponse.json({
        status: 'failed',
        message: t.deepFailed,
        error: t.deepFailed,
        refunded: true,
      })
    }

    if (own && (own.status === 'queued' || own.status === 'running')) {
      const progress = await loadDeepProgress(supabaseAdmin, own, now)
      return NextResponse.json({
        status: 'pending',
        message: progress.waitingForWorker ? t.workerWaiting : t.deepWait,
        price: creditsForCrisisDeep(),
        ...progress,
      })
    }

    if (own && own.status === 'done') {
      const ownCard = own.run_id ? await cardFromRunId(supabaseAdmin, own.run_id) : null
      if (ownCard) {
        const [card] = await localizeBriefCards(supabaseAdmin, [ownCard], locale)
        return NextResponse.json({
          status: 'ready',
          cached: true,
          charged: 0,
          card: card ?? ownCard,
          price: creditsForCrisisDeep(),
        })
      }
    }

    const fresh = await findFreshRun(supabaseAdmin, regionId, now)
    if (fresh) {
      const unlocked = await hasUnlock(supabaseAdmin, { userId: auth.userId, kind: 'deep', regionId })
      if (unlocked) {
        const raw = await cardFromRunId(supabaseAdmin, fresh.id)
        const [card] = raw ? await localizeBriefCards(supabaseAdmin, [raw], locale) : [null]
        return NextResponse.json({ status: 'ready', cached: true, charged: 0, card: card ?? raw, price: creditsForCrisisDeep() })
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
  const locale = localeFromRequest(req)
  const t = getCrisisUiPack(locale)
  const regionId = typeof body.regionId === 'number' ? body.regionId : Number(body.regionId)
  if (!Number.isInteger(regionId) || regionId <= 0) {
    return NextResponse.json({ error: 'regionId is required' }, { status: 400 })
  }

  try {
    const now = new Date()

    // 1. Sweep any timed-out requests for this user first
    await refundTimedOutUserRequests(supabaseAdmin, auth.userId, now)

    // 2. Check existing request for this region
    const own = await loadOwnRequest(supabaseAdmin, auth.userId, regionId)
    if (own && isTimedOutRequest(own, now)) {
      await finishRequest(supabaseAdmin, own.id, { status: 'failed', error: 'timeout_60m' })
      await refundUserRequest(supabaseAdmin, own.id, auth.userId, regionId)
      return NextResponse.json({
        status: 'failed',
        message: t.deepFailed,
        refunded: true,
      })
    }

    if (own && (own.status === 'queued' || own.status === 'running')) {
      const progress = await loadDeepProgress(supabaseAdmin, own, now)
      return NextResponse.json({
        status: 'pending',
        message: progress.waitingForWorker ? t.workerWaiting : t.deepWait,
        charged: 0,
        ...progress,
      })
    }

    if (own && own.status === 'done') {
      const ownCard = own.run_id ? await cardFromRunId(supabaseAdmin, own.run_id) : null
      if (ownCard) {
        const [card] = await localizeBriefCards(supabaseAdmin, [ownCard], locale)
        return NextResponse.json({ status: 'ready', cached: true, charged: 0, card: card ?? ownCard })
      }
    }

    // 3. Check fresh cached card (< 24h)
    const fresh = await findFreshRun(supabaseAdmin, regionId, now)
    if (fresh) {
      const already = await hasUnlock(supabaseAdmin, { userId: auth.userId, kind: 'deep', regionId })
      if (!already) {
        const charged = await chargeCrisis(auth.userId, CRISIS_DEEP_CREDITS, CRISIS_DEEP_MODULE)
        if (!charged.ok) return charged.response
      }
      const raw = await cardFromRunId(supabaseAdmin, fresh.id)
      if (raw) {
        await recordUnlock(supabaseAdmin, { userId: auth.userId, kind: 'deep', runId: fresh.id, regionId })
        const [card] = await localizeBriefCards(supabaseAdmin, [raw], locale)
        return NextResponse.json({
          status: 'ready',
          cached: true,
          charged: already ? 0 : CRISIS_DEEP_CREDITS,
          card: card ?? raw,
        })
      }
    }

    // 4. Request limits check (1 active, 3 per day, admin exempt)
    const limits = await enforceUserLimits(supabaseAdmin, auth.userId, auth.email, now)
    if (!limits.allowed) {
      return NextResponse.json(
        { error: limits.message, code: limits.reason },
        { status: 429 },
      )
    }

    // 5. Charge credits if not already unlocked
    const already = await hasUnlock(supabaseAdmin, { userId: auth.userId, kind: 'deep', regionId })
    if (!already) {
      const charged = await chargeCrisis(auth.userId, CRISIS_DEEP_CREDITS, CRISIS_DEEP_MODULE)
      if (!charged.ok) return charged.response
    }

    // 6. Queue request
    const request = await queueDeepRequest(supabaseAdmin, regionId, auth.userId)
    const progress = await loadDeepProgress(supabaseAdmin, request, now)
    return NextResponse.json({
      status: 'pending',
      message: progress.waitingForWorker ? t.workerWaiting : t.deepWait,
      charged: already ? 0 : CRISIS_DEEP_CREDITS,
      ...progress,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Deep analysis failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
