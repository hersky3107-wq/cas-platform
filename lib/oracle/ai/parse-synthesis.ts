import { extractJsonObject } from './parse-layer1'

export const SYNTHESIS_AGREEMENT_MAX = 160
export const SYNTHESIS_DIVERGENCE_MAX = 160
export const SYNTHESIS_CONCLUSION_MAX = 700
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
  if (!conclusion || [...conclusion].length > SYNTHESIS_CONCLUSION_MAX) return null

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
