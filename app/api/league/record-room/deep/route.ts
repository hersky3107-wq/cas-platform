import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/server'
import { creditsForLeagueArchive } from '@/lib/credits'
import { deductCreditsBalance } from '@/lib/credits-server'
import { LEAGUE_ARCHIVE_RATE_RULE } from '@/lib/league/access-policy'
import { enforceRateLimit, resolveLeagueViewer } from '@/lib/league/public-access'
import {
  RECORD_ROOM_DEFAULT_PAGE_SIZE,
  fetchRecordRoomPage,
  recordRoomToCsv,
} from '@/lib/league/record-room'

export const maxDuration = 30

/**
 * POST /api/league/record-room/deep
 *
 * CREDIT-GATED deep archive. One charge per request (`LEAGUE_ARCHIVE_CREDITS`,
 * currently 3 — flagged for owner confirmation). Admin skips the charge.
 *
 * Body:
 *   { page?, pageSize?, modelId?, from?, to?, format?: 'json' | 'csv' }
 *
 * Enforcement order (same as generate-stream): auth → rate limit → credits
 * → query. 402 on insufficient balance, before any heavy read.
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

  const page = asPositiveInt(body.page) ?? 1
  const pageSize = asPositiveInt(body.pageSize) ?? RECORD_ROOM_DEFAULT_PAGE_SIZE
  const modelId = typeof body.modelId === 'string' ? body.modelId.trim() : undefined
  const from = normalizeDayStart(typeof body.from === 'string' ? body.from.trim() : undefined)
  const to = normalizeDayEnd(typeof body.to === 'string' ? body.to.trim() : undefined)
  const format = body.format === 'csv' ? 'csv' : 'json'

  try {
    const data = await fetchRecordRoomPage(page, pageSize, {
      ...(viewer.isAdmin ? {} : { categories: viewer.visibleCategories }),
      modelId: modelId || undefined,
      from: from || undefined,
      to: to || undefined,
      deep: true,
    })

    if (format === 'csv') {
      return new NextResponse(recordRoomToCsv(data), {
        status: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': 'attachment; filename="league-archive.csv"',
        },
      })
    }

    return NextResponse.json({ ...data, charged: deduct.skipped ? 0 : cost, balance: deduct.balance })
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'failed to load deep archive' },
      { status: 500 }
    )
  }
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

function asPositiveInt(raw: unknown): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 1) return Math.floor(raw)
  if (typeof raw === 'string') {
    const n = Number.parseInt(raw, 10)
    return Number.isFinite(n) && n >= 1 ? n : null
  }
  return null
}
