/**
 * Parses league model output into structured prediction fields.
 * Pure module — no server-only — so vitest can cover placeholder rejection.
 *
 * RULE: every model must answer up or down. flat / abstain / neutral / any
 * third value is rejected (direction null). Callers retry once, then error.
 */

export type BinaryDirection = 'up' | 'down'

export type ParseFailure = 'reasoning_leak' | 'unparseable'

export type ParsedPrediction = {
  direction: BinaryDirection | null
  probability: number | null
  /**
   * Expected signed percent change over the round's horizon, or null when
   * missing/non-numeric. Raw extraction only — sign-vs-direction and
   * per-horizon bound checks happen in `lib/league/magnitude.ts`'s
   * `validateMagnitude`, called by the orchestrator (this module has no
   * horizon to check against).
   */
  magnitude: number | null
  rationale: string | null
  /** True when the model named a non-binary direction (flat/abstain/neutral/…). */
  rejectedDirection: boolean
  /** Set when the output is a no-answer (leak or truncated CoT). */
  parseFailure?: ParseFailure
}

const BINARY = new Set(['up', 'down'])
const REJECTED = new Set(['flat', 'abstain', 'neutral', 'sideways', 'unchanged', 'none', 'n/a', 'na'])

/** Display rationale cap — also the cutoff for inferring a direction from prose. */
export const RATIONALE_SNIPPET_MAX_CHARS = 500

const REASONING_TRACE_MARKERS: readonly RegExp[] = [
  /Thinking Process/i,
  /Analyze the Request/i,
  /<think>/i,
  /Let's count/i,
  /\bWait\./,
]

export function hasReasoningTrace(text: string): boolean {
  return REASONING_TRACE_MARKERS.some((re) => re.test(text))
}

/** Drop hidden-thinking wrappers so a trailing answer JSON can still be found. */
export function stripReasoningTracePreamble(text: string): string {
  return text.replace(/<think\b[^>]*>[\s\S]*?<\/think>/gi, '').replace(/<think\b[^>]*>[\s\S]*$/gi, '').trim()
}

function leakedPrediction(): ParsedPrediction {
  return {
    direction: null,
    probability: null,
    magnitude: null,
    rationale: null,
    rejectedDirection: true,
    parseFailure: 'reasoning_leak',
  }
}

function unparseablePrediction(): ParsedPrediction {
  return {
    direction: null,
    probability: null,
    magnitude: null,
    rationale: null,
    rejectedDirection: true,
    parseFailure: 'unparseable',
  }
}

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

const ANSWER_JSON_KEY = /"direction"\s*:|"side"\s*:/

/** True when text looks like a league answer JSON blob, not prose. */
export function looksLikeAnswerJsonText(text: string): boolean {
  const trimmed = text.trim()
  return trimmed.startsWith('{') && ANSWER_JSON_KEY.test(trimmed)
}

export type AnswerJsonSupplement = {
  rationale: string | null
  probability: number | null
  magnitude: number | null
}

function fieldsFromAnswerObject(obj: Record<string, unknown>): AnswerJsonSupplement {
  const rationaleRaw =
    typeof obj.rationale === 'string' ? obj.rationale : typeof obj.reason === 'string' ? obj.reason : null
  let probability: number | null = null
  const p = Number(obj.probability)
  if (Number.isFinite(p)) probability = Math.max(0, Math.min(100, Math.round(p)))
  let magnitude: number | null = null
  if (typeof obj.magnitude === 'number' || typeof obj.magnitude === 'string') {
    const m = Number(obj.magnitude)
    if (Number.isFinite(m)) magnitude = m
  }
  return { rationale: rationaleRaw, probability, magnitude }
}

