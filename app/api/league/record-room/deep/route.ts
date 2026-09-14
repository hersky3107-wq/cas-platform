import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/server'
import { creditsForLeagueArchive, creditsForLeagueRecordRoom } from '@/lib/credits'
import { deductCreditsBalance } from '@/lib/credits-server'
import { LEAGUE_ARCHIVE_RATE_RULE } from '@/lib/league/access-policy'
import { enforceRateLimit, resolveLeagueViewer } from '@/lib/league/public-access'
import {
  RECORD_ROOM_DEFAULT_PAGE_SIZE,
  fetchRecordRoomPage,
  listRecentResolvedRoundIds,
  recordRoomToCsv,
} from '@/lib/league/record-room'
import { latestRecordRoomWindow } from '@/lib/league/view-purchases'
import { lockedViewPayload, RECORD_ROOM_PURCHASED_PAGE_SIZE } from '@/lib/league/view-purchase-policy'

export const maxDuration = 30

/**
 * POST /api/league/record-room/deep
 *
 * CSV export of an already-purchased record-room window
 * (`LEAGUE_ARCHIVE_CREDITS`, 15). Requires a live record-room purchase
 * first — this route never widens the window and never dumps full history.
 * Admin skips the charge and the window (operator preview).
 *
 * Body: { modelId?, from?, to?, format?: 'csv' | 'json' }
 */

export async function POST(req: Request) {
  let body: Record<string, unknown> = {}
  try {
    const parsed = await req.json()
    if (parsed && typeof parsed === 'object') body = parsed as Record<string, unknown>
  } catch {
    body = {}
  }

  const auth = await resolveLeagueViewer(req, body)
  if (!auth.ok) return auth.response
  const { viewer } = auth

  const limited = enforceRateLimit(viewer, 'league_archive', LEAGUE_ARCHIVE_RATE_RULE)
  if (limited) return limited

  const modelId = typeof body.modelId === 'string' ? body.modelId.trim() : undefined
  const from = normalizeDayStart(typeof body.from === 'string' ? body.from.trim() : undefined)
  const to = normalizeDayEnd(typeof body.to === 'string' ? body.to.trim() : undefined)
  const format = body.format === 'json' ? 'json' : 'csv'

  if (viewer.isAdmin) {
    try {
      const data = await fetchRecordRoomPage(1, RECORD_ROOM_DEFAULT_PAGE_SIZE, {
        modelId: modelId || undefined,
        from: from || undefined,
        to: to || undefined,
        deep: true,
      })
      return respond(data, format, 0, null)
    } catch (e: unknown) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : 'failed to load deep archive' },
        { status: 500 }
      )
    }
  }

  const window = await latestRecordRoomWindow(viewer.userId)
  if (!window) {
    return NextResponse.json(lockedViewPayload('record_room', creditsForLeagueRecordRoom()), { status: 403 })
  }

  const cost = creditsForLeagueArchive()
  const deduct = await deductCreditsBalance(supabaseAdmin, viewer.userId, cost, 'league_archive')
  if (!deduct.ok) {
    const insufficient = deduct.reason === 'insufficient'
    return NextResponse.json(
      {
        error: insufficient ? 'Insufficient credits' : 'Could not update credits',
        balance: deduct.balance,
        required: cost,
      },
      { status: insufficient ? 402 : 500 }
    )
  }

  try {
    const windowRoundIds = await listRecentResolvedRoundIds({
      asOf: window.asOf,
      limit: window.roundLimit,
      categories: viewer.visibleCategories,
    })
    const data = await fetchRecordRoomPage(1, Math.max(windowRoundIds.length, RECORD_ROOM_PURCHASED_PAGE_SIZE), {
      categories: viewer.visibleCategories,
      modelId: modelId || undefined,
      from: from || undefined,
      to: to || undefined,
      deep: true,
      windowRoundIds,
      window,
    })
    return respond(data, format, deduct.skipped ? 0 : cost, typeof deduct.balance === 'number' ? deduct.balance : null)
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'failed to load deep archive' },
      { status: 500 }
    )
  }
}

function respond(
  data: Awaited<ReturnType<typeof fetchRecordRoomPage>>,
  format: 'json' | 'csv',
  charged: number,
  balance: number | null
) {
  if (format === 'csv') {
    return new NextResponse(recordRoomToCsv(data), {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="league-archive.csv"',
      },
    })
  }
  return NextResponse.json({ ...data, charged, ...(balance !== null ? { balance } : {}) })
}

function normalizeDayStart(raw: string | undefined): string | undefined {
  if (!raw) return undefined
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return `${raw}T00:00:00.000Z`
  return raw
}

function normalizeDayEnd(raw: string | undefined): string | undefined {
  if (!raw) return undefined
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return `${raw}T23:59:59.999Z`
  return raw
}
