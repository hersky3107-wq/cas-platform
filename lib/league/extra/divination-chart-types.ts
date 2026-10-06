/**
 * Stored shape of `model_predictions.divination_chart` (divination seat only).
 * Display-only: the verdict stays the oracle code vote. Client-safe.
 */
import { isGanzhi, isKigakuDirection, isNineStar, type KigakuDirection } from './divination-ganzhi'

export const WIKI_LABEL_LANGS = ['ko', 'en', 'ja', 'zh-tw', 'zh', 'fr', 'es', 'ar', 'pt'] as const
export type WikiLabelLang = (typeof WIKI_LABEL_LANGS)[number]
export type WikiLabels = Partial<Record<WikiLabelLang, string>>

export type SajuSubjectKind = 'person' | 'party' | 'company' | 'group'
/** `ceo_birth` = company read through its current CEO (Wikidata P169 → P569). */
export type SajuSource = 'birth' | 'inception' | 'ceo_birth'

export type SajuChart = {
  kind: 'saju'
  subject: {
    qid: string
    kind: SajuSubjectKind
    source: SajuSource
    /** Birth or founding month; the day is never kept. */
    yearMonth: string
    labels: WikiLabels
    ceo: { qid: string; labels: WikiLabels } | null
  }
  pillars: { year: string; month: string }
  period: { yearMonth: string; year: string; month: string }
}

export type KigakuOrigin = 'seoul' | 'tokyo' | 'london' | 'washington' | 'canberra'
export type KigakuHit = 'gohwang' | 'amgeom' | 'sepa' | 'wolpa'

export type KigakuBoard = { center: number; star: number; branch: string; hits: KigakuHit[] }

export type KigakuChart = {
  kind: 'kigaku'
  /** Reference month of the housing print. */
  period: string
  /** Year that owns the 年盤 (turns at 입춘). */
  qiYear: number
  origin: KigakuOrigin
  region: { country: string; code: string; nameKo: string; nameEn: string }
  direction: KigakuDirection
  year: KigakuBoard
  month: KigakuBoard
  /** No 五黄殺 / 暗剣殺 / 歳破 / 月破 on either board. */
  clear: boolean
}

export type DivinationChart = SajuChart | KigakuChart

const ORIGINS: readonly KigakuOrigin[] = ['seoul', 'tokyo', 'london', 'washington', 'canberra']
const HITS: readonly KigakuHit[] = ['gohwang', 'amgeom', 'sepa', 'wolpa']
const SUBJECT_KINDS: readonly SajuSubjectKind[] = ['person', 'party', 'company', 'group']
const SOURCES: readonly SajuSource[] = ['birth', 'inception', 'ceo_birth']
const YEAR_MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

export function parseWikiLabels(value: unknown): WikiLabels {
  const raw = record(value)
  const out: WikiLabels = {}
  if (!raw) return out
  for (const lang of WIKI_LABEL_LANGS) {
    const label = raw[lang]
    if (typeof label === 'string' && label.trim()) out[lang] = label.trim().slice(0, 120)
  }
  return out
}

export function preferredLabel(labels: WikiLabels, order: readonly WikiLabelLang[]): string | null {
  for (const lang of order) {
    const value = labels[lang]
    if (value) return value
  }
  return Object.values(labels).find(Boolean) ?? null
}

function parseBoard(value: unknown): KigakuBoard | null {
  const raw = record(value)
  if (!raw || !isNineStar(raw.center) || !isNineStar(raw.star) || typeof raw.branch !== 'string') return null
  const hits = Array.isArray(raw.hits) ? raw.hits.filter((h): h is KigakuHit => HITS.includes(h as KigakuHit)) : []
  return { center: raw.center, star: raw.star, branch: raw.branch, hits }
}

function parseSaju(raw: Record<string, unknown>): SajuChart | null {
  const subject = record(raw.subject)
  const pillars = record(raw.pillars)
  const period = record(raw.period)
  if (!subject || !pillars || !period) return null
  if (typeof subject.qid !== 'string' || !SUBJECT_KINDS.includes(subject.kind as SajuSubjectKind)) return null
  if (!SOURCES.includes(subject.source as SajuSource)) return null
  if (typeof subject.yearMonth !== 'string' || !YEAR_MONTH_RE.test(subject.yearMonth)) return null
  if (!isGanzhi(pillars.year) || !isGanzhi(pillars.month)) return null
  if (!isGanzhi(period.year) || !isGanzhi(period.month) || typeof period.yearMonth !== 'string') return null
  const ceoRaw = record(subject.ceo)
  const ceo = ceoRaw && typeof ceoRaw.qid === 'string' ? { qid: ceoRaw.qid, labels: parseWikiLabels(ceoRaw.labels) } : null
  return {
    kind: 'saju',
    subject: {
      qid: subject.qid,
      kind: subject.kind as SajuSubjectKind,
      source: subject.source as SajuSource,
      yearMonth: subject.yearMonth,
      labels: parseWikiLabels(subject.labels),
      ceo,
    },
    pillars: { year: pillars.year, month: pillars.month },
    period: { yearMonth: period.yearMonth, year: period.year, month: period.month },
  }
}

function parseKigaku(raw: Record<string, unknown>): KigakuChart | null {
  const region = record(raw.region)
  const year = parseBoard(raw.year)
  const month = parseBoard(raw.month)
  if (!region || !year || !month) return null
  if (typeof raw.period !== 'string' || !YEAR_MONTH_RE.test(raw.period)) return null
  if (typeof raw.qiYear !== 'number' || !Number.isInteger(raw.qiYear)) return null
  if (!ORIGINS.includes(raw.origin as KigakuOrigin) || !isKigakuDirection(raw.direction)) return null
  return {
    kind: 'kigaku',
    period: raw.period,
    qiYear: raw.qiYear,
    origin: raw.origin as KigakuOrigin,
    region: {
      country: String(region.country ?? ''),
      code: String(region.code ?? ''),
      nameKo: String(region.nameKo ?? ''),
      nameEn: String(region.nameEn ?? ''),
    },
    direction: raw.direction,
    year,
    month,
    clear: year.hits.length === 0 && month.hits.length === 0,
  }
}

export function parseDivinationChart(value: unknown): DivinationChart | null {
  const raw = record(value)
  if (!raw) return null
  if (raw.kind === 'saju') return parseSaju(raw)
  if (raw.kind === 'kigaku') return parseKigaku(raw)
  return null
}
