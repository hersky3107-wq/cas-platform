/**
 * Open-world tech claims. The 7-company catalog is optional labeling only.
 * A prompt becomes one yes/no occurrence: subject, event, object, deadline
 * inside 3 months, and a verification class.
 */

import type { UiHorizon } from '../../horizon'
import type { LeagueLocale } from '../../i18n/locales'
import { horizonForResolveDate } from './tech-compose'
import { companyById, TECH_COMPANIES, type TechCompany } from './tech-catalog'
import type { RefusalCode } from '../types'

export const TECH_EVENTS = ['launch', 'announce', 'ship', 'release', 'approve', 'file', 'acquire', 'publish'] as const
export type TechEventId = (typeof TECH_EVENTS)[number]

export const TECH_VERIFICATIONS = [
  'official_newsroom',
  'regulatory_filing',
  'store_listing',
  'major_outlets',
] as const
export type TechVerificationId = (typeof TECH_VERIFICATIONS)[number]

export type OpenTechClaim = {
  subject: string
  subjectLabel: string
  event: TechEventId
  object: string
  deadline: string
  /** Civil date the window opens (compose / parse time). Events before this do not count. */
  windowStart: string
  horizon: UiHorizon
  verification: TechVerificationId
  instrument: string
  korean: boolean
  catalogCompanyId: string | null
}

export type TechParseResult =
  | { ok: true; claim: OpenTechClaim }
  | { ok: false; code: RefusalCode }

const MAX_HORIZON_DAYS = 92

const PRICE =
  /주가|종가|실적|매출|어닝|가이던스|\bearnings\b|\beps\b|stock price|share price|close higher|주식이?\s*(?:오르|내리|상승|하락)/i
const SUBJECTIVE = /흥행|혁신적|잘\s*팔|대박|명작|좋을까|성공할|innovative|sell well|hit product|blockbuster/i
const RUMOR = /루머|소문|rumou?r|카더라|unconfirmed/i

const KO_VERB: Record<string, TechEventId> = {
  발표: 'announce',
  공개: 'publish',
  출시: 'release',
  출하: 'ship',
  발사: 'launch',
  승인: 'approve',
  제출: 'file',
  신청: 'file',
  인수: 'acquire',
}

const EN_VERB =
  /\b(launch|announce|ship|release|approve|file|acquire|publish)\b/i

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8,
  sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11,
  dec: 12, december: 12,
}

const EVENT_EN: Record<TechEventId, string> = {
  launch: 'launch',
  announce: 'announce',
  ship: 'ship',
  release: 'release',
  approve: 'approve',
  file: 'file',
  acquire: 'acquire',
  publish: 'publish',
}

const EVENT_EN_3SG: Record<TechEventId, string> = {
  launch: 'launches',
  announce: 'announces',
  ship: 'ships',
  release: 'releases',
  approve: 'approves',
  file: 'files',
  acquire: 'acquires',
  publish: 'publishes',
}

const EVENT_KO: Record<TechEventId, string> = {
  launch: '발사',
  announce: '발표',
  ship: '출하',
  release: '출시',
  approve: '승인',
  file: '제출',
  acquire: '인수',
  publish: '공개',
}

const EVENT_JA: Record<TechEventId, string> = {
  launch: '打ち上げ',
  announce: '発表',
  ship: '出荷',
  release: 'リリース',
  approve: '承認',
  file: '提出',
  acquire: '買収',
  publish: '公開',
}

const EVENT_ZH: Record<TechEventId, string> = {
  launch: '發射',
  announce: '宣佈',
  ship: '出貨',
  release: '發佈',
  approve: '批准',
  file: '提交',
  acquire: '收購',
  publish: '公開',
}

const EVENT_FR: Record<TechEventId, string> = {
  launch: 'lancer',
  announce: 'annoncer',
  ship: 'expédier',
  release: 'sortir',
  approve: 'approuver',
  file: 'déposer',
  acquire: 'acquérir',
  publish: 'publier',
}

