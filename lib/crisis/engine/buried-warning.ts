import { buriedWarningCaption } from '../i18n/outcomes'
import type { EngineCard } from './schema'
import type { SearchItem } from './search-items'
import { urlDate } from './search-items'
import type { RosterSlot } from './roster'
import type { Draft } from './hunter-rules'

/** Kinds the hunt treats as a named fragility. Aliases collapse onto these. */
export const BURIED_KINDS = ['dam', 'plant', 'camp', 'levee', 'bridge', 'hospital', 'fault', 'volcano'] as const

const KIND_ALIAS: Record<string, (typeof BURIED_KINDS)[number]> = {
  dam: 'dam',
  reservoir: 'dam',
  plant: 'plant',
  nuclear_plant: 'plant',
  power_plant: 'plant',
  chemical_plant: 'plant',
  camp: 'camp',
  refugee_camp: 'camp',
  idp_camp: 'camp',
  levee: 'levee',
  dyke: 'levee',
  dike: 'levee',
  bridge: 'bridge',
  hospital: 'hospital',
  fault: 'fault',
  volcano: 'volcano',
}

/** Dams and levees first so a long hospital list cannot crowd out the Derna-style target. */
const KIND_RANK: Record<string, number> = {
  dam: 0,
  levee: 1,
  plant: 2,
  camp: 3,
  bridge: 4,
  hospital: 5,
  fault: 6,
  volcano: 7,
}

/** Extra searches stay inside the region cap. Four named sites is the reservation budget. */
export const MAX_BURIED_ENTITIES = 4

/** Output reservation for the buried search. Reasoning stays off, so this is the whole budget. */
export const BURIED_SEARCH_TOKENS = 400

export const BURIED_BOOST = 0.15

const FIVE_YEARS_MS = 5 * 365.25 * 24 * 60 * 60 * 1000
const FUTURE_SLACK_MS = 2 * 24 * 60 * 60 * 1000

const GENERIC = new Set([
  'dam', 'dams', 'plant', 'plants', 'camp', 'camps', 'levee', 'levees', 'bridge', 'bridges',
  'hospital', 'hospitals', 'fault', 'faults', 'volcano', 'volcanoes', 'reservoir', 'lake',
  'river', 'the', 'and', 'of', 'de', 'al', 'baraj', 'baraji', 'nukleer', 'nuclear',
])

/** A specific defect, risk, delay, failure, or warning — not the word "audit" or "inspection" alone. */
const SPECIFIC_WARNING_RE =
  /\b(warn(?:ed|s|ing)?|defect|delay(?:ed|s)?|risk|unsafe|crack|neglect(?:ed)?|complaint|lawsuit|overdue|deficient|deficiency|hazard|danger|failure|collapse|leak|seepage|overtop|spill|breach|unfit|condemned|구조적|위험|결함|지연)\b|uyarı|tehlike|kusur|gecik|şikayet|sikayet|çatlak|catlak|ihmal|خطر|تأخير|عيب|شكوى|تحذير|අවදානම|අනතුර|ஆபத்து|எச்சரிக்கை/i

const DUTY_TABLE_RE =
  /\b(sorumlu kurum|yıllar sorumlu|mevcut faaliyet|faaliyet yıllar|izleme ve denetim|görevleri|duty|duties|responsible institution|monitoring table|koruma planı|havza koruma|master plan|action plan|yönetim plan)\b/i

const PLAN_RE = /\b(planı|planı_|havza koruma|master plan|action plan|koruma plan|yönetim plan|basin plan|protection plan)\b|\.pdf\b/i
const TABLE_RE = /\b(yıllar|tablo|table|schedule of|sorumlu kurumlar|faaliyet yıllar)\b/i

