import { NextResponse } from 'next/server'
import { CRISIS_BRIEF_CREDITS, CRISIS_BRIEF_MODULE, creditsForCrisisBrief } from '@/lib/crisis/credits'
import { localeFromRequest } from '@/lib/crisis/i18n/from-request'
import { getCrisisUiPack } from '@/lib/crisis/i18n/dictionary'
import { requireCrisisUser } from '@/lib/crisis/public/auth'
import { chargeCrisis } from '@/lib/crisis/public/charge'
import { briefCardsForUser, hasUnlock, unlockBriefForUser } from '@/lib/crisis/public/store'
import { localizeBriefCards } from '@/lib/crisis/translate/view'
import { supabaseAdmin } from '@/lib/supabase/server'

export async function GET(req: Request) {
  const auth = await requireCrisisUser(req)
  if ('response' in auth) return auth.response
  const locale = localeFromRequest(req)
  const t = getCrisisUiPack(locale)
  try {
    const cards = await briefCardsForUser(supabaseAdmin, auth.userId)
    return NextResponse.json({
      cards: await localizeBriefCards(supabaseAdmin, cards, locale),
      locale,
      price: creditsForCrisisBrief(),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : t.briefingLoadError
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
  const runId = typeof body.runId === 'string' ? body.runId.trim() : ''
  if (!runId) return NextResponse.json({ error: 'runId is required' }, { status: 400 })

  try {
    const already = await hasUnlock(supabaseAdmin, { userId: auth.userId, kind: 'brief', runId })
    if (!already) {
      const charged = await chargeCrisis(auth.userId, CRISIS_BRIEF_CREDITS, CRISIS_BRIEF_MODULE)
      if (!charged.ok) return charged.response
    }
    const card = await unlockBriefForUser(supabaseAdmin, auth.userId, runId)
    const [localized] = await localizeBriefCards(supabaseAdmin, [card], locale)
    return NextResponse.json({
      ok: true,
      cached: already,
      charged: already ? 0 : CRISIS_BRIEF_CREDITS,
      locale,
      card: localized ?? card,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : t.unlockFailed
    const status = /not found|not public/.test(message) ? 404 : 500
    return NextResponse.json({ error: message }, { status })
  }
}