const EVENT_ES: Record<TechEventId, string> = {
  launch: 'lanzar',
  announce: 'anunciar',
  ship: 'enviar',
  release: 'lanzar',
  approve: 'aprobar',
  file: 'presentar',
  acquire: 'adquirir',
  publish: 'publicar',
}

const EVENT_PT: Record<TechEventId, string> = {
  launch: 'lançar',
  announce: 'anunciar',
  ship: 'enviar',
  release: 'lançar',
  approve: 'aprovar',
  file: 'submeter',
  acquire: 'adquirir',
  publish: 'publicar',
}

const EVENT_AR: Record<TechEventId, string> = {
  launch: 'إطلاق',
  announce: 'إعلان',
  ship: 'شحن',
  release: 'إصدار',
  approve: 'الموافقة على',
  file: 'تقديم',
  acquire: 'الاستحواذ على',
  publish: 'نشر',
}

const VERIFY_EN: Record<TechVerificationId, string> = {
  official_newsroom: 'an official newsroom or company blog',
  regulatory_filing: 'a regulatory filing',
  store_listing: 'a store listing',
  major_outlets: 'at least two major outlets',
}

function isoDate(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  const dt = new Date(Date.UTC(year, month - 1, day))
  if (dt.getUTCFullYear() !== year || dt.getUTCMonth() !== month - 1 || dt.getUTCDate() !== day) return null
  return dt.toISOString().slice(0, 10)
}

function endOfMonth(year: number, month: number): string | null {
  const dt = new Date(Date.UTC(year, month, 0))
  return isoDate(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate())
}

function addDays(ymd: string, days: number): string {
  const ms = Date.parse(`${ymd}T00:00:00.000Z`) + days * 86_400_000
  return new Date(ms).toISOString().slice(0, 10)
}

export function todayYmd(now: Date): string {
  return now.toISOString().slice(0, 10)
}

function slug(raw: string): string {
  const s = raw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^\w\uac00-\ud7a3]+/g, '')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
  return (s || 'item').slice(0, 40)
}

export function isTechEvent(raw: string | null | undefined): raw is TechEventId {
  return !!raw && (TECH_EVENTS as readonly string[]).includes(raw)
}

export function isTechVerification(raw: string | null | undefined): raw is TechVerificationId {
  return !!raw && (TECH_VERIFICATIONS as readonly string[]).includes(raw)
}

export function catalogCompanyForText(text: string): TechCompany | null {
  const compact = text.toLowerCase().replace(/\s+/g, '')
  if (!compact) return null
  for (const company of TECH_COMPANIES) {
    if (company.id.toLowerCase() === compact) return company
    if (company.synonyms.some((s) => s.replace(/\s+/g, '') === compact)) return company
    if (company.synonyms.some((s) => compact.includes(s.replace(/\s+/g, '')) && s.replace(/\s+/g, '').length >= 2)) {
      return company
    }
  }
  return null
}

export function encodeOpenTechInstrument(claim: {
  subject: string
  event: TechEventId
  object: string
  deadline: string
  verification: TechVerificationId
}): string {
  const date = claim.deadline.replace(/-/g, '')
  return `TECH:OPEN:${slug(claim.subject)}:${claim.event}:${slug(claim.object)}:${date}:${claim.verification}`
}

export function decodeOpenTechInstrument(instrument: string): {
  subjectSlug: string
  event: TechEventId
  objectSlug: string
  deadline: string
  verification: TechVerificationId
} | null {
  const parts = instrument.split(':')
  if (parts.length !== 7 || parts[0] !== 'TECH' || parts[1] !== 'OPEN') return null
  const [, , subjectSlug, event, objectSlug, ymd, verification] = parts
  if (!subjectSlug || !objectSlug || !isTechEvent(event) || !isTechVerification(verification)) return null
  if (!/^\d{8}$/.test(ymd)) return null
  const deadline = `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`
  if (!isoDate(Number(ymd.slice(0, 4)), Number(ymd.slice(4, 6)), Number(ymd.slice(6, 8)))) return null
  return { subjectSlug, event, objectSlug, deadline, verification }
}

