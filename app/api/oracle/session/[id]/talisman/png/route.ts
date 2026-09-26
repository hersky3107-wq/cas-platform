/**
 * GET /api/oracle/session/[id]/talisman/png
 * Owner-only PNG. Same not-found payload as the preview for a non-owner.
 */
import { NextResponse } from 'next/server'
import { previewFromStoredSession } from '@/app/modes/oracle/talisman-preview/preview-session'
import { PREVIEW_SESSION_MISS } from '@/app/modes/oracle/talisman-preview/preview-access'
import { parseTalismanPngFormat, renderTalismanPng } from '@/lib/oracle/talisman/png'
import { canDownloadTalismanFormat, parseTalismanBuyPurpose } from '@/lib/oracle/talisman/entitlement'
import { hasTalismanPurchase, loadFirstIntegratedSessionId } from '@/lib/oracle/talisman/purchase-store'
import { missingSupabaseEnv, resolveRouteAuth } from '@/lib/supabase/route-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

function notFound() {
  return NextResponse.json(PREVIEW_SESSION_MISS, { status: 404 })
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const missing = missingSupabaseEnv()
    if (missing) {
      return NextResponse.json({ error: `Server misconfigured: missing ${missing}` }, { status: 503 })
    }

    const { user } = await resolveRouteAuth(req)
    const { id } = await params
    const url = new URL(req.url)
    const format = parseTalismanPngFormat(url.searchParams.get('format'))
    if (!format) {
      return NextResponse.json({ error: 'format must be phone|wallet|square|desktop' }, { status: 400 })
    }

    const purposeRaw = url.searchParams.get('purpose')
    const purpose = parseTalismanBuyPurpose(purposeRaw)
    const payload = await previewFromStoredSession(id, purposeRaw, user?.id ?? null)
    if (!payload.ok && payload.reason === 'not-found') return notFound()
    if (!payload.ok || !payload.spec) {
      return NextResponse.json({ ok: false, reason: payload.reason ?? 'not-found' }, { status: 404 })
    }

    const purchased = user ? await hasTalismanPurchase(user.id, id, purpose) : false
    const firstSessionId = user ? await loadFirstIntegratedSessionId(user.id) : null
    if (
      !canDownloadTalismanFormat({
        purchased,
        purpose,
        format,
        isFirstIntegratedSession: Boolean(user && firstSessionId === id),
      })
    ) {
      return notFound()
    }

    const rendered = await renderTalismanPng(payload.spec, format)
    return new NextResponse(new Uint8Array(rendered.png), {
      status: 200,
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'private, max-age=3600',
        'Content-Disposition': `attachment; filename="talisman-${format}.png"`,
        'X-Talisman-Renderer': rendered.engine,
        'X-Talisman-Render-Ms': String(rendered.ms),
      },
    })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
