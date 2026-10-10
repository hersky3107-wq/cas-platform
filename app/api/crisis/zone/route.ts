import { NextResponse } from 'next/server'
import { finishRequest } from '@/lib/crisis/admin/store'
import {
  CRISIS_GLOBAL_CREDITS,
  CRISIS_GLOBAL_MODULE,
  CRISIS_ZONE_CREDITS,
  CRISIS_ZONE_MODULE,
  creditsForCrisisGlobal,
  creditsForCrisisZone,
} from '@/lib/crisis/credits'
import { getCrisisUiPack } from '@/lib/crisis/i18n/dictionary'
import { localeFromRequest } from '@/lib/crisis/i18n/from-request'
import { requireCrisisUser } from '@/lib/crisis/public/auth'
import { chargeCrisis } from '@/lib/crisis/public/charge'
import { enforceUserLimits } from '@/lib/crisis/public/limits'
import { isTimedOutRequest, refundTimedOutUserRequests, refundUserRequest } from '@/lib/crisis/public/refund'
import {
  cardFromRunId,
  findFreshZoneRun,
  hasGlobalUnlock,
  hasZoneUnlock,
  loadDeepProgress,
  loadOwnZoneRequest,
  parseZoneKey,
  queueGlobalRequest,
  queueZoneRequest,
  recordGlobalUnlock,
  recordZoneUnlock,
} from '@/lib/crisis/public/store'
import { CRISIS_ZONES } from '@/lib/crisis/zones'
import { localizeBriefCards } from '@/lib/crisis/translate/view'
import { supabaseAdmin } from '@/lib/supabase/server'
import type { UnlockedBriefCard } from '@/lib/crisis/public/card'

async function readyCard(runId: string, locale: ReturnType<typeof localeFromRequest>): Promise<UnlockedBriefCard | null> {
  const raw = await cardFromRunId(supabaseAdmin, runId)
  if (!raw) return null
  const [card] = await localizeBriefCards(supabaseAdmin, [raw], locale)
  return (card && !card.locked ? card : raw) as UnlockedBriefCard
}