const LOCAL_PAIR: Record<string, [string, string]> = {
  tr: ['güvenlik denetim raporu risk', 'bakım gecikmesi şikayet dava'],
  ar: ['تقرير تفتيش سلامة خطر', 'تأخير الصيانة شكوى'],
  si: ['ආරක්ෂක විගණන වාර්තාව අවදානම', 'නඩත්තු ප්‍රමාදය පැමිණිල්ල'],
  ta: ['பாதுகாப்பு தணிக்கை அறிக்கை ஆபத்து', 'பராமரிப்பு தாமதம் புகார்'],
  ko: ['안전 감사 보고서 위험', '정비 지연 민원'],
  ja: ['安全監査 検査報告 リスク', '整備遅延 苦情'],
  zh: ['安全审计 检查报告 风险', '维修延误 投诉'],
  fr: ['rapport audit sécurité risque', 'retard maintenance plainte'],
  es: ['informe auditoría seguridad riesgo', 'retraso mantenimiento queja'],
  pt: ['relatório auditoria segurança risco', 'atraso manutenção queixa'],
  ru: ['отчёт проверка безопасность риск', 'задержка ремонта жалоба'],
  hi: ['सुरक्षा ऑडिट रिपोर्ट जोखिम', 'रखरखाव देरी शिकायत'],
  ur: ['حفاظتی آڈٹ رپورٹ خطرہ', 'مرمت میں تاخیر شکایت'],
  fa: ['گزارش بازرسی ایمنی خطر', 'تأخیر نگهداری شکایت'],
  de: ['Sicherheitsprüfung Bericht Risiko', 'Wartungsverzug Beschwerde'],
  bn: ['নিরাপত্তা নিরীক্ষা ঝুঁকি', 'রক্ষণাবেক্ষণ বিলম্ব অভিযোগ'],
}

export interface BuriedTarget {
  name: string
  kind: string
}

export interface BuriedQuery {
  entity: string
  language: string
  query: string
}

export type BuriedDocKind = 'audit' | 'inspection' | 'paper' | 'news' | 'complaint' | 'court' | 'plan' | 'table'

export interface BuriedWarning {
  type: 'buried_warning'
  entity: string
  date: string
  language: string
  title: string
  url: string
  statement: string
  document: BuriedDocKind
  specific: boolean
  line: string
}

export function fold(value: string): string {
  return value.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '')
}

export function topHazard(card: Pick<EngineCard, 'components'>): string {
  const ranked = [...card.components].sort((a, b) => b.value - a.value)
  return ranked.find((row) => row.value > 0)?.key ?? ranked[0]?.key ?? 'hazard'
}

export function buriedTargets(card: Pick<EngineCard, 'fragility' | 'components'>): { entities: BuriedTarget[]; hazard: string } {
  const ranked: Array<BuriedTarget & { rank: number }> = []
  for (const item of card.fragility) {
    const kind = KIND_ALIAS[item.kind]
    if (!kind || !item.name.trim()) continue
    ranked.push({ name: item.name.trim(), kind, rank: KIND_RANK[kind] ?? 9 })
  }
  ranked.sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name))
  const seen = new Set<string>()
  const entities: BuriedTarget[] = []
  for (const item of ranked) {
    const key = fold(item.name)
    if (seen.has(key)) continue
    seen.add(key)
    entities.push({ name: item.name, kind: item.kind })
    if (entities.length >= MAX_BURIED_ENTITIES) break
  }
  return { entities, hazard: topHazard(card) }
}

export function yearSpan(now: Date): string {
  const end = now.getUTCFullYear()
  return `${end - 5}..${end}`
}

function localPair(entity: string, hazard: string, language: string, years: string): [string, string] {
  const pair = LOCAL_PAIR[language]
  if (pair) return [`${entity} ${hazard} ${pair[0]} ${years}`, `${entity} ${pair[1]} ${years}`]
  return [
    `${entity} ${hazard} ${language} safety audit inspection risk ${years}`,
    `${entity} ${language} maintenance delay complaint ${years}`,
  ]
}

export function fallbackBuriedQueries(entity: string, hazard: string, languages: string[], now: Date): BuriedQuery[] {
  const local = languages.find((code) => code !== 'en') ?? 'en'
  const years = yearSpan(now)
  const pair = localPair(entity, hazard, local, years)
  return [
    { entity, language: local, query: pair[0] },
    { entity, language: local, query: pair[1] },
    { entity, language: 'en', query: `${entity} ${hazard} safety audit inspection report maintenance delay complaint court ${years}` },
  ]
}

