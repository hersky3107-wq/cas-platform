/**
 * Rune (Elder Futhark) projector.
 *
 * Traits   — derived, from each drawn rune's own character. Reversal is
 *            NOT applied to traits — the task's reversal instruction for
 *            runes covers phase only, so a second traits table would be
 *            an unrequested judgement call.
 * Elements — derived, from a rune → 五行 table covering only the runes
 *            with a fairly agreed element association; a rune with no
 *            agreed element is left out of the blend, not guessed.
 * Phase    — direct, from each rune's own directional meaning;
 *            merkstave/reversed flips advance↔release.
 */
import { DRAW_ENGINE_VERSION, runeDraw } from '../../engines/draw'
import type { RuneDrawn } from '../../engines/draw'
import { DIRECT_WEIGHT, HALF_WEIGHT } from '../conventions'
import { clampTraits, emptyElements, emptyPhase, emptyTraits, normalizeElements, normalizePhase } from '../math'
import { RUNE_ELEMENT, RUNE_PHASE, RUNE_TRAITS } from '../tables'
import { TRAIT_AXES, type AxisVote, type PhaseAxis, type TraitVector } from '../types'

export type RuneProjectorInput = {
  seed: string
  count: number
}

/** `hold` has no opposite among the three phase axes, so it is unaffected. */
function flip(axis: PhaseAxis): PhaseAxis {
  if (axis === 'advance') return 'release'
  if (axis === 'release') return 'advance'
  return 'hold'
}

function traitsFromRunes(runes: readonly RuneDrawn[]): TraitVector {
  const raw = emptyTraits()
  for (const rune of runes) {
    const mix = RUNE_TRAITS[rune.name]
    if (!mix) throw new Error(`axes/rune: no trait mix for "${rune.name}"`)
    for (const axis of TRAIT_AXES) raw[axis] += (mix[axis] * 100) / runes.length
  }
  return clampTraits(raw)
}

function elementsFromRunes(runes: readonly RuneDrawn[]) {
  const raw = emptyElements()
  let any = false
  for (const rune of runes) {
    const element = RUNE_ELEMENT[rune.name]
    if (!element) continue
    any = true
    raw[element] += 1
  }
  return any ? normalizeElements(raw) : null
}

function phaseFromRunes(runes: readonly RuneDrawn[]) {
  const raw = emptyPhase()
  for (const rune of runes) {
    const base = RUNE_PHASE[rune.name]
    if (!base) throw new Error(`axes/rune: no phase for "${rune.name}"`)
    const axis = rune.reversed || rune.merkstave ? flip(base) : base
    raw[axis] += 100 / runes.length
  }
  return normalizePhase(raw)
}

export function projectRune(input: RuneProjectorInput): AxisVote {
  const draw = runeDraw({ seed: input.seed, count: input.count })

  const traits = traitsFromRunes(draw.runes)
  const elements = elementsFromRunes(draw.runes)
  const phase = phaseFromRunes(draw.runes)

  const unreadable: AxisVote['unreadable'] = []
  if (!elements) unreadable.push({ space: 'elements', code: 'rune.no_element_consensus' })

  return {
    system: 'runes',
    traits,
    elements,
    phase,
    confidence: {
      traits: { weight: HALF_WEIGHT, basis: 'derived' },
      elements: elements ? { weight: HALF_WEIGHT, basis: 'derived' } : null,
      phase: phase ? { weight: DIRECT_WEIGHT, basis: 'direct' } : null,
    },
    unreadable,
    reasons: {
      traits: ['rune.traits.stave_character'],
      elements: elements ? ['rune.elements.agreed_associations_only'] : undefined,
      phase: ['rune.phase.direction_with_merkstave_flip'],
    },
    engineVersion: DRAW_ENGINE_VERSION,
  }
}
