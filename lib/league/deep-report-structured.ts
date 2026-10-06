/**
 * JSON contracts for deep-report debaters and the chair. Pure: no I/O.
 *
 * Probability convention (same as the answer contract): a stated
 * probability is the chance that the stated side is right. A call below 50
 * is the other side — "yes 24" is counted as "no 76". The final side is
 * independent of the side a debater was assigned to argue.
 */
import { chairCitesExchange, quoteMatchesOpening } from './deep-debate-pairs'
import type { SourceTier } from './deep-report-dossier'
import type { DebateSide } from './deep-report-policy'
import { parseJsonObject } from './json-object'

export const REPORT_TEXT_LIMITS = {
  headline: 60,
  point: 140,
  quotedClaim: 80,
  rebuttalBody: 200,
  reply: 160,
  whyChanged: 100,
  oneLine: 160,
  judgment: 200,
  minority: 200,
  evidenceClaim: 160,
  trigger: 120,
  scenario: 60,
  vsWhy: 160,
} as const

export type EvidencePoint = { text: string; ref: string | null }

export type DebaterOpening = {
  headline: string
  points: EvidencePoint[]
  finalSide: DebateSide
  finalProbability: number
}

export type DebaterRebuttal = {
  headline: string
  points: EvidencePoint[]
  rebuttal: EvidencePoint[]
  finalSide: DebateSide
  finalProbability: number
  whyChanged: string | null
}

export type ReplyStance = 'concede' | 'partial' | 'defend'

/** Round 2: one quoted claim from the paired opponent, then the rebuttal. */
export type TargetedRebuttal = {
  targetModel: string
  quotedClaim: string
  rebuttal: string
  evidenceRefs: string[]
}

/** Round 3: the targeted debater answers, then states a final call. */
export type CounterReply = {
  repliesToModel: string
  stance: ReplyStance
  reply: string
  evidenceRefs: string[]
  finalSide: DebateSide
  finalProbability: number
  whyChanged: string | null
}

export type ReportRelation = 'stronger' | 'weaker' | 'opposite'

export type ChairEvidence = {
  claim: string
  source: string | null
  date: string | null
  tier: SourceTier
  ref: string | null
}

export type ChairReport = {
  verdictSide: DebateSide
  verdictProbability: number
  oneLine: string
  vs40Why: string | null
  vs40RelationClaimed: ReportRelation | null
  keyEvidence: ChairEvidence[]
  debateJudgment: string[]
  minorityView: string | null
  flipTriggers: { event: string; byDate: string | null }[]
  scenarios: { name: string; weight: number }[]
}

export type Validation<T> = { ok: true; value: T } | { ok: false; reason: string }

const TIERS: readonly SourceTier[] = ['official', 'regulator', 'major_outlet', 'rumor', 'other']