export function parseBuriedQueries(parsed: unknown): BuriedQuery[] {
  const root = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null
  const rows = Array.isArray(parsed) ? parsed : Array.isArray(root?.queries) ? root.queries : []
  const out: BuriedQuery[] = []
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue
    const record = row as Record<string, unknown>
    const entity = typeof record.entity === 'string' ? record.entity.trim() : ''
    const language = typeof record.language === 'string' ? record.language.trim().toLowerCase() : ''
    const query = typeof record.query === 'string' ? record.query.trim() : ''
    if (!entity || !language || !query) continue
    out.push({ entity, language, query })
  }
  return out
}

function sameEntity(a: string, b: string): boolean {
  const left = fold(a)
  const right = fold(b)
  if (!left || !right) return false
  return left === right || left.includes(right) || right.includes(left)
}

/** Exactly two local-language queries and one English query per named entity. */
export function ensureBuriedQueries(
  entities: BuriedTarget[],
  hazard: string,
  languages: string[],
  parsed: BuriedQuery[],
  now: Date,
): BuriedQuery[] {
  const local = languages.find((code) => code !== 'en') ?? 'en'
  const out: BuriedQuery[] = []
  for (const entity of entities) {
    const mine = parsed.filter((query) => sameEntity(query.entity, entity.name) || sameEntity(query.query, entity.name))
    const localQs = mine.filter((query) => query.language === local).slice(0, 2)
    const enQs = mine.filter((query) => query.language === 'en').slice(0, 1)
    const fill = fallbackBuriedQueries(entity.name, hazard, languages, now)
    for (const query of fill.filter((row) => row.language === local)) {
      if (localQs.length >= 2) break
      localQs.push(query)
    }
    if (!enQs.length) enQs.push(fill.find((row) => row.language === 'en')!)
    out.push(...localQs.slice(0, 2), ...enQs.slice(0, 1))
  }
  return out
}

export function entityNamed(text: string, entity: string): boolean {
  const hay = fold(text)
  const full = fold(entity.trim())
  if (full.length >= 3 && hay.includes(full)) return true
  const tokens = full.split(/[^a-z0-9]+/).filter((token) => token.length >= 4 && !GENERIC.has(token))
  if (!tokens.length) return false
  return tokens.every((token) => hay.includes(token))
}

export function detectLanguage(text: string, queries: BuriedQuery[], entity = ''): string {
  if (/[\u0600-\u06FF]/.test(text)) return 'ar'
  if (/[\u0D80-\u0DFF]/.test(text)) return 'si'
  if (/[\u0B80-\u0BFF]/.test(text)) return 'ta'
  if (/[\uAC00-\uD7AF]/.test(text)) return 'ko'
  if (/[\u0400-\u04FF]/.test(text)) return 'ru'
  if (/[\u0900-\u097F]/.test(text)) return 'hi'
  if (/[çğıöşüÇĞİÖŞÜ]/.test(text)) return 'tr'
  const folded = fold(text)
  const skip = new Set(fold(entity).split(/[^a-z0-9]+/).filter(Boolean))
  for (const query of queries) {
    if (query.language === 'en') continue
    const tokens = fold(query.query)
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length >= 5 && !GENERIC.has(token) && !/^\d+$/.test(token) && !skip.has(token))
    if (tokens.some((token) => folded.includes(token))) return query.language
  }
  return 'en'
}

export function warningDocument(text: string, url = ''): BuriedDocKind {
  const folded = `${text} ${url}`.toLowerCase()
  if (TABLE_RE.test(folded) && !/\b(audit|inspection|denetim raporu|teftiş)\b/i.test(folded)) return 'table'
  if (PLAN_RE.test(folded) && !/\b(audit|inspection|denetim raporu|teftiş)\b/i.test(folded)) return 'plan'
  if (/\b(court|lawsuit|dava|mahkeme|دعوى)\b/.test(folded)) return 'court'
  if (/\b(complaint|şikayet|sikayet|شكوى|petition)\b/.test(folded)) return 'complaint'
  if (/\b(paper|journal|geology|thesis|mühendislik|doi\.org)\b/.test(folded)) return 'paper'
  if (/\b(audit|denetim raporu|sayıştay|inspector general)\b/.test(folded)) return 'audit'
  if (/\b(inspection|teftiş|teftis|inspect)\b/.test(folded)) return 'inspection'
  return 'news'
}

