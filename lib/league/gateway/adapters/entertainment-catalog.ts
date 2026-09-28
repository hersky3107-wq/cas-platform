/**
 * SHOW:{kind}:{venue}:{event}:{subject}:{resolvesAtMs}
 * Subject is URI-encoded so titles may contain spaces, never raw colons.
 */

import type { ShowKind, ShowMetric } from '../../entertainment/slate'

export type ShowParts = {
  kind: ShowKind
  venue: string
  event: string
  subject: string
  resolvesAtMs: number
}

const KINDS: readonly ShowKind[] = ['boxoffice', 'chart', 'award', 'stream']

export function isShowKind(value: string): value is ShowKind {
  return (KINDS as readonly string[]).includes(value)
}

export function encodeEntertainmentInstrument(parts: ShowParts): string {
  return [
    'SHOW',
    parts.kind,
    parts.venue,
    parts.event,
    encodeURIComponent(parts.subject),
    String(parts.resolvesAtMs),
  ].join(':')
}

export function decodeEntertainmentInstrument(instrument: string | null | undefined): ShowParts | null {
  if (!instrument) return null
  const parts = instrument.split(':')
  if (parts.length !== 6 || parts[0] !== 'SHOW') return null
  const kind = parts[1] ?? ''
  const venue = parts[2] ?? ''
  const event = parts[3] ?? ''
  const subject = decodeURIComponent(parts[4] ?? '')
  const resolvesAtMs = Number(parts[5])
  if (!isShowKind(kind) || !venue || !event || !subject) return null
  if (!Number.isFinite(resolvesAtMs) || resolvesAtMs <= 0) return null
  return { kind, venue, event, subject, resolvesAtMs }
}

export function instrumentForMetric(row: ShowMetric): string | null {
  const resolvesAtMs = Date.parse(row.resolvesAtIso)
  if (!Number.isFinite(resolvesAtMs)) return null
  return encodeEntertainmentInstrument({
    kind: row.kind,
    venue: row.venue,
    event: row.event,
    subject: row.subject,
    resolvesAtMs,
  })
}

export function admissionsThreshold(event: string): number | null {
  const match = /^admissions_(\d+)$/.exec(event)
  if (!match) return null
  const n = Number(match[1])
  return Number.isFinite(n) && n > 0 ? n : null
}

/** Theatrical admissions: 10만–5,000만. Below that is noise; above that is not a real Korean run. */
export const MIN_CUSTOM_ADMISSIONS = 100_000
export const MAX_CUSTOM_ADMISSIONS = 50_000_000
const ADMISSIONS_STEP = 10_000

export function sanitizeAdmissionsThreshold(raw: number): number | null {
  if (!Number.isFinite(raw) || raw <= 0) return null
  const rounded = Math.round(raw / ADMISSIONS_STEP) * ADMISSIONS_STEP
  if (rounded < MIN_CUSTOM_ADMISSIONS || rounded > MAX_CUSTOM_ADMISSIONS) return null
  return rounded
}

/**
 * User-typed box-office N: "200만", "200만 넘길까", "1.5억", "2,000,000".
 * Returns sanitized admissions or null (no number / absurd).
 */
export function parseAdmissionsThreshold(text: string): number | null {
  const compact = text.replace(/,/g, '')
  const eok = /(\d+(?:\.\d+)?)\s*억/.exec(compact)
  if (eok) return sanitizeAdmissionsThreshold(Number(eok[1]) * 100_000_000)
  const man = /(\d+(?:\.\d+)?)\s*만/.exec(compact)
  if (man) return sanitizeAdmissionsThreshold(Number(man[1]) * 10_000)
  const plain = /(?<!\d)(\d{6,8})(?!\d)/.exec(compact.replace(/\s+/g, ''))
  if (plain) return sanitizeAdmissionsThreshold(Number(plain[1]))
  return null
}

export function admissionsEventFor(n: number): string {
  return `admissions_${n}`
}

export function propositionKindForShow(parts: ShowParts): 'binary_subject_outcome' | 'binary_threshold' {
  return admissionsThreshold(parts.event) != null ? 'binary_threshold' : 'binary_subject_outcome'
}

const VENUE_KO: Record<string, string> = {
  KR: '한국',
  US: '미국',
  JP: '일본',
  melon: '멜론',
  billboard: '빌보드 Hot 100',
  circle: '써클',
  oricon: '오리콘',
  tga: '게임 어워드',
  oscars: '오스카',
  grammy: '그래미',
  emmy: '에미',
  baeksang: '백상',
  blue_dragon: '청룡',
  netflix: '넷플릭스',
}

const EVENT_KO: Record<string, string> = {
  opening_1: '개봉 첫 주말 1위',
  weekly_1: '주간 1위',
  game_of_the_year: '올해의 게임',
  best_picture: '작품상',
  global_1: '글로벌 1위',
}

export function showEventLabel(parts: ShowParts, locale: 'ko' | 'en'): string {
  if (parts.event === 'opening_1') {
    return locale === 'ko' ? '개봉 첫 주말 박스오피스 1위' : 'opening-weekend box office #1'
  }
  const threshold = admissionsThreshold(parts.event)
  if (threshold != null) {
    const man = Math.round(threshold / 10_000)
    return locale === 'ko' ? `누적 ${man}만 관객 돌파` : `reach ${threshold.toLocaleString('en-US')} admissions`
  }
  if (parts.event === 'weekly_1') {
    const chart = VENUE_KO[parts.venue] ?? parts.venue
    return locale === 'ko' ? `${chart} 주간 1위` : `${parts.venue} weekly #1`
  }
  if (parts.kind === 'award') {
    const show = VENUE_KO[parts.venue] ?? parts.venue
    const prize = EVENT_KO[parts.event] ?? parts.event
    return locale === 'ko' ? `${show} ${prize} 수상` : `win ${prize} at ${show}`
  }
  if (parts.event === 'global_1') return locale === 'ko' ? '넷플릭스 글로벌 1위' : 'Netflix global #1'
  return EVENT_KO[parts.event] ?? parts.event
}

export function showChipLabel(row: ShowMetric): string {
  const resolvesAtMs = Date.parse(row.resolvesAtIso)
  const parts: ShowParts = {
    kind: row.kind,
    venue: row.venue,
    event: row.event,
    subject: row.subject,
    resolvesAtMs: Number.isFinite(resolvesAtMs) ? resolvesAtMs : 0,
  }
  return `${row.subject} · ${showEventLabel(parts, 'ko')}`
}

export function formatShowProposition(parts: ShowParts): string {
  return `${parts.subject} ${showEventLabel(parts, 'ko')}`
}

export function showResolutionRule(parts: ShowParts): string {
  if (parts.kind === 'boxoffice' && parts.venue === 'KR') {
    return 'Graded from KOBIS (Korean Film Council) weekend box office: rank 1 or cumulative admissions versus the stated threshold. Not a review score.'
  }
  if (parts.kind === 'award') {
    return 'Graded from the ceremony\'s official winner announcement. Nomination is not a win. Operator confirms the published result.'
  }
  if (parts.kind === 'chart') {
    return 'Graded from the named chart\'s published weekly #1 for the dated week. Operator confirms the published chart.'
  }
  return 'Graded from the named official public list. Subjective quality is not a result.'
}