function defaultVerification(event: TechEventId, raw: string): TechVerificationId {
  if (/뉴스룸|newsroom|공식\s*블로그|company blog/i.test(raw)) return 'official_newsroom'
  if (/공시|filing|8-k|\bsec\b|규제/i.test(raw)) return 'regulatory_filing'
  if (/스토어|app store|play store|store listing/i.test(raw)) return 'store_listing'
  if (/언론|로이터|reuters|major outlet/i.test(raw)) return 'major_outlets'
  if (event === 'approve' || event === 'file' || event === 'acquire') return 'regulatory_filing'
  if (event === 'release' || event === 'ship') return 'store_listing'
  return 'official_newsroom'
}

function boundDeadline(
  deadline: string,
  now: Date,
): { ok: false; code: RefusalCode } | { ok: true; deadline: string; horizon: UiHorizon } {
  const today = todayYmd(now)
  if (deadline < today) return { ok: false, code: 'already_resolved' }
  const days = Math.ceil((Date.parse(`${deadline}T23:59:59.999Z`) - now.getTime()) / 86_400_000)
  if (days > MAX_HORIZON_DAYS) return { ok: false, code: 'deadline_too_far' }
  return { ok: true, deadline, horizon: horizonForResolveDate(deadline, now) }
}

function monthDay(text: string, now: Date, exclusive: boolean): string | null {
  const iso = text.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/)
  if (iso) {
    const ymd = isoDate(Number(iso[1]), Number(iso[2]), Number(iso[3]))
    return ymd && exclusive ? addDays(ymd, -1) : ymd
  }
  const named = text.match(
    /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(20\d{2}))?/i,
  )
  if (!named) return null
  const month = MONTHS[named[1].toLowerCase()]
  const day = Number(named[2])
  let year = named[3] ? Number(named[3]) : now.getUTCFullYear()
  let ymd = isoDate(year, month, day)
  if (!ymd) return null
  if (!named[3] && ymd < todayYmd(now)) {
    year += 1
    ymd = isoDate(year, month, day)
  }
  if (!ymd) return null
  return exclusive ? addDays(ymd, -1) : ymd
}

function koreanDeadline(rest: string, now: Date): { deadline: string; rest: string } | null {
  const year = now.getUTCFullYear()
  const month = now.getUTCMonth() + 1
  let deadline: string | null = null
  let cleaned = rest
  const ymd = rest.match(/(20\d{2})\s*년\s*(\d{1,2})\s*월/)
  if (ymd) {
    deadline = endOfMonth(Number(ymd[1]), Number(ymd[2]))
    cleaned = rest.replace(ymd[0], ' ')
  } else if (/이번\s*달/.test(rest)) {
    deadline = endOfMonth(year, month)
    cleaned = rest.replace(/이번\s*달\s*(?:안|까지|중)?에?/, ' ')
  } else if (/이번\s*주/.test(rest)) {
    deadline = addDays(todayYmd(now), 6)
    cleaned = rest.replace(/이번\s*주\s*(?:안|까지|중)?에?/, ' ')
  } else if (/오늘/.test(rest)) {
    deadline = todayYmd(now)
    cleaned = rest.replace(/오늘\s*(?:안|까지)?/, ' ')
  } else if (/내일/.test(rest)) {
    deadline = addDays(todayYmd(now), 1)
    cleaned = rest.replace(/내일\s*(?:안|까지)?/, ' ')
  } else if (/연말/.test(rest)) {
    deadline = isoDate(year, 12, 31)
    cleaned = rest.replace(/연말\s*(?:까지|안)?에?/, ' ')
  } else {
    const mon = rest.match(/(\d{1,2})\s*월\s*(?:안|까지|중)/)
    if (mon) {
      let y = year
      const m = Number(mon[1])
      let end = endOfMonth(y, m)
      if (end && end < todayYmd(now)) end = endOfMonth(y + 1, m)
      deadline = end
      cleaned = rest.replace(mon[0], ' ')
    }
  }
  if (!deadline) return null
  return { deadline, rest: cleaned }
}