function partialFieldsFromAnswerText(text: string): AnswerJsonSupplement {
  const probMatch = text.match(/"probability"\s*:\s*(\d+)/i)
  const magnitudeMatch = text.match(/"magnitude"\s*:\s*(-?\d+(?:\.\d+)?)/i)
  const rationaleMatch =
    text.match(/"rationale"\s*:\s*"((?:\\.|[^"\\])*)"/i) ??
    text.match(/"reason"\s*:\s*"((?:\\.|[^"\\])*)"/i) ??
    text.match(/"rationale"\s*:\s*"([\s\S]+)$/i) ??
    text.match(/"reason"\s*:\s*"([\s\S]+)$/i)
  let rationale: string | null = null
  if (rationaleMatch?.[1]) {
    rationale = rationaleMatch[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\').replace(/\\n/g, '\n')
  }
  return {
    rationale,
    probability: probMatch ? Number(probMatch[1]) : null,
    magnitude: magnitudeMatch ? Number(magnitudeMatch[1]) : null,
  }
}

/**
 * Parse direction/side JSON (full or truncated) for rationale and numeric
 * fields. Used on write when the contract omitted them and on read cleanup.
 */
export function extractAnswerJsonSupplement(raw: string | null | undefined): AnswerJsonSupplement | null {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  if (!trimmed || !looksLikeAnswerJsonText(trimmed)) return null
  try {
    const obj = JSON.parse(trimmed) as Record<string, unknown>
    if (obj && typeof obj === 'object' && ('direction' in obj || 'side' in obj)) {
      return fieldsFromAnswerObject(obj)
    }
  } catch {
    // truncated JSON — fall through
  }
  const last = findLastAnswerJson(trimmed)
  if (last) return fieldsFromAnswerObject(last.obj)
  return partialFieldsFromAnswerText(trimmed)
}

/**
 * Display/storage snippet: never return raw answer JSON. Extracts
 * rationale/reason when present; otherwise null.
 */
export function coerceStoredRationaleSnippet(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  if (!trimmed) return null
  if (looksLikeAnswerJsonText(trimmed)) {
    const sup = extractAnswerJsonSupplement(trimmed)
    return sanitizeRationale(sup?.rationale ?? null)
  }
  const clean = sanitizeRationale(trimmed)
  if (clean && looksLikeAnswerJsonText(clean)) return null
  return clean
}

export function sanitizeRationale(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim().slice(0, RATIONALE_SNIPPET_MAX_CHARS)
  if (!trimmed || isPlaceholderRationale(trimmed) || hasReasoningTrace(trimmed)) return null
  if (looksLikeAnswerJsonText(trimmed)) return coerceStoredRationaleSnippet(trimmed)
  return trimmed
}

function hostnameFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, '')
  } catch {
    return ''
  }
}

/**
 * DISPLAY-ONLY scout rationale cleaner. Never call this on a write path —
 * stored `reasoning_snippet` stays verbatim. Strips numeric citation markers
 * and turns markdown/bare URLs into the visible label or hostname (no query).
 */
export function sanitizeScoutRationaleDisplay(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null
  let text = raw
  text = text.replace(/\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/gi, (_m, label: string, url: string) => {
    const visible = String(label).trim()
    return visible || hostnameFromUrl(url)
  })
  text = text.replace(/\[\[\s*\d+(?:\s*,\s*\d+)*\s*\]\]/g, '')
  text = text.replace(/\[\s*\d+(?:\s*,\s*\d+)*\s*\]/g, '')
  text = text.replace(/https?:\/\/[^\s)\]>]+/gi, (url) => hostnameFromUrl(url))
  text = text.replace(/[?&](?:utm_[a-z0-9]+|fbclid|gclid|mc_cid|mc_eid)=[^&\s]*/gi, '')
  text = text.replace(/[ \t]{2,}/g, ' ').replace(/ +([,.;:])/g, '$1').trim()
  return text || null
}

/** DB cap for the stored visible-reasoning block (PART 1 of the v2 output
 *  contract). ~150 words is the prompt's ask; 4000 chars absorbs models that
 *  overrun without letting a runaway output bloat the ledger row. */
export const REASONING_TEXT_MAX_CHARS = 4000

/** Cleans the pre-JSON reasoning block for persistence: fences stripped,
 *  trimmed, capped. Null when empty or a placeholder echo. */
export function sanitizeReasoningText(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null
  const cleaned = raw
    .replace(/```(?:json)?/gi, '')
    .replace(/```/g, '')
    .trim()
    .slice(0, REASONING_TEXT_MAX_CHARS)
    .trim()
  if (!cleaned || isPlaceholderRationale(cleaned) || hasReasoningTrace(cleaned)) return null
  return cleaned
}

/**
 * Finds the LAST parseable JSON object in mixed output that carries a
 * "direction" key (the v2 contract puts the answer JSON on the final line,
 * after the visible reasoning block). Scans '{' positions from the END and
 * brace-matches forward with string-awareness, so braces inside the reasoning
 * prose or inside JSON string values cannot break extraction. The
 * direction-key requirement skips nested sub-objects that parse but are not
 * the answer.
 */
