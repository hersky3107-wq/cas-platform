/**
 * CrisisWatch paid-compute credit constants.
 *
 * THE single place CrisisWatch credit amounts live. Named constants only —
 * never inline these at a call site. The free map (`GET /api/crisis/map`)
 * must not use either number.
 *
 * PLACEHOLDER VALUES — set these before launch. Cache hits charge the same
 * amount as a first-viewer unlock (everyone pays the same credits).
 */

/** Unlock one published briefing card (`POST /api/crisis/briefing`). */
export const CRISIS_BRIEF_CREDITS = 8

/** Deep analysis of one region (`POST /api/crisis/deep`), including a <24h cache hit. */
export const CRISIS_DEEP_CREDITS = 25

/** One zone run (`POST /api/crisis/zone`), including a <24h cache hit. PLACEHOLDER. */
export const CRISIS_ZONE_CREDITS = 60

/** All 15 zones (`POST /api/crisis/zone` scope global), including cache hits. PLACEHOLDER. */
export const CRISIS_GLOBAL_CREDITS = 600

export const CRISIS_BRIEF_MODULE = 'crisis_brief'
export const CRISIS_DEEP_MODULE = 'crisis_deep'
export const CRISIS_ZONE_MODULE = 'crisis_zone'
export const CRISIS_GLOBAL_MODULE = 'crisis_global'

export function creditsForCrisisBrief(): number {
  return CRISIS_BRIEF_CREDITS
}

export function creditsForCrisisDeep(): number {
  return CRISIS_DEEP_CREDITS
}

/** Same as CRISIS_DEEP_CREDITS — first viewer and cache viewers pay the same. */
export function creditsForCrisisDeepCache(): number {
  return CRISIS_DEEP_CREDITS
}

export function creditsForCrisisZone(): number {
  return CRISIS_ZONE_CREDITS
}

export function creditsForCrisisGlobal(): number {
  return CRISIS_GLOBAL_CREDITS
}
