import 'server-only'

import { NextResponse } from 'next/server'
import { isAdminEmail } from '@/lib/credits'
import { getIpCountryFromHeaders } from '@/lib/geo/ip-country'
import { resolveRouteAuth } from '@/lib/supabase/route-auth'
import { supabaseAdmin } from '@/lib/supabase/server'
import { checkRateLimit, type RateLimitRule } from '@/lib/rate-limit'
import { isCategoryAllowed, type JurisdictionInput } from './jurisdiction/resolve'
import { DAILY_FIXED_INSTRUMENTS } from './instruments'
import { isCuratedInstrument, visibleCategoriesFor } from './access-policy'
import type { PredictionCategory } from '@/lib/prediction/reconciliation'

/**
 * AI Prediction League — PUBLIC PATH ENFORCEMENT (server-side).
 *
 * Every user-facing league route goes through this module. It is the single
 * place that answers, for one HTTP request:
 *   "who is this, are they admin, what jurisdiction are they in, and are they
 *    allowed to touch this round / this category at all?"
 *
 * WHY IT LIVES SERVER-SIDE AND ALONE: the UI already gates with the same pure
 * functions (`JurisdictionGate` -> `useJurisdiction` -> `isCategoryAllowed`),
 * but UI gating is decoration — a caller with a session token can `curl` any
 * route directly. The decisions here are the real ones, and they are shared by
 * every route so a new league endpoint cannot accidentally ship with a weaker
 * rule than its siblings.
 *
 * ADMIN VS PUBLIC — the two deliberate asymmetries, both documented at their
 * call sites too:
 *  - Admin SKIPS jurisdiction gating and the curated-instrument restriction,
 *    because admin is the operator account that has to be able to preview any
 *    category/instrument from wherever they happen to be sitting.
 *  - Admin SKIPS credit charges (pre-existing `deductCreditsBalance` behavior,
 *    untouched here).
 *  - Admin does NOT skip rate limiting. The burst guard is not a permission,
 *    it protects provider spend from runaway retry loops, and admin's own
 *    preview UI is one of the things that could loop.
 */

export type LeagueViewer = {
  userId: string
  email: string | null
  /** Operator account. Bypasses jurisdiction + curated-set limits (and, via credits-server, charges). */
  isAdmin: boolean
  /** Raw signals, kept together so every check uses the same pair. */
  jurisdiction: JurisdictionInput
  /** Categories readable by this viewer. Empty for a viewer with no resolvable jurisdiction (default-deny). */
  visibleCategories: PredictionCategory[]
}

export type ViewerResult = { ok: true; viewer: LeagueViewer } | { ok: false; response: NextResponse }

/** Curated ranked instrument strings — the only instruments a public user may reach. */
export const CURATED_INSTRUMENTS: readonly string[] = DAILY_FIXED_INSTRUMENTS.map((i) => i.instrument)

function jsonError(status: number, error: string, code: string, extra?: Record<string, unknown>): NextResponse {
  return NextResponse.json({ error, code, ...extra }, { status })
}

export function unauthorizedResponse(): NextResponse {
  return jsonError(401, 'Invalid session', 'unauthenticated')
}

/**
 * 403 for "your jurisdiction does not allow this". Deliberately the same shape
 * and status whether the category is denied, the round is not ranked, or the
 * instrument is not curated: a public caller learns "no", not which internal
 * rule said no.
 */
export function forbiddenResponse(code: 'jurisdiction_blocked' | 'not_public' = 'jurisdiction_blocked'): NextResponse {
  return jsonError(403, 'Not available for your account or region', code)
}

export function rateLimitedResponse(retryAfterMs: number): NextResponse {
  const retryAfterSec = Math.max(1, Math.ceil(retryAfterMs / 1000))
  return NextResponse.json(
    { error: 'Too many requests. Please wait a moment.', code: 'rate_limited', retryAfterSec },
    { status: 429, headers: { 'Retry-After': String(retryAfterSec) } }
  )
}

/**
 * Resolves the logged-in caller plus their jurisdiction signals, or a ready-to-
 * return 401. `body` is passed through to `resolveRouteAuth` so POST routes
 * keep the existing `{ supabaseAccessToken }` fallback that the rest of the app
 * relies on (cookies first, then Bearer, then body token).
 */
export async function resolveLeagueViewer(req: Request, body?: Record<string, unknown>): Promise<ViewerResult> {
  const { user, error } = await resolveRouteAuth(req, body)
  if (error || !user?.id) {
    return { ok: false, response: unauthorizedResponse() }
  }

  const email = user.email ?? null
  const isAdmin = isAdminEmail(email)
  const jurisdiction = await resolveViewerJurisdiction(req, user.id)

  return {
    ok: true,
    viewer: {
      userId: user.id,
      email,
      isAdmin,
      jurisdiction,
      visibleCategories: visibleCategoriesFor(jurisdiction),
    },
  }
}

/**
 * declared_country (account) + IP country (platform header) — the exact pair
 * `isCategoryAllowed` expects, read the same way `GET /api/league/context`
 * reads them so the UI and this enforcement path can never diverge on inputs.
 */
