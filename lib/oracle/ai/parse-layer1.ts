/**
 * Defensive parser for the layer-1 JSON contract.
 *
 * Accepts clean JSON, fenced JSON, and JSON after a preamble.
 * Returns null on garbage so the caller can retry once, then 결번.
 */
export const LAYER1_DIRECTIONS = ['advance', 'hold', 'release'] as const
export type Layer1Direction = (typeof LAYER1_DIRECTIONS)[number]

export const LAYER1_FOCUSES = ['work', 'money', 'love', 'social', 'energy'] as const
export type Layer1Focus = (typeof LAYER1_FOCUSES)[number]

export const LAYER1_ONE_LINE_MAX = 80
/**
 * v4 budget (FIX 3): a 25-credit reading at 500 chars was too short and too
 * jargon-heavy. Prompt demands 700–1100; the parser enforces a hard ceiling
 * at 1100 and a hard floor at 400 — the floor sits below the prompt minimum
 * on purpose, so a slightly-short legit reading retries once (strict) instead
 * of becoming a 결번 on the spot.
 */
export const LAYER1_NARRATIVE_MAX = 1100
export const LAYER1_NARRATIVE_MIN = 400
/** What the prompt asks for (min–max prose band shown to the model). */
export const LAYER1_NARRATIVE_TARGET = '700–1100'

export type Layer1Json = {
  narrative: string
  one_line: string
  direction: Layer1Direction
  focus: Layer1Focus
  axis_emphasis: string[]
}

function stripFences(raw: string): string {
  const trimmed = raw.trim()
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  if (fenced?.[1]) return fenced[1].trim()
  return trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
}

/** Walk from the first `{` so a preamble does not break parse. */
export function extractJsonObject(text: string): string | null {
  const start = text.indexOf('{')
  if (start < 0) return null
  let depth = 0
  let inString = false
  let escape = false
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (inString) {
      if (escape) escape = false
      else if (ch === '\\') escape = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') inString = true
    else if (ch === '{') depth += 1
    else if (ch === '}') {
      depth -= 1
      if (depth === 0) return text.slice(start, i + 1)
    }
  }
  return null
}

function asDirection(value: unknown): Layer1Direction | null {
  return typeof value === 'string' && (LAYER1_DIRECTIONS as readonly string[]).includes(value)
    ? (value as Layer1Direction)
    : null
}

function asFocus(value: unknown): Layer1Focus | null {
  return typeof value === 'string' && (LAYER1_FOCUSES as readonly string[]).includes(value)
    ? (value as Layer1Focus)
    : null
}

function asAxisEmphasis(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null
  return value.filter((entry): entry is string => typeof entry === 'string')
}

export function parseLayer1Json(
  raw: string,
  opts?: {
    /** Registry narrativeFloor override — see Layer1RegistryEntry. */
    narrativeMin?: number
  },
): Layer1Json | null {
  const unfenced = stripFences(raw)
  const extracted = extractJsonObject(unfenced) ?? unfenced
  let parsed: unknown
  try {
    parsed = JSON.parse(extracted)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null
  const record = parsed as Record<string, unknown>
  // The narrative renders as plain text (whitespace-pre-wrap), so markdown
  // bold markers some models emit (HCX, Cohere) would show as literal **.
  const narrative =
    typeof record.narrative === 'string' ? record.narrative.replace(/\*\*/g, '').trim() : ''
  if (!narrative) return null
  // Soft prompt budgets are ignored by expansive models (Claude×prism measured
  // 877 content tokens pre-v4). Reject narratives outside the hard band so the
  // adapter retries once under the strict instruction instead of accepting a
  // runaway OR a thin two-liner on a premium reading.
  const narrativeMin = opts?.narrativeMin ?? LAYER1_NARRATIVE_MIN
  const narrativeLength = [...narrative].length
  if (narrativeLength > LAYER1_NARRATIVE_MAX || narrativeLength < narrativeMin) return null
  const oneLineRaw = typeof record.one_line === 'string' ? record.one_line.trim() : ''
  if (!oneLineRaw) return null
  const direction = asDirection(record.direction)
  const focus = asFocus(record.focus)
  const axisEmphasis = asAxisEmphasis(record.axis_emphasis)
  if (!direction || !focus || !axisEmphasis) return null
  return {
    narrative,
    one_line: oneLineRaw.slice(0, LAYER1_ONE_LINE_MAX),
    direction,
    focus,
    axis_emphasis: axisEmphasis,
  }
}

export type Layer1NarrativeBandViolation = { length: number; kind: 'short' | 'long' }

/**
 * Reports when a reading failed ONLY because the narrative missed the length
 * band (JSON itself parsed, narrative is a non-empty string). Brands that
 * habitually write ~300 chars (HCX, Mistral small) ignore the generic strict
 * retry — the adapter uses this to retry with the defect named and counted,
 * which is what actually moves them into the band.
 */
export function layer1NarrativeBandViolation(
  raw: string,
  opts?: { narrativeMin?: number },
): Layer1NarrativeBandViolation | null {
  const unfenced = raw.trim()
  const extracted = extractJsonObject(unfenced) ?? unfenced
  let parsed: unknown
  try {
    parsed = JSON.parse(extracted)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null
  const narrative = (parsed as Record<string, unknown>).narrative
  if (typeof narrative !== 'string' || !narrative.trim()) return null
  // Same normalization as parseLayer1Json so both measure the same string.
  const length = [...narrative.replace(/\*\*/g, '').trim()].length
  if (length < (opts?.narrativeMin ?? LAYER1_NARRATIVE_MIN)) return { length, kind: 'short' }
  if (length > LAYER1_NARRATIVE_MAX) return { length, kind: 'long' }
  return null
}

/** TRAP (f): treat whitespace-only as empty, same as a content:null 200. */
export function isEmptyModelText(text: string | null | undefined): boolean {
  return typeof text !== 'string' || text.trim().length === 0
}
