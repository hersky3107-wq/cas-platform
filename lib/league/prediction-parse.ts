/**
 * Parses league model output into structured prediction fields.
 * Pure module — no server-only — so vitest can cover placeholder rejection.
 *
 * RULE: every model must answer up or down. flat / abstain / neutral / any
 * third value is rejected (direction null). Callers retry once, then error.
 */

export type BinaryDirection = 'up' | 'down'

export type ParsedPrediction = {
  direction: BinaryDirection | null
  probability: number | null
  rationale: string | null
  /** True when the model named a non-binary direction (flat/abstain/neutral/…). */
  rejectedDirection: boolean
}

const BINARY = new Set(['up', 'down'])
const REJECTED = new Set(['flat', 'abstain', 'neutral', 'sideways', 'unchanged', 'none', 'n/a', 'na'])

export function isBinaryDirection(value: unknown): value is BinaryDirection {
  return value === 'up' || value === 'down'
}

/** Reject prompt-schema echoes and other non-prose placeholder strings. */
export function isPlaceholderRationale(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed) return true
  if (trimmed.startsWith('<') && trimmed.endsWith('>')) return true
  if (/^one line, max \d+ chars$/i.test(trimmed)) return true
  if (/<one line/i.test(trimmed) || /max \d+ chars>/i.test(trimmed)) return true
  // Require at least one letter — filters schema tokens with only punctuation.
  if (!/[A-Za-z\u00C0-\uFFFF]/.test(trimmed)) return true
  return false
}

export function sanitizeRationale(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim().slice(0, 500)
  if (!trimmed || isPlaceholderRationale(trimmed)) return null
  return trimmed
}

/** Extracts direction/probability/rationale from model output. Handles strict JSON,
 *  markdown code fences, and inline JSON embedded in search-model prose. */
export function parsePrediction(text: string | null): ParsedPrediction | null {
  if (!text) return null

  const candidates: string[] = []
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenced?.[1]?.trim()) candidates.push(fenced[1].trim())
  const stripped = text.replace(/```(?:json)?\s*/gi, '').replace(/```/g, '').trim()
  candidates.push(stripped)
  const blocks = stripped.match(/\{[\s\S]*\}/g)
  if (blocks) candidates.push(...blocks)

  for (const chunk of candidates) {
    const parsed = parseJsonPredictionBlock(chunk)
    if (parsed) return parsed
  }

  return parseProsePredictionFallback(stripped)
}

function parseJsonPredictionBlock(raw: string): ParsedPrediction | null {
  const match = raw.match(/\{[\s\S]*\}/)
  if (!match) return null
  let obj: Record<string, unknown>
  try {
    obj = JSON.parse(match[0]) as Record<string, unknown>
  } catch {
    return null
  }
  return normalizeParsedFields(obj)
}

/** Last-resort extraction when a search model wraps JSON in markdown/citations. */
function parseProsePredictionFallback(text: string): ParsedPrediction | null {
  const dirMatch =
    text.match(/"direction"\s*:\s*"(up|down|flat|abstain|neutral)"/i) ??
    text.match(/\bdirection\b\s*[:=]\s*["']?(up|down|flat|abstain|neutral)["']?/i)
  if (!dirMatch) return null
  const probMatch = text.match(/"probability"\s*:\s*(\d+)/i) ?? text.match(/\bprobability\b\s*[:=]\s*(\d+)/i)
  const rationaleMatch = text.match(/"rationale"\s*:\s*"([^"]+)"/i)
  const obj: Record<string, unknown> = {
    direction: dirMatch[1],
    ...(probMatch ? { probability: Number(probMatch[1]) } : {}),
    ...(rationaleMatch ? { rationale: rationaleMatch[1] } : {}),
  }
  return normalizeParsedFields(obj)
}

function normalizeParsedFields(obj: Record<string, unknown>): ParsedPrediction | null {
  const dirRaw = typeof obj.direction === 'string' ? obj.direction.trim().toLowerCase() : ''
  let direction: BinaryDirection | null = null
  let rejectedDirection = false

  if (BINARY.has(dirRaw)) {
    direction = dirRaw as BinaryDirection
  } else if (dirRaw === '' || obj.direction == null) {
    rejectedDirection = true
  } else if (REJECTED.has(dirRaw) || !BINARY.has(dirRaw)) {
    rejectedDirection = true
  }

  let probability: number | null = null
  const p = Number(obj.probability)
  if (Number.isFinite(p)) probability = Math.max(0, Math.min(100, Math.round(p)))

  const rationale = sanitizeRationale(typeof obj.rationale === 'string' ? obj.rationale : null)

  if (!direction && !rationale && probability === null && !rejectedDirection) return null
  return { direction, probability, rationale, rejectedDirection }
}
