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

function boundedList(value: unknown, maxChars: number): string[] | null {
  if (!Array.isArray(value)) return null
  const strings = value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .slice(0, SYNTHESIS_LIST_MAX)
    .map((entry) => entry.slice(0, maxChars))
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
  const conclusion =
    typeof record.conclusion === 'string'
      ? record.conclusion.trim().slice(0, SYNTHESIS_CONCLUSION_MAX)
      : ''
  const confidenceNote =
    record.confidence_note === null
      ? null
      : typeof record.confidence_note === 'string'
        ? record.confidence_note.trim().slice(0, SYNTHESIS_CONFIDENCE_NOTE_MAX) || null
        : undefined
  if (!agreements || !divergences || !conclusion || confidenceNote === undefined) return null
  return {
    agreements,
    divergences,
    conclusion,
    confidence_note: confidenceNote,
  }
}
