import 'server-only'

import { NextResponse } from 'next/server'
import { isAdminEmail } from '@/lib/credits'
import { getIpCountryFromHeaders } from '@/lib/geo/ip-country'
import { resolveRouteAuth } from '@/lib/supabase/route-auth'
import { supabaseAdmin } from '@/lib/supabase/server'
import { checkRateLimit, type RateLimitRule } from '@/lib/rate-limit'
import { isCategoryAllowed, type JurisdictionInput } from './jurisdiction/resolve'
import {
  buildCatalogRankedRoundInput,
  CATALOG_INSTRUMENT_IDS,
  PUBLIC_CATALOG,
  type CatalogRankedRoundInput,
  type PublicCategoryDef,
} from './catalog'
import { gatePublicGenerateInstrument, isCuratedInstrument, visibleCategoriesFor } from './access-policy'
import { isUiHorizon, type UiHorizon } from './horizon'
import type { PredictionCategory } from '@/lib/prediction/categories'

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
export const CURATED_INSTRUMENTS: readonly string[] = CATALOG_INSTRUMENT_IDS

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

/** Jurisdiction-filtered public catalog (12 categories). Admin sees every chip. */
export function viewerCatalog(viewer: LeagueViewer): PublicCategoryDef[] {
  return PUBLIC_CATALOG.filter((c) => viewerCanSeeCategory(viewer, c.ledgerCategory))
}

/** Flattened curated instruments this viewer may reach (financial categories only). */
export function viewerInstruments(viewer: LeagueViewer) {
  return viewerCatalog(viewer).flatMap((c) =>
    c.instruments.map((i) => ({
      instrument: i.instrument,
      category: c.ledgerCategory,
      label: i.instrument,
    })),
  )
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

/**
 * Most recent RANKED round for a curated (instrument, horizon) pair — the
 * public entry point for "the current card for this horizon".
 *
 * MUST filter on horizon too: without it, opening a 1-week round for AAPL
 * would make `latestRankedRoundId('AAPL')` return the 1-week round even
 * while a caller asked for the 1-day card, silently swapping which round a
 * reader sees. `horizon` is one of the 4 canonical codes (`1d`/`1w`/`1m`/`3m`)
 * — the same value the UI shows and the row stores; there is no translation.
 */
export async function latestRankedRoundId(instrument: string, horizon: UiHorizon): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from('prediction_rounds')
    .select('id')
    .eq('instrument', instrument)
    .eq('horizon', horizon)
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
 * Resolves "the public card for this instrument at this horizon" for a
 * non-admin viewer: curated symbols only, and specifically the latest
 * RANKED round for that (instrument, horizon) pair rather than the latest
 * round of any kind — so an admin's on-demand test round, or a round opened
 * at a DIFFERENT horizon, can never become the public card for this one.
 *
 * `uiHorizon` defaults to `'1d'` so every existing caller (which predates
 * horizon selection) keeps reading exactly the round it always read.
 */
export async function resolvePublicInstrumentRound(
  viewer: LeagueViewer,
  instrumentRaw: string,
  uiHorizon: UiHorizon = '1d'
): Promise<RoundAccess> {
  const instrument = instrumentRaw.trim()
  if (!instrument) {
    return { ok: false, response: jsonError(400, 'Missing instrument', 'missing_target') }
  }
  if (!isUiHorizon(uiHorizon)) {
    return { ok: false, response: jsonError(400, 'Unknown horizon', 'unknown_horizon') }
  }
  if (!isCuratedInstrument(instrument, CURATED_INSTRUMENTS)) {
    // On-demand / arbitrary-instrument search is a later product piece — not open.
    return { ok: false, response: forbiddenResponse('not_public') }
  }
  const roundId = await latestRankedRoundId(instrument, uiHorizon)
  if (!roundId) {
    return { ok: false, response: jsonError(404, 'No ranked round available yet', 'no_round') }
  }
  return authorizeRoundForViewer(viewer, roundId)
}

export type PublicInstrumentGenerateTarget =
  | { ok: true; round: { roundId: string } }
  | { ok: true; round: CatalogRankedRoundInput }
  | { ok: false; response: NextResponse }

/**
 * Paid generate target for a curated instrument at ONE OF THE 4 SELECTABLE
 * HORIZONS (`horizonRaw`, default `'1d'`). The catalog + horizon +
 * jurisdiction gate runs first (no DB, no packet, no charge). Reuses the
 * currently-open round for that (instrument, horizon) when one exists;
 * otherwise opens a new one from catalog metadata (server-owned
 * proposition / rule / cache_key / resolves_at). A public caller still
 * cannot invent those fields — `horizon` only selects among the 4 fixed
 * codes, it does not set a duration.
 */
export async function resolvePublicInstrumentGenerateTarget(
  viewer: LeagueViewer,
  instrumentRaw: string,
  horizonRaw: unknown = '1d'
): Promise<PublicInstrumentGenerateTarget> {
  const gate = gatePublicGenerateInstrument(instrumentRaw, viewer, horizonRaw)
  if (!gate.ok) {
    if (gate.status === 400) {
      const message =
        gate.code === 'missing_target'
          ? 'Missing instrument'
          : gate.code === 'unknown_horizon'
            ? 'Unknown horizon'
            : 'Unknown instrument'
      return { ok: false, response: jsonError(400, message, gate.code) }
    }
    return { ok: false, response: forbiddenResponse('jurisdiction_blocked') }
  }

  const existing = await resolvePublicInstrumentRound(viewer, gate.instrument, gate.horizon)
  if (existing.ok) return { ok: true, round: { roundId: existing.roundId } }
  if (existing.response.status !== 404) return existing

  const created = buildCatalogRankedRoundInput(gate.instrument, gate.horizon)
  if (!created) {
    return { ok: false, response: jsonError(404, 'No ranked round available yet', 'no_round') }
  }
  return { ok: true, round: created }
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
