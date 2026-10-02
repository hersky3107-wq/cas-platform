import { NextResponse } from 'next/server'
import {
  canReadKrUniverseApi,
  parseUniverseMarketParam,
  toKrUniverseClientRow,
} from '@/lib/league/korea-universe-api'
import { listVisibleUniverse } from '@/lib/league/korea-universe-store'
import { forbiddenResponse, resolveLeagueViewer } from '@/lib/league/public-access'

/**
 * GET /api/league/kr-universe?market=KOSPI|KOSDAQ|US
 *
 * Visible universe chips for the Korean lane (or admin). No flags, trading
 * values, or market caps — instrument identity only.
 */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const auth = await resolveLeagueViewer(req)
  if (!auth.ok) return auth.response
  if (!canReadKrUniverseApi(auth.viewer)) {
    return forbiddenResponse('jurisdiction_blocked')
  }

  const market = parseUniverseMarketParam(new URL(req.url).searchParams.get('market'))
  if (!market) {
    return NextResponse.json({ error: 'Unknown market', code: 'unknown_market' }, { status: 400 })
  }

  const rows = (await listVisibleUniverse(market))
    .map(toKrUniverseClientRow)
    .filter((row): row is NonNullable<typeof row> => row !== null)

  return NextResponse.json(
    { market, rows },
    { headers: { 'Cache-Control': 'private, max-age=300' } },
  )
}
