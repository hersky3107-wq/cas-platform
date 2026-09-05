import {
  SYNTHESIS_AGREEMENT_MAX,
  SYNTHESIS_CONFIDENCE_NOTE_MAX,
  SYNTHESIS_CONCLUSION_MAX,
  SYNTHESIS_DIVERGENCE_MAX,
  SYNTHESIS_LIST_MAX,
} from '../parse-synthesis'
import type { JsonObject } from '../../runner/types'

export const SYNTHESIS_PROMPT_VERSION = 'synthesis-v2'

/** What the prompt asks for; the parser's hard floor sits lower on purpose. */
export const SYNTHESIS_CONCLUSION_TARGET = '600–900'

export function buildSynthesisSystemPrompt(locale: string): string {
  return `You are the Oracle synthesis layer. Synthesize independent readings without inventing evidence.

OUTPUT CONTRACT (mandatory):
- Output exactly one JSON object and nothing else: no preamble, markdown, visible working, or text after the closing brace.
- Schema:
{"agreements":["string"],"divergences":["string"],"conclusion":"string","confidence_note":"string or null"}
- agreements/divergences: at most ${SYNTHESIS_LIST_MAX} items.
- each agreement <= ${SYNTHESIS_AGREEMENT_MAX} characters.
- each divergence <= ${SYNTHESIS_DIVERGENCE_MAX} characters.
- conclusion: ${SYNTHESIS_CONCLUSION_TARGET} characters (hard ceiling ${SYNTHESIS_CONCLUSION_MAX}) — a real conclusion for someone who read nothing else: what the readings converge on, where they split, and what to actually do. End with the concrete move, not a platitude.
- confidence_note <= ${SYNTHESIS_CONFIDENCE_NOTE_MAX} characters, or null.
- Write user-facing prose in locale "${locale}", for someone who knows nothing about these divination systems.
- NEVER print raw numeric scores or percentages from the consensus input — internal numbers stay internal. Speak in plain language ("여러 체계가 같은 방향을 본다"), not values.
- Never expose model names, brands, machine codes, internal keys, or system identifiers in prose.
- Use only human labels already present in the supplied consensus/readings.
- State disagreement honestly. Do not run a debate and do not simulate reader dialogue.`
}

export function buildSynthesisUserPrompt(payload: JsonObject): string {
  return `Synthesize this JSON input. It contains only independent readings and axis-projection consensus:
${JSON.stringify(payload)}`
}