function finish(
  raw: string,
  subjectRaw: string,
  event: TechEventId,
  objectRaw: string,
  deadline: string,
  now: Date,
  korean: boolean,
): TechParseResult {
  const bounded = boundDeadline(deadline, now)
  if (!bounded.ok) return bounded
  const object = objectRaw.replace(/\bagain\b/gi, ' ').replace(/[?.!]+$/g, '').replace(/\s+/g, ' ').trim()
  if (!subjectRaw.trim() || object.length < 1) return { ok: false, code: 'vague_claim' }
  const catalog = catalogCompanyForText(subjectRaw) ?? catalogCompanyForText(raw)
  const subjectLabel = catalog ? (korean ? catalog.label_ko : catalog.label_en) : subjectRaw.trim()
  const subjectKey = catalog?.label_en ?? subjectRaw.trim()
  const verification = defaultVerification(event, raw)
  const instrument = encodeOpenTechInstrument({
    subject: subjectKey,
    event,
    object,
    deadline: bounded.deadline,
    verification,
  })
  return {
    ok: true,
    claim: {
      subject: subjectKey,
      subjectLabel,
      event,
      object,
      deadline: bounded.deadline,
      horizon: bounded.horizon,
      verification,
      instrument,
      korean,
      catalogCompanyId: catalog?.id ?? null,
      windowStart: todayYmd(now),
    },
  }
}

function parseKorean(raw: string, now: Date): TechParseResult | null {
  const m = raw.match(/^(.{1,40}?)(?:이|가)\s+(.+)$/)
  if (!m) return null
  const subject = m[1].trim()
  const dated = koreanDeadline(m[2], now)
  if (!dated) return null
  const verb = dated.rest.match(/(.+?)(?:을|를)\s*(발표|공개|출시|출하|발사|승인|제출|신청|인수)/)
  if (!verb) return null
  const event = KO_VERB[verb[2]]
  if (!event) return null
  return finish(raw, subject, event, verb[1], dated.deadline, now, true)
}

function parseEnglish(raw: string, now: Date): TechParseResult | null {
  const m = raw.match(
    /^will\s+(.+?)\s+(launch|announce|ship|release|approve|file|acquire|publish)\s+(.+?)\s+(before|by)\s+(.+?)\s*\??$/i,
  )
  if (!m) return null
  const exclusive = m[4].toLowerCase() === 'before'
  const deadline = monthDay(m[5], now, exclusive)
  if (!deadline) return null
  const event = m[2].toLowerCase() as TechEventId
  return finish(raw, m[1].trim(), event, m[3], deadline, now, false)
}

export function parseOpenTechPrompt(raw: string, now: Date = new Date()): TechParseResult {
  const text = raw.trim()
  if (!text) return { ok: false, code: 'vague_claim' }
  if (PRICE.test(text)) return { ok: false, code: 'price_or_earnings' }
  if (SUBJECTIVE.test(text)) return { ok: false, code: 'subjective_claim' }
  if (RUMOR.test(text)) return { ok: false, code: 'rumor_only' }
  if (/[가-힣]/.test(text)) {
    const ko = parseKorean(text, now)
    if (ko) return ko
  }
  if (EN_VERB.test(text)) {
    const en = parseEnglish(text, now)
    if (en) return en
  }
  return { ok: false, code: 'vague_claim' }
}

export function formatOpenTechProposition(claim: OpenTechClaim): string {
  if (claim.korean) {
    return `${claim.subjectLabel}, ${claim.windowStart} 이후 ${claim.deadline}까지 ${claim.object}를 ${EVENT_KO[claim.event]}할까?`
  }
  return `Will ${claim.subjectLabel} ${EVENT_EN[claim.event]} ${claim.object} after ${claim.windowStart} and by ${claim.deadline}?`
}

