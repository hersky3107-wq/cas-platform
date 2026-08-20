/**
 * Maya tzolkin (20 nawales × 13 tones) projector. `system: 'tzolkin'` —
 * that is this contract's SystemId for the Maya sacred calendar.
 *
 * Traits   — derived, from the natal nawal's character (birth date).
 * Elements — unreadable, always. Maya cosmology's four-direction /
 *            colour scheme does not map onto 五行 — forcing one would be
 *            exactly the fabrication the contract forbids.
 * Phase    — direct, from the CURRENT date's tone (the moving position
 *            in the 13-tone building/holding/releasing arc), mirroring
 *            how every other projector reads phase from "now" rather
 *            than from birth.
 *
 * Pure calendar-date system: no birth time, no timezone, no unknown-time
 * degradation path exists here.
 */
import { CALENDAR_ENGINE_VERSION, tzolkin } from '../../engines/calendar'
import { DIRECT_WEIGHT, HALF_WEIGHT } from '../conventions'
import { clampTraits, emptyPhase, emptyTraits, normalizePhase } from '../math'
import { MAYA_NAWAL_TRAITS, MAYA_TONE_PHASE } from '../tables'
import { TRAIT_AXES, type AxisVote } from '../types'

export type MayaProjectorInput = {
  birthDate: string
  atDate: string
}

function reasonSafe(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '')
}

export function projectMaya(input: MayaProjectorInput): AxisVote {
  const natal = tzolkin({ date: input.birthDate })
  const current = tzolkin({ date: input.atDate })

  const mix = MAYA_NAWAL_TRAITS[natal.nawalName]!
  const rawTraits = emptyTraits()
  for (const axis of TRAIT_AXES) rawTraits[axis] = mix[axis] * 100
  const traits = clampTraits(rawTraits)

  const rawPhase = emptyPhase()
  rawPhase[MAYA_TONE_PHASE[current.tone]!] = 100
  const phase = normalizePhase(rawPhase)

  return {
    system: 'tzolkin',
    traits,
    elements: null,
    phase,
    confidence: {
      traits: { weight: HALF_WEIGHT, basis: 'derived' },
      elements: null,
      phase: phase ? { weight: DIRECT_WEIGHT, basis: 'direct' } : null,
    },
    unreadable: [{ space: 'elements', code: 'maya.no_wuxing_mapping' }],
    reasons: {
      traits: [`maya.traits.nawal_${reasonSafe(natal.nawalName)}`],
      phase: [`maya.phase.tone_${current.tone}`],
    },
    engineVersion: CALENDAR_ENGINE_VERSION,
  }
}
