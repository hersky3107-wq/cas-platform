import { NextResponse } from 'next/server'
import { creditsForLeagueGenerate } from '@/lib/credits'
import { CardNotFoundError, fetchCardData, type CardLookup } from '@/lib/league/card'
import type { CardData, CardGenerationState, LockedCardPayload } from '@/lib/league/card-types'
import { gatePublicGenerateInstrument } from '@/lib/league/access-policy'
import { buildCatalogRankedRoundInput, findCatalogInstrument } from '@/lib/league/catalog'
import {
  findActiveJobForRound,
  hasPaidRoundAccess,
  isRoundComplete,
  latestWorkJobForRound,
  wasRefundedForRound,
} from '@/lib/league/generation/job-store'
import { getRoster } from '@/lib/league/roster'
import {
  authorizeRoundForViewer,
  forbiddenResponse,
  resolveLeagueViewer,
  resolvePublicInstrumentRound,
} from '@/lib/league/public-access'
import { isUiHorizon } from '@/lib/league/horizon'

/**
 * GET /api/league/card?round_id=<uuid>
 * GET /api/league/card?instrument=AAPL[&horizon=1d|1w|1m|3m][&date=YYYY-MM-DD]
 *
 * Read-only, and STILL RATE-LIMIT-FREE ON PURPOSE: this is the poll target
 * while a background generation job runs (every ~5s), and a stored card view
 * costs a couple of indexed selects. Never generates and never charges — the
 * paid press is `POST /api/league/generate`.
 *
 * PAID VIEW (2026-09-14): a non-admin viewer without a live purchase row for
 * the round gets a LOCKED payload — round identity + proposition + price,
 * nothing about models, consensus, grading, or whether content exists at
 * all. Payment is permanent per (round, user): once paid, this route serves
 * the full card forever, including after grading.
 *
 * While a job is queued/running (viewer has access), the full card carries a
 * `generation` block; the client polls and tiles fill as rows land. A
 * viewer's read still triggers grade-on-read inside `fetchCardData`, locked
 * or not, so grading stays read-driven for the leaderboard/record room.
 *
 * AUTH: any logged-in user. Non-admin: RANKED rounds on CURATED instruments
 * in an allowed jurisdiction (see lib/league/public-access.ts). Admin: any
 * existing round as a full card, no purchase needed (operator preview). A
 * missing catalog chip+horizon returns the SAME synthetic locked payload as a
 * public viewer so LockedRoundPanel can open the round; it does not change
 * which existing round is selected or when grade-on-read fires.
 */
export async function GET(req: Request) {
  const auth = await resolveLeagueViewer(req)
  if (!auth.ok) return auth.response
  const { viewer } = auth

  const { searchParams } = new URL(req.url)
  const roundId = searchParams.get('round_id')?.trim() || ''
  const instrument = searchParams.get('instrument')?.trim() || ''
  const horizonRaw = searchParams.get('horizon')?.trim() || '1d'

  let lookup: CardLookup | null = null
  let lockedPreview: LockedCardPayload | null = null

  if (viewer.isAdmin) {
    lookup = parseAdminLookup(searchParams)
  } else if (roundId) {
    const access = await authorizeRoundForViewer(viewer, roundId)
    if (!access.ok) return access.response
    lookup = { roundId: access.roundId }
  } else if (instrument) {
    if (!isUiHorizon(horizonRaw)) {
      return NextResponse.json({ error: 'Unknown horizon', code: 'unknown_horizon' }, { status: 400 })
    }
    const access = await resolvePublicInstrumentRound(viewer, instrument, horizonRaw)
    if (access.ok) {
      lookup = { roundId: access.roundId }
    } else if (access.response.status === 404) {
      // No round exists yet for this curated instrument+horizon. The viewer
      // must not learn that: serve the SAME locked shape they would get for
      // an existing unpaid round, with the proposition composed from the
      // same catalog metadata the generate press would use.
      const missing = catalogLockedPreview(instrument, horizonRaw, viewer)
      if ('response' in missing) return missing.response
      lockedPreview = missing.payload
    } else {
      return access.response
    }
  }

  if (lockedPreview) return NextResponse.json(lockedPreview)

  if (!lookup) {
    return NextResponse.json(
      { error: 'Provide either ?round_id=<uuid> or ?instrument=<SYMBOL>[&date=YYYY-MM-DD]' },
      { status: 400 }
    )
  }

  try {
    // Assembles the card AND triggers grade-on-read — deliberately before the
    // paywall branch so grading stays read-driven even for locked viewers.
    const card = await fetchCardData(
      lookup,
      viewer.isAdmin ? undefined : { categories: viewer.visibleCategories }
    )

    if (!viewer.isAdmin) {
      const paid = await hasPaidRoundAccess(card.round.round_id, viewer.userId)
      if (!paid) {
        const refundedNotice = await wasRefundedForRound(card.round.round_id, viewer.userId)
        const locked: LockedCardPayload = {
          locked: true,
          price: creditsForLeagueGenerate(),
          round: {
            round_id: card.round.round_id,
            instrument: card.round.instrument,
            horizon: card.round.horizon,
            category: card.round.category,
            color_bucket: card.round.color_bucket,
            proposition_text: card.round.proposition_text,
            resolves_at: card.round.resolves_at,
          },
          refundedNotice,
        }
        return NextResponse.json(locked)
      }
    }

    const generation = await generationStateFor(card)
    const payload: CardData = { ...card, generation }
    return NextResponse.json(payload)
  } catch (e: unknown) {
    if (e instanceof CardNotFoundError) {
      // Admin chip+horizon with no row used to 404 (empty "카드 없음"). Mirror
      // the public missing-round locked payload so LockedRoundPanel can open
      // it. round_id lookups and date-filtered lookups stay 404.
      if (viewer.isAdmin && lookup && !('roundId' in lookup) && !lookup.date && lookup.horizon) {
        const missing = catalogLockedPreview(lookup.instrument, lookup.horizon, viewer)
        if ('payload' in missing) return NextResponse.json(missing.payload)
        return missing.response
      }
      return NextResponse.json({ error: e.message }, { status: 404 })
    }
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'failed to load card' },
      { status: 500 }
    )
  }
}

