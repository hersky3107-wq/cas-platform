/**
 * What a clarify chip click sends back. A sports fixture chip's id IS the
 * MATCH instrument — that click is the choice of the round, so it also
 * confirms the proposition and the gateway can return `ready` (then generate).
 * The single-team "네, 맞아요" chip stays a plain confirm and does not
 * consume another clarify round.
 */
import { decodeEntertainmentInstrument } from './adapters/entertainment-catalog'
import { decodePoliticsInstrument } from './adapters/politics-catalog'
import { decodePropertyInstrument } from './adapters/real-estate-catalog'
import { decodeSportsInstrument } from './adapters/sports-catalog'

export function nextClarifySubmission(
  answered: Record<string, string>,
  slot: string,
  optionId: string,
  clarifyRound: number,
): { answered: Record<string, string>; clarifyRound: number } {
  const fixturePick =
    slot === 'entity_id' &&
    (decodeSportsInstrument(optionId) !== null ||
      decodePoliticsInstrument(optionId) !== null ||
      decodeEntertainmentInstrument(optionId) !== null ||
      decodePropertyInstrument(optionId) !== null)
  const next = fixturePick
    ? { ...answered, [slot]: optionId, entity_confirmed: 'true' }
    : { ...answered, [slot]: optionId }
  const nextRound = slot === 'entity_confirmed' || fixturePick ? clarifyRound : clarifyRound + 1
  return { answered: next, clarifyRound: nextRound }
}
