/**
 * 육효 (I Ching, six-line coin divination) projector.
 *
 * Traits   — UNREADABLE. 육효 answers a question about a situation, not
 *            a person's disposition; there is no trait signal to read.
 * Elements — direct, from the 납갑 five-element assignment the draw
 *            engine already computes per line (`IchingLine.element`),
 *            weighting the 세효 (shi) line more heavily than the rest.
 * Phase    — direct, from the changing lines. No changing lines → hold.
 *            Otherwise, each changing line's own 육친 — already computed
 *            by the engine relative to the palace element — is remapped
 *            onto the SAME five-element relation → phase table nine-star
 *            uses (`FIVE_ELEMENT_RELATION_PHASE`), since 육친 and that
 *            relation are the same 5-way classification under different
 *            names (see `SIX_RELATIVE_TO_RELATION`).
 */
import { DRAW_ENGINE_VERSION, ichingDraw } from '../../engines/draw'
import type { DayStemInput, IchingDrawResult } from '../../engines/draw'
import { DIRECT_WEIGHT } from '../conventions'
import { emptyElements, emptyPhase, normalizeElements, normalizePhase } from '../math'
import { FIVE_ELEMENT_RELATION_PHASE, SIX_RELATIVE_TO_RELATION } from '../tables'
import type { AxisVote } from '../types'

export type IchingProjectorInput = {
  seed: string
  /** Only affects `beast` (six-guardian) assignment, unused here. Optional. */
  dayStem?: DayStemInput
}

/** 세효 counts double an ordinary line — "weight the 세효 more heavily." */
const SHI_WEIGHT = 2
const OTHER_WEIGHT = 1

function elementsFromLines(result: IchingDrawResult) {
  const raw = emptyElements()
  for (const line of result.lines) {
    raw[line.element] += line.position === result.shi ? SHI_WEIGHT : OTHER_WEIGHT
  }
  return normalizeElements(raw)
}

function phaseFromChangingLines(result: IchingDrawResult) {
  if (result.changingPositions.length === 0) {
    return normalizePhase({ advance: 0, hold: 100, release: 0 })
  }
  const changing = result.lines.filter((line) => line.changing)
  const raw = emptyPhase()
  for (const line of changing) {
    const relation = SIX_RELATIVE_TO_RELATION[line.relative]
    raw[FIVE_ELEMENT_RELATION_PHASE[relation]] += 100 / changing.length
  }
  return normalizePhase(raw)
}

export function projectIching(input: IchingProjectorInput): AxisVote {
  const result = ichingDraw({ seed: input.seed, dayStem: input.dayStem })

  const elements = elementsFromLines(result)
  const phase = phaseFromChangingLines(result)
  const hasChangingLines = result.changingPositions.length > 0

  const unreadable: AxisVote['unreadable'] = [{ space: 'traits', code: 'iching.no_trait_reading' }]
  if (!elements) unreadable.push({ space: 'elements', code: 'iching.no_element_reading' })

  return {
    system: 'iching',
    traits: null,
    elements,
    phase,
    confidence: {
      traits: null,
      elements: elements ? { weight: DIRECT_WEIGHT, basis: 'direct' } : null,
      phase: phase ? { weight: DIRECT_WEIGHT, basis: 'direct' } : null,
    },
    unreadable,
    reasons: {
      elements: elements ? ['iching.elements.najia_shi_weighted'] : undefined,
      phase: [hasChangingLines ? 'iching.phase.changing_lines_relation' : 'iching.phase.no_changing_lines'],
    },
    engineVersion: DRAW_ENGINE_VERSION,
  }
}