/**
 * The card's `generation` block: an active job (queued/running), or the
 * latest FAILED work job while the round is still incomplete (so the client
 * can explain and offer the retry), else null.
 */
async function generationStateFor(card: CardData): Promise<CardGenerationState | null> {
  const roundId = card.round.round_id
  const rosterSize = getRoster().length
  const answered = card.models.length

  const active = await findActiveJobForRound(roundId)
  if (active) {
    return {
      status: active.status === 'queued' ? 'queued' : 'running',
      stage: active.stage,
      rosterSize,
      answered,
      refunded: false,
    }
  }

  const complete = await isRoundComplete(roundId)
  if (complete) return null

  const latest = await latestWorkJobForRound(roundId)
  if (latest && latest.status === 'failed') {
    return {
      status: 'failed',
      stage: latest.stage,
      rosterSize,
      answered,
      refunded: latest.refunded,
    }
  }
  return null
}

/**
 * Synthetic locked card for a catalog chip+horizon that has no round row yet.
 * Shared by public 404s and admin instrument+horizon misses so LockedRoundPanel
 * can POST /api/league/generate. Does not invent a round id.
 */
function catalogLockedPreview(
  instrument: string,
  horizonRaw: string,
  viewer: { isAdmin: boolean; jurisdiction: Parameters<typeof gatePublicGenerateInstrument>[1]['jurisdiction'] }
): { payload: LockedCardPayload } | { response: NextResponse } {
  const gate = gatePublicGenerateInstrument(instrument, viewer, horizonRaw)
  if (!gate.ok) {
    return {
      response:
        gate.status === 403
          ? forbiddenResponse('jurisdiction_blocked')
          : NextResponse.json({ error: 'Unknown instrument', code: gate.code }, { status: 400 }),
    }
  }
  const wouldOpen = buildCatalogRankedRoundInput(gate.instrument, gate.horizon)
  if (!wouldOpen) {
    return {
      response: NextResponse.json({ error: 'No ranked round available yet', code: 'no_round' }, { status: 404 }),
    }
  }
  const catalogTone = findCatalogInstrument(gate.instrument)?.category.tone ?? 'yellow'
  return {
    payload: {
      locked: true,
      price: creditsForLeagueGenerate(),
      round: {
        round_id: null,
        instrument: wouldOpen.instrument,
        horizon: wouldOpen.horizon,
        category: wouldOpen.category,
        color_bucket: catalogTone,
        proposition_text: wouldOpen.proposition_text,
        resolves_at: wouldOpen.resolves_at,
      },
      refundedNotice: false,
    },
  }
}

function parseAdminLookup(searchParams: URLSearchParams): CardLookup | null {
  const roundId = searchParams.get('round_id')?.trim()
  if (roundId) return { roundId }

  const instrument = searchParams.get('instrument')?.trim()
  if (instrument) {
    const date = searchParams.get('date')?.trim()
    const horizon = searchParams.get('horizon')?.trim()
    return { instrument, ...(date ? { date } : {}), ...(horizon ? { horizon } : {}) }
  }

  return null
}
