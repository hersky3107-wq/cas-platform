import { extractJsonObject } from './parse-layer1'

export const SYNTHESIS_AGREEMENT_MAX = 160
export const SYNTHESIS_DIVERGENCE_MAX = 160
/**
 * FIX 3: conclusion budget 600–900 chars (was ≤700 with no floor — too thin
 * for the premium tier). The parser floor sits below the prompt minimum so a
 * slightly-short legit conclusion retries once instead of failing the unit.
 */
export const SYNTHESIS_CONCLUSION_MAX = 900
export const SYNTHESIS_CONCLUSION_MIN = 300
export const SYNTHESIS_CONFIDENCE_NOTE_MAX = 220
export const SYNTHESIS_LIST_MAX = 6

export type SynthesisJson = {
  agreements: string[]
  divergences: string[]
  conclusion: string
  confidence_note: string | null
}

/**
 * Hard budgets: over-limit fields fail the parse (adapter retries once).
 * Soft truncation is intentionally not used — same principle as LAYER1_NARRATIVE_MAX.
 */
function boundedList(value: unknown, maxChars: number): string[] | null {
  if (!Array.isArray(value)) return null
  if (value.length > SYNTHESIS_LIST_MAX) return null
  const strings: string[] = []
  for (const entry of value) {
    if (typeof entry !== 'string') return null
    const trimmed = entry.trim()
    if (!trimmed) continue
    if ([...trimmed].length > maxChars) return null
    strings.push(trimmed)
  }
  return strings
}

export function parseSynthesisJson(raw: string): SynthesisJson | null {
  const json = extractJsonObject(raw) ?? raw.trim()
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null
  const record = parsed as Record<string, unknown>
  const agreements = boundedList(record.agreements, SYNTHESIS_AGREEMENT_MAX)
  const divergences = boundedList(record.divergences, SYNTHESIS_DIVERGENCE_MAX)
  if (!agreements || !divergences) return null

  if (typeof record.conclusion !== 'string') return null
  const conclusion = record.conclusion.trim()
  if (!conclusion) return null
  const conclusionLength = [...conclusion].length
  if (conclusionLength > SYNTHESIS_CONCLUSION_MAX || conclusionLength < SYNTHESIS_CONCLUSION_MIN) return null

  let confidenceNote: string | null
  if (record.confidence_note === null) {
    confidenceNote = null
  } else if (typeof record.confidence_note === 'string') {
    const trimmed = record.confidence_note.trim()
    if (!trimmed) confidenceNote = null
    else if ([...trimmed].length > SYNTHESIS_CONFIDENCE_NOTE_MAX) return null
    else confidenceNote = trimmed
  } else {
    return null
  }

  return {
    agreements,
    divergences,
    conclusion,
    confidence_note: confidenceNote,
  }
}

/**
 * Reports when synthesis failed ONLY because the conclusion missed the length
 * band — the adapter retries naming the measured count (live 2026-09-05: GLM
 * wrote an otherwise-valid synthesis with a thin conclusion and the generic
 * strict retry did not move it).
 */
export function synthesisConclusionBandViolation(
  raw: string,
): { length: number; kind: 'short' | 'long' } | null {
  const json = extractJsonObject(raw) ?? raw.trim()
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null
  const conclusion = (parsed as Record<string, unknown>).conclusion
  if (typeof conclusion !== 'string' || !conclusion.trim()) return null
  const length = [...conclusion.trim()].length
  if (length < SYNTHESIS_CONCLUSION_MIN) return { length, kind: 'short' }
  if (length > SYNTHESIS_CONCLUSION_MAX) return { length, kind: 'long' }
  return null
}