function findLastAnswerJson(text: string): { obj: Record<string, unknown>; start: number } | null {
  const opens: number[] = []
  for (let i = 0; i < text.length; i++) if (text[i] === '{') opens.push(i)
  for (let c = opens.length - 1; c >= 0; c--) {
    const start = opens[c]
    let depth = 0
    let inString = false
    let escaped = false
    for (let i = start; i < text.length; i++) {
      const ch = text[i]
      if (inString) {
        if (escaped) escaped = false
        else if (ch === '\\') escaped = true
        else if (ch === '"') inString = false
        continue
      }
      if (ch === '"') inString = true
      else if (ch === '{') depth++
      else if (ch === '}') {
        depth--
        if (depth === 0) {
          try {
            const obj = JSON.parse(text.slice(start, i + 1)) as Record<string, unknown>
            if (obj && typeof obj === 'object' && 'direction' in obj) return { obj, start }
          } catch {
            // not valid JSON from this open brace — try the previous one
          }
          break
        }
      }
    }
  }
  return null
}

export type SplitPrediction = {
  /** Verbatim text BEFORE the answer JSON (the visible reasoning block), sanitized. Null when the output was JSON-only or unparseable. */
  reasoning: string | null
  parsed: ParsedPrediction | null
}

/**
 * v2 contract: reasoning block first, answer JSON as the last line. Splits
 * mixed output into the stored reasoning text and the parsed answer. Falls
 * back to `parsePrediction` heuristics when no last-line JSON is found, so
 * legacy JSON-only outputs and scout prose still parse (reasoning null).
 */
export function splitReasoningAndJson(text: string | null): SplitPrediction {
  if (!text) return { reasoning: null, parsed: null }
  const parsed = parsePrediction(text)
  if (parsed?.parseFailure) return { reasoning: null, parsed }
  const last = findLastAnswerJson(stripReasoningTracePreamble(text))
  if (!last) return { reasoning: null, parsed }
  const reasoning = sanitizeReasoningText(text.slice(0, last.start))
  if (reasoning && hasReasoningTrace(reasoning)) return { reasoning: null, parsed }
  return { reasoning, parsed }
}

/** Extracts direction/probability/rationale from model output. Handles strict JSON,
 *  markdown code fences, inline JSON embedded in search-model prose, and the v2
 *  reasoning-block-then-JSON shape (last parseable JSON with a direction key wins). */
export function parsePrediction(text: string | null): ParsedPrediction | null {
  if (!text) return null
  const stripped = stripReasoningTracePreamble(text)

  // v2 shape first: the answer is the LAST JSON object carrying "direction".
  const last = findLastAnswerJson(stripped)
  if (last) {
    const parsed = normalizeParsedFields(last.obj)
    if (parsed?.parseFailure === 'reasoning_leak') return leakedPrediction()
    if (parsed) return parsed
  }

  if (hasReasoningTrace(text) || hasReasoningTrace(stripped)) return leakedPrediction()
  if (stripped.length > RATIONALE_SNIPPET_MAX_CHARS && !last) return unparseablePrediction()

  const candidates: string[] = []
  const fenced = stripped.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenced?.[1]?.trim()) candidates.push(fenced[1].trim())
  const unfenced = stripped.replace(/```(?:json)?\s*/gi, '').replace(/```/g, '').trim()
  candidates.push(unfenced)
  const blocks = unfenced.match(/\{[\s\S]*\}/g)
  if (blocks) candidates.push(...blocks)

  for (const chunk of candidates) {
    const parsed = parseJsonPredictionBlock(chunk)
    if (parsed?.parseFailure === 'reasoning_leak') return leakedPrediction()
    if (parsed) return parsed
  }

  return parseProsePredictionFallback(unfenced)
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
  const magnitudeMatch =
    text.match(/"magnitude"\s*:\s*(-?\d+(?:\.\d+)?)/i) ?? text.match(/\bmagnitude\b\s*[:=]\s*(-?\d+(?:\.\d+)?)/i)
  const rationaleMatch = text.match(/"rationale"\s*:\s*"([^"]+)"/i)
  const obj: Record<string, unknown> = {
    direction: dirMatch[1],
    ...(probMatch ? { probability: Number(probMatch[1]) } : {}),
    ...(magnitudeMatch ? { magnitude: Number(magnitudeMatch[1]) } : {}),
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

  let magnitude: number | null = null
  if (typeof obj.magnitude === 'number' || typeof obj.magnitude === 'string') {
    const m = Number(obj.magnitude)
    if (Number.isFinite(m)) magnitude = m
  }

  const rationaleRaw =
    typeof obj.rationale === 'string' ? obj.rationale : typeof obj.reason === 'string' ? obj.reason : null
  if (rationaleRaw && hasReasoningTrace(rationaleRaw)) return leakedPrediction()
  const rationale = sanitizeRationale(rationaleRaw)

  if (!direction && !rationale && probability === null && magnitude === null && !rejectedDirection) return null
  return { direction, probability, magnitude, rationale, rejectedDirection }
}