export async function GET(req: Request) {
  const auth = await requireCrisisUser(req)
  if ('response' in auth) return auth.response
  const locale = localeFromRequest(req)
  const t = getCrisisUiPack(locale)
  const url = new URL(req.url)
  const scope = url.searchParams.get('scope')
  const now = new Date()

  try {
    await refundTimedOutUserRequests(supabaseAdmin, auth.userId, now)
    if (scope === 'global') {
      const { data: parent } = await supabaseAdmin
        .from('crisis_engine_requests')
        .select('id,status,created_at')
        .eq('requested_by', auth.userId)
        .eq('scope', 'all')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (!parent) return NextResponse.json({ status: 'idle', price: creditsForCrisisGlobal() })
      const { data: children } = await supabaseAdmin
        .from('crisis_engine_requests')
        .select('id,zone_key,status,run_id,created_at')
        .eq('requested_by', auth.userId)
        .eq('scope', 'zone')
        .gte('created_at', parent.created_at)
      const rows = children ?? []
      const pending = rows.filter((row) => row.status === 'queued' || row.status === 'running')
      if (parent.status === 'queued' || parent.status === 'running' || pending.length > 0 || rows.length === 0) {
        const active = pending[0]
        const progress = active
          ? await loadDeepProgress(
              supabaseAdmin,
              {
                id: String(active.id),
                region_id: null,
                scope: 'zone',
                zone_key: typeof active.zone_key === 'string' ? active.zone_key : null,
                requested_by: auth.userId,
                status: active.status === 'running' ? 'running' : 'queued',
                run_id: active.run_id == null ? null : String(active.run_id),
                error: null,
                created_at: String(active.created_at ?? parent.created_at),
                started_at: null,
                finished_at: null,
              },
              now,
            )
          : null
        return NextResponse.json({
          status: 'pending',
          message: progress?.waitingForWorker ? t.workerWaiting : t.deepWait,
          price: creditsForCrisisGlobal(),
          ...(progress ?? {}),
        })
      }
      const cards = []
      for (const row of rows) {
        if (row.status !== 'done' || !row.run_id) continue
        const card = await readyCard(String(row.run_id), locale)
        if (card) cards.push(card)
      }
      return NextResponse.json({ status: 'ready', cards, price: creditsForCrisisGlobal() })
    }

    const zoneKey = parseZoneKey(url.searchParams.get('zoneKey'))
    if (!zoneKey) return NextResponse.json({ status: 'idle', price: creditsForCrisisZone(), zones: CRISIS_ZONES })

    const own = await loadOwnZoneRequest(supabaseAdmin, auth.userId, zoneKey)
    if (own && isTimedOutRequest(own, now)) {
      await finishRequest(supabaseAdmin, own.id, { status: 'failed', error: 'timeout_60m' })
      await refundUserRequest(supabaseAdmin, own.id, auth.userId, null, CRISIS_ZONE_CREDITS)
      return NextResponse.json({ status: 'failed', message: t.deepFailed, refunded: true })
    }
    if (own && own.status === 'failed' && own.error !== 'batch:global') {
      await refundUserRequest(supabaseAdmin, own.id, auth.userId, null, CRISIS_ZONE_CREDITS)
      return NextResponse.json({ status: 'failed', message: t.deepFailed, refunded: true })
    }
    if (own && (own.status === 'queued' || own.status === 'running')) {
      const progress = await loadDeepProgress(supabaseAdmin, own, now)
      return NextResponse.json({
        status: 'pending',
        message: progress.waitingForWorker ? t.workerWaiting : t.deepWait,
        price: creditsForCrisisZone(),
        ...progress,
      })
    }
    if (own && own.status === 'done' && own.run_id) {
      const card = await readyCard(own.run_id, locale)
      if (card) return NextResponse.json({ status: 'ready', cached: true, charged: 0, card, price: creditsForCrisisZone() })
    }
    const fresh = await findFreshZoneRun(supabaseAdmin, zoneKey, now)
    if (fresh && (await hasZoneUnlock(supabaseAdmin, auth.userId, zoneKey))) {
      const card = await readyCard(fresh.id, locale)
      if (card) return NextResponse.json({ status: 'ready', cached: true, charged: 0, card, price: creditsForCrisisZone() })
    }
    return NextResponse.json({ status: 'idle', price: creditsForCrisisZone() })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load zone analysis'
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
  const scope = body.scope === 'global' ? 'global' : 'zone'
  const now = new Date()

  try {
    await refundTimedOutUserRequests(supabaseAdmin, auth.userId, now)

    if (scope === 'global') {
      const freshIds: string[] = []
      let missing = false
      for (const zone of CRISIS_ZONES) {
        const fresh = await findFreshZoneRun(supabaseAdmin, zone.key, now)
        if (!fresh) {
          missing = true
          continue
        }
        freshIds.push(fresh.id)
      }
      const already = await hasGlobalUnlock(supabaseAdmin, auth.userId)
      if (!missing && freshIds.length === CRISIS_ZONES.length) {
        if (!already) {
          const charged = await chargeCrisis(auth.userId, CRISIS_GLOBAL_CREDITS, CRISIS_GLOBAL_MODULE)
          if (!charged.ok) return charged.response
        }
        await recordGlobalUnlock(supabaseAdmin, auth.userId)
        const cards = []
        for (const id of freshIds) {
          const card = await readyCard(id, locale)
          if (card) cards.push(card)
        }
        return NextResponse.json({
          status: 'ready',
          cached: true,
          charged: already ? 0 : CRISIS_GLOBAL_CREDITS,
          cards,
        })
      }
      const limits = await enforceUserLimits(supabaseAdmin, auth.userId, auth.email, now)
      if (!limits.allowed) return NextResponse.json({ error: limits.message, code: limits.reason }, { status: 429 })
      if (!already) {
        const charged = await chargeCrisis(auth.userId, CRISIS_GLOBAL_CREDITS, CRISIS_GLOBAL_MODULE)
        if (!charged.ok) return charged.response
      }
      const request = await queueGlobalRequest(supabaseAdmin, auth.userId)
      const progress = await loadDeepProgress(supabaseAdmin, request, now)
      return NextResponse.json({
        status: 'pending',
        message: progress.waitingForWorker ? t.workerWaiting : t.deepWait,
        charged: already ? 0 : CRISIS_GLOBAL_CREDITS,
        ...progress,
      })
    }

    const zoneKey = parseZoneKey(body.zoneKey)
    if (!zoneKey) return NextResponse.json({ error: 'zoneKey is required' }, { status: 400 })

    const own = await loadOwnZoneRequest(supabaseAdmin, auth.userId, zoneKey)
    if (own && (own.status === 'queued' || own.status === 'running')) {
      const progress = await loadDeepProgress(supabaseAdmin, own, now)
      return NextResponse.json({
        status: 'pending',
        message: progress.waitingForWorker ? t.workerWaiting : t.deepWait,
        charged: 0,
        ...progress,
      })
    }
    if (own && own.status === 'done' && own.run_id) {
      const card = await readyCard(own.run_id, locale)
      if (card) return NextResponse.json({ status: 'ready', cached: true, charged: 0, card })
    }

    const fresh = await findFreshZoneRun(supabaseAdmin, zoneKey, now)
    if (fresh) {
      const already = await hasZoneUnlock(supabaseAdmin, auth.userId, zoneKey)
      if (!already) {
        const charged = await chargeCrisis(auth.userId, CRISIS_ZONE_CREDITS, CRISIS_ZONE_MODULE)
        if (!charged.ok) return charged.response
      }
      await recordZoneUnlock(supabaseAdmin, { userId: auth.userId, zoneKey, runId: fresh.id })
      const card = await readyCard(fresh.id, locale)
      if (card) {
        return NextResponse.json({
          status: 'ready',
          cached: true,
          charged: already ? 0 : CRISIS_ZONE_CREDITS,
          card,
        })
      }
    }

    const limits = await enforceUserLimits(supabaseAdmin, auth.userId, auth.email, now)
    if (!limits.allowed) return NextResponse.json({ error: limits.message, code: limits.reason }, { status: 429 })
    const already = await hasZoneUnlock(supabaseAdmin, auth.userId, zoneKey)
    if (!already) {
      const charged = await chargeCrisis(auth.userId, CRISIS_ZONE_CREDITS, CRISIS_ZONE_MODULE)
      if (!charged.ok) return charged.response
    }
    const request = await queueZoneRequest(supabaseAdmin, zoneKey, auth.userId)
    const progress = await loadDeepProgress(supabaseAdmin, request, now)
    return NextResponse.json({
      status: 'pending',
      message: progress.waitingForWorker ? t.workerWaiting : t.deepWait,
      charged: already ? 0 : CRISIS_ZONE_CREDITS,
      ...progress,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Zone analysis failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
