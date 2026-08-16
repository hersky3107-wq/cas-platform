import { NextResponse } from 'next/server'
import { resolveLeagueViewer, viewerInstruments } from '@/lib/league/public-access'

/**
 * GET /api/league/instruments
 *
 * The curated ranked instrument set this caller may browse, filtered by their
 * resolved jurisdiction. Free, read-only, no DB access at all — it is a
 * projection of the static `DAILY_FIXED_INSTRUMENTS` config.
 *
 * WHY IT EXISTS: the public hub needs to know what to offer, and that list is
 * a server-side decision. `lib/league/instruments.ts` is `server-only`, and
 * shipping the full instrument config to the client would also mean shipping
 * entries the caller's jurisdiction forbids. A caller whose jurisdiction
 * allows nothing gets `[]` — the hub renders its empty state, and the card /
 * generate endpoints independently refuse those instruments anyway.
 *
 * This is NOT instrument search: it returns the fixed curated set and nothing
 * else. Arbitrary-instrument (on-demand) requests remain admin-only.
 */
export async function GET(req: Request) {
  const auth = await resolveLeagueViewer(req)
  if (!auth.ok) return auth.response

  const instruments = viewerInstruments(auth.viewer).map((i) => ({
    instrument: i.instrument,
    label: i.label,
    category: i.category,
    horizon: i.horizon,
  }))

  return NextResponse.json({ instruments })
}