export function formatOpenTechPropositionAllLocales(claim: OpenTechClaim): Record<LeagueLocale, string> {
  const s = claim.subjectLabel
  const o = claim.object
  const open = claim.windowStart
  const by = claim.deadline
  return {
    en: `Will ${s} ${EVENT_EN[claim.event]} ${o} after ${open} and by ${by}?`,
    ko: `${s}, ${open} 이후 ${by}까지 ${o}를 ${EVENT_KO[claim.event]}할까?`,
    ja: `${s}は${open}以降${by}までに${o}を${EVENT_JA[claim.event]}するか？`,
    'zh-TW': `${s}會在${open}之後到${by}之前${EVENT_ZH[claim.event]}${o}嗎？`,
    fr: `${s} va-t-il ${EVENT_FR[claim.event]} ${o} après le ${open} et d'ici le ${by} ?`,
    es: `¿${s} va a ${EVENT_ES[claim.event]} ${o} después del ${open} y para el ${by}?`,
    pt: `O ${s} vai ${EVENT_PT[claim.event]} ${o} após ${open} e até ${by}?`,
    ar: `هل ${s} ${EVENT_AR[claim.event]} ${o} بعد ${open} وبحلول ${by}؟`,
  }
}

export function openTechResolutionRule(claim: OpenTechClaim): string {
  return (
    `Occurred if ${claim.subjectLabel} ${EVENT_EN_3SG[claim.event]} ${claim.object} after ${claim.windowStart} and on or before ${claim.deadline}. ` +
    `Events dated before ${claim.windowStart} do not count. ` +
    `Verification: ${VERIFY_EN[claim.verification]}. Graded from that source class — never from a share price or an AI leaderboard.`
  )
}

export function openTechResolutionRuleKo(claim: OpenTechClaim): string {
  return (
    `${claim.subjectLabel}가 ${claim.windowStart} 이후 ${claim.deadline}까지 ${claim.object}를 ${EVENT_KO[claim.event]}하면 실현. ` +
    `${claim.windowStart} 이전 날짜의 사건은 세지 않는다. ` +
    `확인: ${VERIFY_EN[claim.verification]}. 주가나 AI 순위가 아니라 그 출처로만 판정.`
  )
}

export function buildOpenTechRankedRoundInput(
  instrument: string,
  now: Date = new Date(),
  locale: 'ko' | 'en' = 'en',
) {
  const claim = claimFromOpenInstrument(instrument, '', now)
  if (!claim) return null
  const localized = { ...claim, korean: locale === 'ko' }
  return {
    proposition_text: formatOpenTechProposition(localized),
    category: 'tech' as const,
    instrument: localized.instrument,
    horizon: localized.horizon,
    resolution_rule: openTechResolutionRule(localized),
    resolves_at: `${localized.deadline}T23:59:59.999Z`,
    item_type: 'ranked' as const,
    cache_key: `tech|${localized.instrument}|${localized.windowStart}|${localized.deadline}`,
    proposition_kind: 'binary_subject_outcome' as const,
    subject_label: localized.subjectLabel,
    observation_shape: 'occurrence' as const,
    propositions: formatOpenTechPropositionAllLocales(localized),
  }
}

export function claimFromOpenInstrument(
  instrument: string,
  label: string,
  now: Date,
): OpenTechClaim | null {
  const decoded = decodeOpenTechInstrument(instrument)
  if (!decoded) return null
  const catalog = catalogCompanyForText(decoded.subjectSlug) ?? companyById(decoded.subjectSlug.toUpperCase())
  const subjectLabel = label.trim() || catalog?.label_en || decoded.subjectSlug
  return {
    subject: catalog?.label_en ?? decoded.subjectSlug,
    subjectLabel,
    event: decoded.event,
    object: decoded.objectSlug.replace(/_/g, ' '),
    deadline: decoded.deadline,
    windowStart: todayYmd(now),
    horizon: horizonForResolveDate(decoded.deadline, now),
    verification: decoded.verification,
    instrument,
    korean: /[가-힣]/.test(label),
    catalogCompanyId: catalog?.id ?? null,
  }
}