async function resolveViewerJurisdiction(req: Request, userId: string): Promise<JurisdictionInput> {
  let ipCountry = getIpCountryFromHeaders(req.headers)
  let declaredCountry: string | null = null

  // DEV-ONLY escape hatch, mirroring `GET /api/league/context`: local dev has no
  // `x-vercel-ip-country` (a Vercel-platform header), so without this there is
  // no way to exercise a real jurisdiction other than "no signal -> deny all".
  // Never active in production.
  if (process.env.NODE_ENV !== 'production') {
    const params = new URL(req.url).searchParams
    const devIp = params.get('dev_ip_country')
    const devDeclared = params.get('dev_declared_country')
    if (devIp) ipCountry = devIp.toUpperCase()
    if (devDeclared) declaredCountry = devDeclared.toUpperCase()
  }

  if (!declaredCountry) {
    // Guarded like the context route: `declared_country` arrived in a later
    // migration, and an environment without it must fall back to "no declared
    // signal" rather than failing the whole request open OR hard-erroring.
    const { data, error } = await supabaseAdmin
      .from('users')
      .select('declared_country')
      .eq('id', userId)
      .maybeSingle()
    if (!error) {
      declaredCountry = (data?.declared_country as string | null | undefined) ?? null
    }
  }

  return { declaredCountry, ipCountry }
}

/** Single-category check. Admin bypasses (operator preview); everyone else is default-deny gated. */
export function viewerCanSeeCategory(viewer: LeagueViewer, category: string): boolean {
  if (viewer.isAdmin) return true
  return isCategoryAllowed(category, viewer.jurisdiction)
}

/** Curated ranked instruments this viewer may reach, jurisdiction-filtered. */
export function viewerInstruments(viewer: LeagueViewer) {
  return DAILY_FIXED_INSTRUMENTS.filter((i) => viewerCanSeeCategory(viewer, i.category))
}

export type RoundGuardRow = {
  id: string
  instrument: string
  category: string
  item_type: string | null
}

/**
 * Loads the minimal round facts needed to authorize a read/generate, WITHOUT
 * going through the card render path — `lib/league/card.ts` stays untouched, so
 * opening this path cannot change what a card looks like.
 */
async function loadRoundGuard(roundId: string): Promise<RoundGuardRow | null> {
  const { data, error } = await supabaseAdmin
    .from('prediction_rounds')
    .select('id, instrument, category, item_type')
    .eq('id', roundId)
    .maybeSingle()
  if (error || !data) return null
  return data as RoundGuardRow
}

/** Most recent RANKED round for a curated instrument — the public entry point for "today's card". */
export async function latestRankedRoundId(instrument: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from('prediction_rounds')
    .select('id')
    .eq('instrument', instrument)
    .eq('item_type', 'ranked')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error || !data) return null
  return (data as { id: string }).id
}

export type RoundAccess =
  | { ok: true; roundId: string; category: string; instrument: string }
  | { ok: false; response: NextResponse }

/**
 * THE authorization for one round id, used by both the free card read and the
 * paid live generation. For a non-admin viewer all three rules apply together:
 * the round must be RANKED, its instrument must be CURATED, and its category
 * must be allowed in their jurisdiction.
 */
export async function authorizeRoundForViewer(viewer: LeagueViewer, roundIdRaw: string): Promise<RoundAccess> {
  const roundId = roundIdRaw.trim()
  if (!roundId) {
    return { ok: false, response: jsonError(400, 'Missing round id', 'missing_target') }
  }

  const round = await loadRoundGuard(roundId)
  if (!round) {
    return { ok: false, response: jsonError(404, 'Round not found', 'no_round') }
  }

  if (!viewer.isAdmin) {
    if (round.item_type !== 'ranked' || !isCuratedInstrument(round.instrument, CURATED_INSTRUMENTS)) {
      return { ok: false, response: forbiddenResponse('not_public') }
    }
    if (!isCategoryAllowed(round.category, viewer.jurisdiction)) {
      return { ok: false, response: forbiddenResponse('jurisdiction_blocked') }
    }
  }

  return { ok: true, roundId: round.id, category: round.category, instrument: round.instrument }
}

/**
 * Resolves "the public card for this instrument" for a non-admin viewer:
 * curated symbols only, and specifically the latest RANKED round rather than
 * the latest round of any kind — so an admin's on-demand test round on the
 * same symbol can never become the public card.
 */
export async function resolvePublicInstrumentRound(viewer: LeagueViewer, instrumentRaw: string): Promise<RoundAccess> {
  const instrument = instrumentRaw.trim()
  if (!instrument) {
    return { ok: false, response: jsonError(400, 'Missing instrument', 'missing_target') }
  }
  if (!isCuratedInstrument(instrument, CURATED_INSTRUMENTS)) {
    // On-demand / arbitrary-instrument search is a later product piece — not open.
    return { ok: false, response: forbiddenResponse('not_public') }
  }
  const roundId = await latestRankedRoundId(instrument)
  if (!roundId) {
    return { ok: false, response: jsonError(404, 'No ranked round available yet', 'no_round') }
  }
  return authorizeRoundForViewer(viewer, roundId)
}

/**
 * Per-user burst guard for a paid endpoint. Runs BEFORE any credit deduction
 * and before any compute, so a throttled caller is never charged.
 */
export function enforceRateLimit(viewer: LeagueViewer, bucket: string, rule: RateLimitRule): NextResponse | null {
  const result = checkRateLimit(`${bucket}:${viewer.userId}`, rule)
  if (result.ok) return null
  return rateLimitedResponse(result.retryAfterMs)
}