/** Strip markdown, citation markers and URLs; collapse whitespace. */
export function plainText(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  return raw
    .replace(/\[(?:web|news|src)?:?\s*\d+(?:\s*[,–-]\s*\d+)*\]|【[^】]*】/gi, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/\*\*|__|`|~~/g, '')
    .replace(/^[\s>#*\-•|]+/gm, '')
    .replace(/(^|\s)#{1,6}(?=\s)/g, '$1')
    .replace(/\|/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const REF_SRC = String.raw`E\d{1,2}`
const REF_GROUP = new RegExp(String.raw`\s*[(\[（]\s*${REF_SRC}(?:\s*[,，/·&]\s*${REF_SRC})*\s*[)\]）]`, 'g')
const TRAILING_REFS = new RegExp(String.raw`\s*\b${REF_SRC}(?:\s*[,，/]\s*${REF_SRC})*\s*(?=[.。!?]?\s*$)`)
const BARE_REF = new RegExp(String.raw`\b${REF_SRC}\b`, 'g')

function tidyPunctuation(text: string): string {
  return text
    .replace(/\s+([,.;:!?。])/g, '$1')
    .replace(/([,;])(?=[,.;。])/g, '')
    .replace(/^[,.;:]\s*/, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

/** Remove "(E3, E4)" / "[E1]" groups and a trailing ref list; keeps mid-sentence refs. */
export function stripRefGroups(text: string): string {
  return tidyPunctuation(text.replace(REF_GROUP, '').replace(TRAILING_REFS, ''))
}

/**
 * Last pass before a model's text reaches a reader: ref groups go, a bare
 * mid-sentence ref becomes its source name, YES/NO become the round's side words.
 */
export function readerText(
  text: string,
  opts: { refLabel?: (ref: string) => string | null; sideWords?: { yes: string; no: string } } = {},
): string {
  let out = stripRefGroups(text).replace(BARE_REF, (ref) => opts.refLabel?.(ref) ?? '')
  if (opts.sideWords) out = out.replace(/\bYES\b/g, opts.sideWords.yes).replace(/\bNO\b/g, opts.sideWords.no)
  return tidyPunctuation(out)
}

/** Clip at a word boundary with an ellipsis. Never cuts inside a word. */
export function clipText(text: string, max: number): string {
  if (text.length <= max) return text
  const head = text.slice(0, max - 1)
  const cut = head.search(/\s\S*$/)
  const base = cut > max * 0.6 ? head.slice(0, cut) : head
  return `${base.replace(/[\s,;:·—-]+$/, '')}…`
}

function short(raw: unknown, max: number): string | null {
  const text = plainText(raw)
  return text ? clipText(text, max) : null
}

const REF_IN_TEXT = /\(?\b(E\d{1,2})\b\)?/

function normalizeRef(raw: unknown): string | null {
  if (typeof raw !== 'string') {
    if (Array.isArray(raw) && typeof raw[0] === 'string') return normalizeRef(raw[0])
    return null
  }
  const m = raw.toUpperCase().match(/E\d{1,2}/)
  return m ? m[0] : null
}

function points(raw: unknown, max: number): EvidencePoint[] {
  if (!Array.isArray(raw)) return []
  const out: EvidencePoint[] = []
  for (const item of raw) {
    let text = ''
    let ref: string | null = null
    if (typeof item === 'string') {
      text = item
    } else if (item && typeof item === 'object') {
      const obj = item as Record<string, unknown>
      text = typeof obj.text === 'string' ? obj.text : typeof obj.point === 'string' ? obj.point : ''
      ref = normalizeRef(obj.ref ?? obj.evidence ?? obj.evidence_ref)
    }
    if (!ref) ref = normalizeRef(text.match(REF_IN_TEXT)?.[1] ?? null)
    const cleaned = stripRefGroups(plainText(text))
    if (!cleaned) continue
    out.push({ text: clipText(cleaned, max), ref })
  }
  return out
}

function asSide(raw: unknown): DebateSide | null {
  if (typeof raw !== 'string') return null
  const v = raw.trim().toLowerCase()
  if (v === 'yes' || v === 'y') return 'yes'
  if (v === 'no' || v === 'n') return 'no'
  return null
}

function asProbability(raw: unknown): number | null {
  let n: number
  if (typeof raw === 'number') n = raw
  else if (typeof raw === 'string') n = Number(raw.replace(/[%\s]/g, ''))
  else return null
  if (!Number.isFinite(n)) return null
  if (n > 0 && n < 1 && !Number.isInteger(n)) n *= 100
  if (n < 0 || n > 100) return null
  return Math.round(n)
}

/** Side + probability-that-side-is-right. Below 50 flips to the other side. */
export function normalizeFinalCall(side: unknown, probability: unknown): { side: DebateSide; probability: number } | null {
  const s = asSide(side)
  const p = asProbability(probability)
  if (!s || p === null) return null
  if (p < 50) return { side: s === 'yes' ? 'no' : 'yes', probability: 100 - p }
  return { side: s, probability: p }
}

const TRUNCATION_REASONS = new Set(['length', 'max_tokens', 'MAX_TOKENS', 'max_output_tokens'])

/** True when the provider stopped on the token cap or the JSON never closed. */
export function looksTruncated(text: string | null | undefined, finishReason?: string | null): boolean {
  if (finishReason && TRUNCATION_REASONS.has(finishReason)) return true
  if (!text) return false
  const body = text.trim()
  const start = body.indexOf('{')
  if (start === -1) return false
  let depth = 0
  let inString = false
  let escaped = false
  for (const ch of body.slice(start)) {
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') inString = true
    else if (ch === '{' || ch === '[') depth += 1
    else if (ch === '}' || ch === ']') depth -= 1
  }
  return depth > 0 || inString
}

function parseOrReason(text: string | null | undefined, finishReason?: string | null): Record<string, unknown> | string {
  if (!text || !text.trim()) return 'empty'
  if (looksTruncated(text, finishReason)) return 'truncated'
  const obj = parseJsonObject(text)
  return obj ?? 'not_json'
}

export function validateOpening(text: string | null | undefined, finishReason?: string | null): Validation<DebaterOpening> {
  const obj = parseOrReason(text, finishReason)
  if (typeof obj === 'string') return { ok: false, reason: obj }
  const headline = short(obj.headline, REPORT_TEXT_LIMITS.headline)
  const list = points(obj.points, REPORT_TEXT_LIMITS.point).slice(0, 3)
  const call = normalizeFinalCall(obj.final_side, obj.final_probability)
  if (!headline) return { ok: false, reason: 'missing headline' }
  if (list.length < 2) return { ok: false, reason: 'fewer than 2 points' }
  if (!call) return { ok: false, reason: 'missing final side/probability' }
  return { ok: true, value: { headline, points: list, finalSide: call.side, finalProbability: call.probability } }
}

function evidenceRefs(raw: unknown, text: string): string[] {
  const fromField = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(/[, ]+/) : []
  const out: string[] = []
  const push = (value: unknown) => {
    const ref = normalizeRef(typeof value === 'string' ? value : null)
    if (ref && !out.includes(ref)) out.push(ref)
  }
  for (const item of fromField) push(item)
  for (const match of text.match(/\bE\d{1,2}\b/g) ?? []) push(match)
  return out.slice(0, 4)
}

function namesModel(raw: string, accepted: readonly string[]): boolean {
  const v = raw.trim().toLowerCase()
  return accepted.some((name) => name.trim().toLowerCase() === v)
}

export function validateTargetedRebuttal(
  text: string | null | undefined,
  finishReason: string | null | undefined,
  ctx: {
    opening: { headline?: string | null; points?: readonly { text?: string | null }[] | null }
    acceptedTargets: readonly string[]
  },
): Validation<TargetedRebuttal> {
  const obj = parseOrReason(text, finishReason)
  if (typeof obj === 'string') return { ok: false, reason: obj }
  const target = typeof obj.target_model === 'string' ? obj.target_model.trim() : ''
  const quoted = short(obj.quoted_claim, REPORT_TEXT_LIMITS.quotedClaim)
  const rebuttal = short(obj.rebuttal, REPORT_TEXT_LIMITS.rebuttalBody)
  const refs = evidenceRefs(obj.evidence_refs ?? obj.evidenceRefs, typeof obj.rebuttal === 'string' ? obj.rebuttal : '')
  if (!target || !namesModel(target, ctx.acceptedTargets)) return { ok: false, reason: 'target is not the paired opponent' }
  if (!quoted || !quoteMatchesOpening(quoted, ctx.opening)) return { ok: false, reason: 'quoted claim is not in the opponent opening' }
  if (!rebuttal) return { ok: false, reason: 'missing rebuttal' }
  if (refs.length < 1) return { ok: false, reason: 'missing evidence refs' }
  return { ok: true, value: { targetModel: target, quotedClaim: quoted, rebuttal, evidenceRefs: refs } }
}

function asStance(raw: unknown): ReplyStance | null {
  if (typeof raw !== 'string') return null
  const v = raw.trim().toLowerCase()
  if (v === 'concede' || v === 'conceded' || v === '인정') return 'concede'
  if (v === 'partial' || v === 'partly' || v === '일부') return 'partial'
  if (v === 'defend' || v === 'defense' || v === 'hold' || v === '반박') return 'defend'
  return null
}

export function validateCounterReply(
  text: string | null | undefined,
  finishReason: string | null | undefined,
  ctx: { acceptedTargets: readonly string[] },
): Validation<CounterReply> {
  const obj = parseOrReason(text, finishReason)
  if (typeof obj === 'string') return { ok: false, reason: obj }
  const target = typeof obj.replies_to_model === 'string' ? obj.replies_to_model.trim() : ''
  const stance = asStance(obj.stance)
  const reply = short(obj.reply, REPORT_TEXT_LIMITS.reply)
  const call = normalizeFinalCall(obj.final_side, obj.final_probability)
  const refs = evidenceRefs(obj.evidence_refs ?? obj.evidenceRefs, typeof obj.reply === 'string' ? obj.reply : '')
  if (!target || !namesModel(target, ctx.acceptedTargets)) return { ok: false, reason: 'reply target is not the paired opponent' }
  if (!stance) return { ok: false, reason: 'missing stance' }
  if (!reply) return { ok: false, reason: 'missing reply' }
  if (stance !== 'concede' && refs.length < 1) return { ok: false, reason: 'defense has no evidence ref' }
  if (!call) return { ok: false, reason: 'missing final side/probability' }
  return {
    ok: true,
    value: {
      repliesToModel: target,
      stance,
      reply,
      evidenceRefs: refs,
      finalSide: call.side,
      finalProbability: call.probability,
      whyChanged: short(obj.why_changed, REPORT_TEXT_LIMITS.whyChanged),
    },
  }
}

export function validateRebuttal(text: string | null | undefined, finishReason?: string | null): Validation<DebaterRebuttal> {
  const obj = parseOrReason(text, finishReason)
  if (typeof obj === 'string') return { ok: false, reason: obj }
  const headline = short(obj.headline, REPORT_TEXT_LIMITS.headline)
  const rebuttal = points(obj.rebuttal, REPORT_TEXT_LIMITS.point).slice(0, 2)
  const call = normalizeFinalCall(obj.final_side, obj.final_probability)
  if (!headline) return { ok: false, reason: 'missing headline' }
  if (rebuttal.length < 1) return { ok: false, reason: 'missing rebuttal' }
  if (!call) return { ok: false, reason: 'missing final side/probability' }
  return {
    ok: true,
    value: {
      headline,
      points: points(obj.points, REPORT_TEXT_LIMITS.point).slice(0, 3),
      rebuttal,
      finalSide: call.side,
      finalProbability: call.probability,
      whyChanged: short(obj.why_changed, REPORT_TEXT_LIMITS.whyChanged),
    },
  }
}

function asRelation(raw: unknown): ReportRelation | null {
  if (typeof raw !== 'string') return null
  const v = raw.trim().toLowerCase()
  return v === 'stronger' || v === 'weaker' || v === 'opposite' ? v : null
}

function asTier(raw: unknown): SourceTier {
  const v = typeof raw === 'string' ? raw.trim().toLowerCase().replace(/\s+/g, '_') : ''
  return TIERS.includes(v as SourceTier) ? (v as SourceTier) : 'other'
}

function asIsoDate(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const m = raw.trim().match(/^\d{4}(?:-\d{2}(?:-\d{2})?)?/)
  return m ? m[0] : null
}

function stringList(raw: unknown, max: number, limit: number): string[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((item) => {
      if (typeof item === 'string') return short(item, max)
      if (item && typeof item === 'object') {
        const obj = item as Record<string, unknown>
        return short(obj.text ?? obj.judgment ?? obj.line, max)
      }
      return null
    })
    .filter((line): line is string => Boolean(line))
    .slice(0, limit)
}

export function validateChair(
  text: string | null | undefined,
  finishReason?: string | null,
  ctx?: { exchanges?: readonly { left: string; right: string }[] },
): Validation<ChairReport> {
  const obj = parseOrReason(text, finishReason)
  if (typeof obj === 'string') return { ok: false, reason: obj }
  const call = normalizeFinalCall(obj.verdict_side, obj.verdict_probability)
  const oneLine = short(obj.one_line, REPORT_TEXT_LIMITS.oneLine)
  const vs = (obj.vs_40ai && typeof obj.vs_40ai === 'object' ? obj.vs_40ai : {}) as Record<string, unknown>
  const keyEvidence: ChairEvidence[] = (Array.isArray(obj.key_evidence) ? obj.key_evidence : [])
    .filter((row): row is Record<string, unknown> => !!row && typeof row === 'object')
    .map((row) => ({
      claim: short(row.claim, REPORT_TEXT_LIMITS.evidenceClaim) ?? '',
      source: short(row.source, 80),
      date: asIsoDate(row.date),
      tier: asTier(row.tier),
      ref: normalizeRef(row.ref ?? row.evidence_ref),
    }))
    .filter((row) => row.claim.length > 0)
    .slice(0, 5)
  const debateJudgment = stringList(obj.debate_judgment, REPORT_TEXT_LIMITS.judgment, 3)
  const flipTriggers = (Array.isArray(obj.flip_triggers) ? obj.flip_triggers : [])
    .map((row) => {
      if (typeof row === 'string') return { event: short(row, REPORT_TEXT_LIMITS.trigger) ?? '', byDate: null }
      if (!row || typeof row !== 'object') return { event: '', byDate: null }
      const r = row as Record<string, unknown>
      return { event: short(r.event, REPORT_TEXT_LIMITS.trigger) ?? '', byDate: asIsoDate(r.by_date ?? r.date) }
    })
    .filter((row) => row.event.length > 0)
    .slice(0, 3)
  const scenarios = (Array.isArray(obj.scenarios) ? obj.scenarios : [])
    .filter((row): row is Record<string, unknown> => !!row && typeof row === 'object')
    .map((row) => ({ name: short(row.name, REPORT_TEXT_LIMITS.scenario) ?? '', weight: asProbability(row.weight) ?? 0 }))
    .filter((row) => row.name.length > 0)
    .slice(0, 3)

  if (!call) return { ok: false, reason: 'missing verdict side/probability' }
  if (!oneLine) return { ok: false, reason: 'missing one_line' }
  if (keyEvidence.length < 3) return { ok: false, reason: 'fewer than 3 key evidence rows' }
  if (debateJudgment.length < 2) return { ok: false, reason: 'fewer than 2 debate judgments' }
  if (ctx?.exchanges?.length && !chairCitesExchange(debateJudgment, ctx.exchanges)) {
    return { ok: false, reason: 'debate judgment cites no exchange' }
  }
  if (flipTriggers.length < 1) return { ok: false, reason: 'missing flip triggers' }
  return {
    ok: true,
    value: {
      verdictSide: call.side,
      verdictProbability: call.probability,
      oneLine,
      vs40Why: short(vs.why, REPORT_TEXT_LIMITS.vsWhy),
      vs40RelationClaimed: asRelation(vs.relation),
      keyEvidence,
      debateJudgment,
      minorityView: short(obj.minority_view, REPORT_TEXT_LIMITS.minority),
      flipTriggers,
      scenarios,
    },
  }
}

/** Retry suffix sent once after an invalid or truncated reply. */
export function retryInstruction(reason: string): string {
  return [
    `Your previous reply was rejected (${reason}).`,
    'Reply again with ONLY the JSON object — no prose, no markdown, no code fences.',
    'Keep every string within its length limit so the object closes completely.',
  ].join(' ')
}

// ── Final vote ────────────────────────────────────────────────────────────────

export type FinalVoteInput = {
  provider: string
  model: string
  assignedSide: DebateSide
  finalSide: DebateSide | null
  finalProbability: number | null
  whyChanged?: string | null
}

export type FinalVote = FinalVoteInput & { changedMind: boolean }

export type VoteTally = {
  seats: FinalVote[]
  yes: number
  no: number
  /** Seats with a final call. */
  counted: number
  /** All debater seats. */
  total: number
  majority: DebateSide | null
  majorityCount: number
  changed: FinalVote[]
}

export function tallyVotes(inputs: FinalVoteInput[]): VoteTally {
  const seats: FinalVote[] = inputs.map((row) => {
    const call = row.finalSide ? normalizeFinalCall(row.finalSide, row.finalProbability) : null
    const finalSide = call?.side ?? null
    return {
      ...row,
      finalSide,
      finalProbability: call?.probability ?? null,
      changedMind: finalSide !== null && finalSide !== row.assignedSide,
    }
  })
  const yes = seats.filter((row) => row.finalSide === 'yes').length
  const no = seats.filter((row) => row.finalSide === 'no').length
  const majority: DebateSide | null = yes === no ? null : yes > no ? 'yes' : 'no'
  return {
    seats,
    yes,
    no,
    counted: yes + no,
    total: seats.length,
    majority,
    majorityCount: Math.max(yes, no),
    changed: seats.filter((row) => row.changedMind),
  }
}

/** opposite when sides differ; otherwise stronger/weaker by probability. */
export function relationTo40(
  verdict: { side: DebateSide; probability: number },
  ai40: { side: DebateSide | null; confidence: number | null } | null,
): ReportRelation | null {
  if (!ai40?.side || ai40.confidence == null) return null
  if (verdict.side !== ai40.side) return 'opposite'
  return verdict.probability > ai40.confidence ? 'stronger' : 'weaker'
}
