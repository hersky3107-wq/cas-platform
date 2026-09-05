/**
 * Layer-2 verdict ballot parser.
 *
 * One seer returns ONE ballot. Hard budgets: an over-limit verdict_line
 * fails the parse and the adapter retries once with the strict instruction —
 * soft truncation is deliberately not used, same principle as
 * LAYER1_NARRATIVE_MAX. The panel tally is computed in code from these
 * ballots (runner/ballot.ts); no AI ever aggregates them.
 */
import { extractJsonObject } from './parse-layer1'
import { SEER_MINORITY_OPINION_MAX, verdictLineBudget } from './seer-roster'

export const VERDICT_DIRECTIONS = ['advance', 'hold', 'release'] as const
export type VerdictDirection = (typeof VERDICT_DIRECTIONS)[number]

export const VERDICT_FOCI = ['work', 'money', 'love', 'social', 'energy'] as const
export type VerdictFocus = (typeof VERDICT_FOCI)[number]

export const VERDICT_DOMAINS = ['work', 'money', 'love', 'social', 'energy'] as const
export type VerdictDomain = (typeof VERDICT_DOMAINS)[number]

export type VerdictJson = {
  verdict_line: string
  direction: VerdictDirection
  focus: VerdictFocus
  /** 0–100 integers, all five domains present. */
  domains: Record<VerdictDomain, number>
  minority_opinion: string | null
}

function parseDomains(value: unknown): Record<VerdictDomain, number> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const out = {} as Record<VerdictDomain, number>
  for (const domain of VERDICT_DOMAINS) {
    const raw = record[domain]
    if (typeof raw !== 'number' || !Number.isFinite(raw)) return null
    if (raw < 0 || raw > 100) return null
    out[domain] = Math.round(raw)
  }
  return out
}

/**
 * `readerCount` sets the verdict_line budget (3→400 / 5→240 / 7→120 / 9→80
 * chars): the panel grows, each voice shrinks, total stays in one band.
 */
export function parseVerdictJson(raw: string, readerCount: number): VerdictJson | null {
  const json = extractJsonObject(raw) ?? raw.trim()
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null
  const record = parsed as Record<string, unknown>

  if (typeof record.verdict_line !== 'string') return null
  const verdictLine = record.verdict_line.trim()
  if (!verdictLine || [...verdictLine].length > verdictLineBudget(readerCount)) return null

  const direction = record.direction
  if (typeof direction !== 'string' || !(VERDICT_DIRECTIONS as readonly string[]).includes(direction)) {
    return null
  }

  const focus = record.focus
  if (typeof focus !== 'string' || !(VERDICT_FOCI as readonly string[]).includes(focus)) {
    return null
  }

  const domains = parseDomains(record.domains)
  if (!domains) return null

  let minorityOpinion: string | null
  if (record.minority_opinion === null || record.minority_opinion === undefined) {
    minorityOpinion = null
  } else if (typeof record.minority_opinion === 'string') {
    const trimmed = record.minority_opinion.trim()
    if (!trimmed) minorityOpinion = null
    else if ([...trimmed].length > SEER_MINORITY_OPINION_MAX) return null
    else minorityOpinion = trimmed
  } else {
    return null
  }

  return {
    verdict_line: verdictLine,
    direction: direction as VerdictDirection,
    focus: focus as VerdictFocus,
    domains,
    minority_opinion: minorityOpinion,
  }
}

/**
 * FIX 4 — the vote must not contradict its own text (session fb3336ed voted
 * "만장일치 · 전진" over three verdicts that all said finish what exists).
 *
 * Keyword heuristic at the "obvious keyword level", with negation awareness:
 * a keyword counts as AFFIRMED only when it is not negated in place
 * ("확장을 멈추고", "벌리지 말고", "무리한 확장보다"). A ballot is a mismatch
 * only when the text affirms NO keyword of its voted direction AND affirms at
 * least one keyword of a different direction. Anything subtler than that is a
 * judgement call the retry prompt handles — this guard only catches obvious
 * contradictions. Korean stems only; verdict prose is ko-locale.
 */
export const VERDICT_DIRECTION_KEYWORDS: Record<VerdictDirection, readonly string[]> = {
  advance: ['전진', '확장', '나아가', '나아갈', '추진', '밀어붙', '새로 시작', '벌리', '넓히', '도전', '착수', '박차'],
  hold: ['유지', '지키', '지켜', '다지', '다질', '정비', '버티', '굳히', '머무', '현상 유지', '점검', '마무리', '완성', '완결', '보수적', '재정비', '공고히'],
  release: ['정리', '내려놓', '비우', '비워', '놓아주', '놓아 주', '떠나보내', '흘려보내', '손을 떼', '손 떼', '끝내', '청산'],
}

/** Negators that flip a keyword when they follow within a short window. */
const TRAILING_NEGATORS = ['지 말', '지말', '말고', '말라', '마라', '멈추', '그만', '보다', '아니라', '않', '접어', '자제', '늦추']
/** Qualifiers that mark the keyword as the rejected option when they precede it. */
const LEADING_NEGATORS = ['무리한', '무리하게', '성급한', '성급히', '섣부른', '섣불리', '과도한', '과한']
const TRAILING_WINDOW = 12
const LEADING_WINDOW = 5

function affirms(text: string, keyword: string): boolean {
  let from = 0
  while (true) {
    const at = text.indexOf(keyword, from)
    if (at < 0) return false
    const trailing = text.slice(at + keyword.length, at + keyword.length + TRAILING_WINDOW)
    const leading = text.slice(Math.max(0, at - LEADING_WINDOW), at)
    const negated =
      TRAILING_NEGATORS.some((neg) => trailing.includes(neg)) ||
      LEADING_NEGATORS.some((neg) => leading.includes(neg))
    if (!negated) return true
    from = at + keyword.length
  }
}

export type VerdictDirectionCheck = {
  mismatch: boolean
  /** The direction the text reads as, when it affirms exactly one other side. */
  textDirection: VerdictDirection | null
}

export function verdictDirectionMismatch(verdict: {
  verdict_line: string
  direction: VerdictDirection
}): VerdictDirectionCheck {
  const text = verdict.verdict_line
  const affirmed: Record<VerdictDirection, boolean> = {
    advance: VERDICT_DIRECTION_KEYWORDS.advance.some((kw) => affirms(text, kw)),
    hold: VERDICT_DIRECTION_KEYWORDS.hold.some((kw) => affirms(text, kw)),
    release: VERDICT_DIRECTION_KEYWORDS.release.some((kw) => affirms(text, kw)),
  }

  if (affirmed[verdict.direction]) return { mismatch: false, textDirection: null }
  const others = VERDICT_DIRECTIONS.filter(
    (direction) => direction !== verdict.direction && affirmed[direction],
  )
  if (others.length === 0) return { mismatch: false, textDirection: null }
  return { mismatch: true, textDirection: others.length === 1 ? others[0]! : null }
}