export function isSpecificWarning(text: string, document: BuriedDocKind): boolean {
  if (document === 'table' || document === 'plan') return false
  if (DUTY_TABLE_RE.test(text)) return false
  return SPECIFIC_WARNING_RE.test(text)
}

function isoDay(value: string): string {
  const match = /(20\d{2})-(\d{2})-(\d{2})/.exec(value)
  if (!match) return ''
  return `${match[1]}-${match[2]}-${match[3]}`
}

function inWindow(iso: string, now: Date): boolean {
  const t = Date.parse(`${iso}T00:00:00Z`)
  if (!Number.isFinite(t)) return false
  return t >= now.getTime() - FIVE_YEARS_MS && t <= now.getTime() + FUTURE_SLACK_MS
}

function datedDay(item: SearchItem, now: Date): string | null {
  const fromUrl = urlDate(item.url)
  const fromPublished = item.undated ? '' : isoDay(item.published)
  const day = fromPublished || fromUrl
  if (!day || !inWindow(day, now)) return null
  return day
}

export function collectBuriedWarnings(
  items: SearchItem[],
  queries: BuriedQuery[],
  entities: string[],
  now: Date,
): BuriedWarning[] {
  const kept: BuriedWarning[] = []
  const seen = new Set<string>()
  for (const item of items) {
    const day = datedDay(item, now)
    if (!day) continue
    const blob = `${item.title} ${item.snippet ?? ''}`
    for (const entity of entities) {
      if (!entityNamed(blob, entity)) continue
      const document = warningDocument(blob, item.url)
      const specific = isSpecificWarning(blob, document)
      if (!specific) continue
      const key = `${fold(entity)}|${item.url}`
      if (seen.has(key)) continue
      seen.add(key)
      const title = item.title.replace(/^\[past\]\s*/, '').replace(/\s+/g, ' ').trim()
      const statement = (item.snippet || title).replace(/\s+/g, ' ').trim().slice(0, 180)
      const year = Number(day.slice(0, 4))
      kept.push({
        type: 'buried_warning',
        entity,
        date: day,
        language: detectLanguage(blob, queries, entity),
        title,
        url: item.url,
        statement,
        document,
        specific,
        line: buriedWarningCaption(year, document, day),
      })
    }
  }
  return kept
}

export function hypothesisMentions(draft: Pick<Draft, 'title' | 'mechanism' | 'entities' | 'why_humans_miss'>, entity: string): boolean {
  const blob = `${draft.title} ${draft.mechanism} ${draft.entities.join(' ')} ${draft.why_humans_miss}`
  return entityNamed(blob, entity)
}

export function attachBuriedEvidence(draft: Draft, warnings: BuriedWarning[]): void {
  for (const warning of warnings) {
    const existing = draft.evidence.find((item) => warning.url && item.url === warning.url)
    if (existing) {
      existing.type = 'buried_warning'
      existing.ref = warning.line
      existing.date = warning.date
      existing.language = warning.language
      existing.document = warning.document
      existing.specific = warning.specific
      continue
    }
    if (!hypothesisMentions(draft, warning.entity)) continue
    draft.evidence.push({
      type: 'buried_warning',
      ref: warning.line,
      ...(warning.url ? { url: warning.url } : {}),
      date: warning.date,
      language: warning.language,
      document: warning.document,
      specific: warning.specific,
    })
  }
}

export function usesBuriedWarning(draft: { evidence: Array<{ type: string; specific?: boolean }> }): boolean {
  return draft.evidence.some((item) => item.type === 'buried_warning' && item.specific !== false)
}

export function buriedNonObviousness(non: number, draft: { evidence: Array<{ type: string; specific?: boolean }> }): number {
  if (!usesBuriedWarning(draft)) return non
  return Math.min(1, Math.round((non + BURIED_BOOST) * 100) / 100)
}

/**
 * Same search seats, with a small output reservation.
 * grok-4.6 rejects reasoning_effort "none" (HTTP 400), so "low" is the cheapest value it accepts.
 */
export function cheapSearchSlot(slot: RosterSlot): RosterSlot {
  const extraBody = slot.provider === 'xai' ? { reasoning_effort: 'low' } : slot.provider === 'openrouter' ? { reasoning: { enabled: false } } : undefined
  return { ...slot, reasoning: false, extraBody }
}
