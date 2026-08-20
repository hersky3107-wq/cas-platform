/**
 * Tarot projector.
 *
 * Traits   — derived, from the drawn cards' Major Arcana archetypes and
 *            the minor-arcana suit balance. Reversed cards reflect their
 *            mix (see `math.ts` `reflectTraitMix`) rather than looking up
 *            a second, separate "reversed" table.
 * Elements — derived, suit → classical 4-element → 오행, reusing the SAME
 *            `CLASSICAL_TO_OHENG` table `astro.ts` uses. Majors have no
 *            suit and are simply skipped, not forced to zero.
 * Phase    — direct, from each card's own forward/hold/ending character.
 */
import { DRAW_ENGINE_VERSION, tarotDraw } from '../../engines/draw'
import type { TarotDrawnCard, TarotDrawResult, TarotSpreadSize } from '../../engines/draw'
import { DIRECT_WEIGHT, HALF_WEIGHT } from '../conventions'
import { clampTraits, emptyElements, emptyPhase, emptyTraits, normalizeElements, normalizePhase, reflectTraitMix } from '../math'
import {
  CLASSICAL_TO_OHENG,
  TAROT_MAJOR_PHASE,
  TAROT_MAJOR_TRAITS,
  TAROT_MINOR_RANK_PHASE,
  TAROT_SUIT_CLASSICAL,
  TAROT_SUIT_TRAITS,
} from '../tables'
import { TRAIT_AXES, type AxisVote, type ElementAxis, type PhaseAxis, type TraitVector } from '../types'

export type TarotProjectorInput = {
  seed: string
  spread: TarotSpreadSize
  /** 1-based positions the user picked from the fanned/shuffled deck. */
  pickedPositions: number[]
}

function cardTraitMix(card: TarotDrawnCard): TraitVector {
  const mix = card.arcana === 'major' ? TAROT_MAJOR_TRAITS[card.name] : TAROT_SUIT_TRAITS[card.suit!]
  if (!mix) throw new Error(`axes/tarot: no trait mix for "${card.name}"`)
  return card.reversed ? reflectTraitMix(mix) : mix
}

function cardPhase(card: TarotDrawnCard): PhaseAxis {
  const phase = card.arcana === 'major' ? TAROT_MAJOR_PHASE[card.name] : TAROT_MINOR_RANK_PHASE[card.number]
  if (!phase) throw new Error(`axes/tarot: no phase for "${card.name}"`)
  return phase
}

function traitsFromCards(cards: readonly TarotDrawnCard[]): TraitVector {
  const raw = emptyTraits()
  for (const card of cards) {
    const mix = cardTraitMix(card)
    for (const axis of TRAIT_AXES) raw[axis] += (mix[axis] * 100) / cards.length
  }
  return clampTraits(raw)
}

function elementsFromCards(cards: readonly TarotDrawnCard[]) {
  const raw = emptyElements()
  let any = false
  for (const card of cards) {
    if (card.suit === null) continue
    const classical = TAROT_SUIT_CLASSICAL[card.suit]
    const mapped = CLASSICAL_TO_OHENG[classical]
    any = true
    for (const [oheng, share] of Object.entries(mapped)) {
      raw[oheng as ElementAxis] += share ?? 0
    }
  }
  return any ? normalizeElements(raw) : null
}

function phaseFromCards(cards: readonly TarotDrawnCard[]) {
  const raw = emptyPhase()
  for (const card of cards) raw[cardPhase(card)] += 100 / cards.length
  return normalizePhase(raw)
}

export function projectTarot(input: TarotProjectorInput): AxisVote {
  const draw: TarotDrawResult = tarotDraw({
    seed: input.seed,
    spread: input.spread,
    pickedPositions: input.pickedPositions,
  })

  const traits = traitsFromCards(draw.cards)
  const elements = elementsFromCards(draw.cards)
  const phase = phaseFromCards(draw.cards)
  const reversedCount = draw.cards.filter((card) => card.reversed).length

  const unreadable: AxisVote['unreadable'] = []
  if (!elements) unreadable.push({ space: 'elements', code: 'tarot.no_minor_cards' })

  return {
    system: 'tarot',
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
      traits:
        reversedCount > 0
          ? ['tarot.traits.arcana_and_suit', 'tarot.traits.reversals_reflected']
          : ['tarot.traits.arcana_and_suit'],
      elements: elements ? ['tarot.elements.suit_to_classical_to_oheng'] : undefined,
      phase: ['tarot.phase.card_character'],
    },
    engineVersion: DRAW_ENGINE_VERSION,
  }
}
