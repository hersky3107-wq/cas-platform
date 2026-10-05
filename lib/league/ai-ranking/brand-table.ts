/**
 * AIRANK brand_table — weekly (overall only) / monthly (all 6 fields) top-10 ranking product.
 * Pure: codec helpers, answer parse/validate, Borda, grading, KST deadlines.
 */

import { formatInTimeZone } from 'date-fns-tz'
import {
  airankDisplayProposition,
  encodeAirankInstrument,
  fieldLabel,
  isAirankInstrument,
  parseAirankInstrument,
  resolveAirankBrand,
  ymdToYyyymmdd,
  type AirankArena,
  type AirankHorizon,
  type AirankParts,
} from './instrument'
import { addUtcDaysYmd, type SnapshotBrandRow } from './grade'
import type { LeagueLocale } from '@/lib/league/i18n/locales'

export const BRAND_TABLE_KIND = 'brand_table' as const
export const BRAND_TABLE_SUBJECT = 'top10' as const
export const BRAND_TABLE_SIZE = 10
export const BRAND_TABLE_CANDIDATE_TOP = 15
export const BRAND_TABLE_OTHER = '기타·신규'
export const BRAND_TABLE_HORIZONS = ['1w', '1m'] as const
export type BrandTableHorizon = (typeof BRAND_TABLE_HORIZONS)[number]

export const KST_TZ = 'Asia/Seoul'

export type BrandTableFieldId = 'overall' | 'coding' | 'math' | 'writing' | 'image' | 'video'

export type BrandTableField = {
  id: BrandTableFieldId
  arena: AirankArena
  category: string
}

export const BRAND_TABLE_FIELDS: readonly BrandTableField[] = [
  { id: 'overall', arena: 'text', category: 'overall' },
  { id: 'coding', arena: 'text', category: 'coding' },
  { id: 'math', arena: 'text', category: 'math' },
  { id: 'writing', arena: 'text', category: 'creative_writing' },
  { id: 'image', arena: 'text_to_image', category: 'overall' },
  { id: 'video', arena: 'text_to_video', category: 'overall' },
]

const OTHER_ALIASES = new Set(
  [
    BRAND_TABLE_OTHER,
    'other',
    'new',
    'other_new',
    'other-new',
    '기타',
    '신규',
    '기타/신규',
    '기타,신규',
    '기타 신규',
  ].map((s) => foldBrandToken(s)),
)

const BRAND_SLUG: Record<string, string> = {
  OpenAI: 'OpenAI',
  Google: 'Google',
  Anthropic: 'Anthropic',
  xAI: 'xAI',
  DeepSeek: 'DeepSeek',
  'Alibaba/Qwen': 'Qwen',
  Moonshot: 'Moonshot',
  'Zhipu/GLM': 'GLM',
  MiniMax: 'MiniMax',
  Meta: 'Meta',
  Mistral: 'Mistral',
  'Black Forest Labs': 'BFL',
  Runway: 'Runway',
  'Kuaishou (Kling)': 'Kling',
  Luma: 'Luma',
  Pika: 'Pika',
  Ideogram: 'Ideogram',
  Recraft: 'Recraft',
  Microsoft: 'Microsoft',
  NVIDIA: 'NVIDIA',
  Amazon: 'Amazon',
  [BRAND_TABLE_OTHER]: 'OTHER',
}

const SLUG_TO_BRAND = new Map(Object.entries(BRAND_SLUG).map(([brand, slug]) => [slug.toLowerCase(), brand]))

export function isBrandTableInstrument(raw: string | null | undefined): boolean {
  if (typeof raw !== 'string' || !isAirankInstrument(raw)) return false
  const parsed = parseAirankInstrument(raw)
  return parsed.ok && parsed.parts.kind === BRAND_TABLE_KIND
}

export function isBrandTableParts(parts: AirankParts | null | undefined): boolean {
  return parts?.kind === BRAND_TABLE_KIND
}

export function brandTableFieldOf(parts: AirankParts): BrandTableField | null {
  return (
    BRAND_TABLE_FIELDS.find((f) => f.arena === parts.arena && f.category === parts.category) ?? null
  )
}

export function encodeBrandTableInstrument(field: BrandTableField, deadlineYmd: string): string {
  return encodeAirankInstrument({
    arena: field.arena,
    category: field.category,
    kind: BRAND_TABLE_KIND,
    subject: BRAND_TABLE_SUBJECT,
    deadlineYmd,
  })
}

export function kstYmd(now: Date): string {
  return formatInTimeZone(now, KST_TZ, 'yyyy-MM-dd')
}

export function kstParts(now: Date): { ymd: string; y: number; m: number; d: number; dow: number; hour: number } {
  const ymd = kstYmd(now)
  const [y, m, d] = ymd.split('-').map(Number)
  const hour = Number(formatInTimeZone(now, KST_TZ, 'H'))
  const dow = Number(formatInTimeZone(now, KST_TZ, 'i')) % 7
  // date-fns `i` is ISO day (1 Mon … 7 Sun). Convert to JS (0 Sun … 6 Sat).
  const iso = Number(formatInTimeZone(now, KST_TZ, 'i'))
  return { ymd, y, m, d, dow: iso === 7 ? 0 : iso, hour }
}

/** This week's Sunday in KST (today if already Sunday). */
export function thisWeekSundayKst(now: Date): string {
  const { ymd, dow } = kstParts(now)
  const add = dow === 0 ? 0 : 7 - dow
  return addUtcDaysYmd(ymd, add)
}

export function calendarDaysBetweenYmd(fromYmd: string, toYmd: string): number {
  return Math.round(
    (Date.parse(`${toYmd}T00:00:00.000Z`) - Date.parse(`${fromYmd}T00:00:00.000Z`)) / 86_400_000,
  )
}

/** Next Sunday at least `minDays` after the KST open date (Sunday open → following Sunday). */
export function nextSundayDeadlineKst(now: Date, minDays = 6): string {
  const { ymd, dow } = kstParts(now)
  const toThisSunday = dow === 0 ? 0 : 7 - dow
  const thisSunday = addUtcDaysYmd(ymd, toThisSunday)
  if (calendarDaysBetweenYmd(ymd, thisSunday) >= minDays) return thisSunday
  return addUtcDaysYmd(thisSunday, 7)
}

/** Last civil day of the current KST month. */
export function lastDayOfMonthKst(now: Date): string {
  const { y, m } = kstParts(now)
  const last = new Date(Date.UTC(y, m, 0))
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${last.getUTCFullYear()}-${pad(last.getUTCMonth() + 1)}-${pad(last.getUTCDate())}`
}

export function brandTableDeadlineYmd(horizon: BrandTableHorizon, now: Date = new Date()): string {
  return horizon === '1w' ? nextSundayDeadlineKst(now) : lastDayOfMonthKst(now)
}

/** Monday 09:00 KST of the current KST week has passed. Sunday is still the previous week. */
export function weekTableOpenPassed(now: Date): boolean {
  const { dow, hour } = kstParts(now)
  if (dow === 0) return false
  if (dow > 1) return true
  return hour >= 9
}

/** 1st 09:00 KST of the current KST month has passed. */
export function monthTableOpenPassed(now: Date): boolean {
  const { d, hour } = kstParts(now)
  if (d > 1) return true
  return d === 1 && hour >= 9
}

export type BrandTableSlot = {
  field: BrandTableField
  horizon: BrandTableHorizon
  deadlineYmd: string
  instrument: string
  cacheKey: string
}

export function planAirankTableSlots(now: Date = new Date()): BrandTableSlot[] {
  const out: BrandTableSlot[] = []
  if (weekTableOpenPassed(now)) {
    const field = BRAND_TABLE_FIELDS[0]
    const deadlineYmd = brandTableDeadlineYmd('1w', now)
    const instrument = encodeBrandTableInstrument(field, deadlineYmd)
    out.push({
      field,
      horizon: '1w',
      deadlineYmd,
      instrument,
      cacheKey: `airank|${instrument}|1w`,
    })
  }
  if (monthTableOpenPassed(now)) {
    const deadlineYmd = brandTableDeadlineYmd('1m', now)
    for (const field of BRAND_TABLE_FIELDS) {
      const instrument = encodeBrandTableInstrument(field, deadlineYmd)
      out.push({
        field,
        horizon: '1m',
        deadlineYmd,
        instrument,
        cacheKey: `airank|${instrument}|1m`,
      })
    }
  }
  return out
}

export function coerceBrandTableHorizon(
  fieldId: BrandTableFieldId,
  horizon: BrandTableHorizon,
): BrandTableHorizon {
  return fieldId === 'overall' ? horizon : '1m'
}

export function currentBrandTableSlot(
  fieldId: BrandTableFieldId,
  horizon: BrandTableHorizon,
  now: Date = new Date(),
): BrandTableSlot {
  const field = BRAND_TABLE_FIELDS.find((f) => f.id === fieldId) ?? BRAND_TABLE_FIELDS[0]
  const hz = coerceBrandTableHorizon(field.id, horizon)
  const deadlineYmd = brandTableDeadlineYmd(hz, now)
  const instrument = encodeBrandTableInstrument(field, deadlineYmd)
  return {
    field,
    horizon: hz,
    deadlineYmd,
    instrument,
    cacheKey: `airank|${instrument}|${hz}`,
  }
}

export function candidateListFromRanking(brands: readonly SnapshotBrandRow[]): string[] {
  const sorted = [...brands].sort((a, b) => a.rank - b.rank || a.brand.localeCompare(b.brand))
  const seen = new Set<string>()
  const top: string[] = []
  for (const row of sorted) {
    if (seen.has(row.brand)) continue
    seen.add(row.brand)
    top.push(row.brand)
    if (top.length >= BRAND_TABLE_CANDIDATE_TOP) break
  }
  return [...top, BRAND_TABLE_OTHER]
}

export function foldBrandToken(value: string): string {
  return value.toLowerCase().replace(/[\s._/·,()-]+/g, '')
}

export function resolveBrandTableCandidate(raw: string, candidates: readonly string[]): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  if (OTHER_ALIASES.has(foldBrandToken(trimmed))) {
    return candidates.includes(BRAND_TABLE_OTHER) ? BRAND_TABLE_OTHER : null
  }
  const brand = resolveAirankBrand(trimmed) ?? trimmed
  const exact = candidates.find((c) => c.toLowerCase() === brand.toLowerCase() || foldBrandToken(c) === foldBrandToken(brand))
  if (exact) return exact
  const slug = SLUG_TO_BRAND.get(trimmed.toLowerCase())
  if (slug && candidates.includes(slug)) return slug
  return null
}

export function encodeBrandTableRanking(ranking: readonly string[]): string {
  const bits = ranking.map((name) => BRAND_SLUG[name] ?? name)
  return bits.join('|')
}

export function decodeBrandTableRanking(raw: string | null | undefined): string[] {
  if (!raw || typeof raw !== 'string') return []
  const body = raw.replace(/^table:/i, '').split('@')[0]?.trim() ?? ''
  if (!body) return []
  const bits = body.split(/[|,]/).map((s) => s.trim()).filter(Boolean)
  return bits.map((bit) => SLUG_TO_BRAND.get(bit.toLowerCase()) ?? resolveAirankBrand(bit) ?? bit)
}

export type BrandTableAnswer = {
  ranking: string[]
  probability: number
  rationale: string | null
}

export type BrandTableParse =
  | { ok: true; answer: BrandTableAnswer }
  | { ok: false; reason: 'unparseable' | 'wrong_size' | 'not_distinct' | 'not_candidate' }

function extractJsonObject(text: string): Record<string, unknown> | null {
  const trimmed = text.trim()
  const start = trimmed.lastIndexOf('{')
  if (start < 0) return null
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < trimmed.length; i++) {
    const ch = trimmed[i]
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
          return JSON.parse(trimmed.slice(start, i + 1)) as Record<string, unknown>
        } catch {
          return null
        }
      }
    }
  }
  return null
}

function asStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((v) => String(v ?? '').trim()).filter(Boolean)
  }
  if (typeof value === 'string') {
    return value.split(/[|,]/).map((s) => s.trim()).filter(Boolean)
  }
  return []
}

export function parseBrandTableAnswer(
  text: string | null | undefined,
  candidates: readonly string[],
): BrandTableParse {
  if (!text) return { ok: false, reason: 'unparseable' }
  const obj = extractJsonObject(text)
  if (!obj) return { ok: false, reason: 'unparseable' }
  const rankingRaw = asStringList(obj.ranking ?? obj.top10 ?? obj.top5 ?? obj.table)
  if (rankingRaw.length !== BRAND_TABLE_SIZE) return { ok: false, reason: 'wrong_size' }
  const resolved: string[] = []
  for (const item of rankingRaw) {
    const hit = resolveBrandTableCandidate(item, candidates)
    if (!hit) return { ok: false, reason: 'not_candidate' }
    resolved.push(hit)
  }
  if (new Set(resolved).size !== BRAND_TABLE_SIZE) return { ok: false, reason: 'not_distinct' }
  const p = Number(obj.probability ?? obj.prob ?? obj.confidence)
  const probability = Number.isFinite(p) ? Math.max(0, Math.min(100, Math.round(p))) : 50
  const rationale = typeof obj.rationale === 'string' ? obj.rationale.trim() || null : null
  return { ok: true, answer: { ranking: resolved, probability, rationale } }
}

export function parseBrandTablePick(
  text: string | null | undefined,
  candidates: readonly string[],
): { ok: true; pick: string; probability: number; rationale: string | null } | { ok: false; reason: string } {
  if (!text) return { ok: false, reason: 'unparseable' }
  const obj = extractJsonObject(text)
  if (!obj) return { ok: false, reason: 'unparseable' }
  const raw =
    (typeof obj.pick === 'string' && obj.pick) ||
    (typeof obj.brand === 'string' && obj.brand) ||
    (Array.isArray(obj.ranking) && typeof obj.ranking[0] === 'string' ? obj.ranking[0] : '') ||
    ''
  const pick = resolveBrandTableCandidate(raw, candidates)
  if (!pick) return { ok: false, reason: 'not_candidate' }
  const p = Number(obj.probability ?? obj.prob ?? obj.confidence)
  const probability = Number.isFinite(p) ? Math.max(0, Math.min(100, Math.round(p))) : 50
  const rationale = typeof obj.rationale === 'string' ? obj.rationale.trim() || null : null
  return { ok: true, pick, probability, rationale }
}

export function extractBrandTableCandidates(injection: string | null | undefined): string[] {
  if (!injection) return []
  const block = injection.match(/CANDIDATES[\s\S]*?:\s*([^\n]+)/i)
  if (!block?.[1]) return []
  return block[1]
    .split('|')
    .map((s) => s.trim())
    .filter(Boolean)
}

export function extractBrandTableBaseline(injection: string | null | undefined): string[] {
  if (!injection) return []
  const block = injection.match(/BASELINE TOP(?:10|5)[^:]*:\s*([^\n]+)/i)
  if (!block?.[1]) return []
  return block[1]
    .split('|')
    .map((s) => s.trim())
    .filter(Boolean)
}

export function mapActualBrandsToCandidates(
  actual: readonly string[],
  candidates: readonly string[],
): string[] {
  const known = new Set(candidates.filter((c) => c !== BRAND_TABLE_OTHER).map((c) => foldBrandToken(c)))
  return actual.map((brand) => {
    const hit = candidates.find((c) => foldBrandToken(c) === foldBrandToken(brand))
    if (hit) return hit
    if (known.has(foldBrandToken(brand))) return brand
    return BRAND_TABLE_OTHER
  })
}

export function topNBrands(rows: readonly SnapshotBrandRow[], n: number): SnapshotBrandRow[] {
  const sorted = [...rows].sort((a, b) => a.rank - b.rank || a.brand.localeCompare(b.brand))
  const seen = new Set<string>()
  const out: SnapshotBrandRow[] = []
  for (const row of sorted) {
    if (seen.has(row.brand)) continue
    seen.add(row.brand)
    out.push(row)
    if (out.length >= n) break
  }
  return out
}

export type BrandTableSeatGrade = {
  top1Hit: boolean
  top3Overlap: number
  bordaVsActual: number
}

export function gradeBrandTableRanking(
  predicted: readonly string[],
  actual: readonly string[],
): BrandTableSeatGrade {
  const pred = predicted.slice(0, BRAND_TABLE_SIZE)
  const act = actual.slice(0, BRAND_TABLE_SIZE)
  const top1Hit = pred[0] != null && pred[0] === act[0]
  const predTop3 = new Set(pred.slice(0, 3))
  const actTop3 = new Set(act.slice(0, 3))
  let top3Overlap = 0
  for (const brand of predTop3) if (actTop3.has(brand)) top3Overlap += 1
  let bordaVsActual = 0
  for (let i = 0; i < pred.length; i++) {
    const idx = act.indexOf(pred[i] ?? '')
    if (idx >= 0) bordaVsActual += BRAND_TABLE_SIZE - Math.abs(i - idx)
  }
  return { top1Hit, top3Overlap, bordaVsActual }
}

export type BordaRow = {
  brand: string
  points: number
  firstVotes: number
  model: string | null
}

export function aggregateBorda(
  rankings: readonly (readonly string[])[],
  currentByBrand?: ReadonlyMap<string, string>,
): BordaRow[] {
  const points = new Map<string, number>()
  const firstVotes = new Map<string, number>()
  for (const ranking of rankings) {
    ranking.slice(0, BRAND_TABLE_SIZE).forEach((brand, i) => {
      points.set(brand, (points.get(brand) ?? 0) + (BRAND_TABLE_SIZE - i))
    })
    const first = ranking[0]
    if (first) firstVotes.set(first, (firstVotes.get(first) ?? 0) + 1)
  }
  const brands = [...new Set([...points.keys(), ...firstVotes.keys()])]
  return brands
    .map((brand) => ({
      brand,
      points: points.get(brand) ?? 0,
      firstVotes: firstVotes.get(brand) ?? 0,
      model: currentByBrand?.get(brand) ?? null,
    }))
    .sort((a, b) => b.points - a.points || b.firstVotes - a.firstVotes || a.brand.localeCompare(b.brand))
    .slice(0, BRAND_TABLE_SIZE)
}

export function headlineFirstPick(rows: readonly BordaRow[]): { brand: string; firstVotes: number } | null {
  if (!rows.length) return null
  const byVotes = [...rows].sort((a, b) => b.firstVotes - a.firstVotes || b.points - a.points)
  const top = byVotes[0]
  if (!top || top.firstVotes <= 0) return { brand: rows[0].brand, firstVotes: 0 }
  return { brand: top.brand, firstVotes: top.firstVotes }
}

export function encodeActualTableOutcome(ranking: readonly string[], publishDate: string): string {
  return `table:${encodeBrandTableRanking(ranking)} @ ${publishDate}`
}

export function decodeActualTableOutcome(raw: string | null | undefined): { ranking: string[]; publishDate: string | null } {
  if (!raw) return { ranking: [], publishDate: null }
  const m = raw.match(/^table:([^@]+)(?:@\s*(\d{4}-\d{2}-\d{2}))?/i)
  if (!m) return { ranking: decodeBrandTableRanking(raw), publishDate: null }
  return { ranking: decodeBrandTableRanking(m[1]), publishDate: m[2] ?? null }
}

export function utcDaySpanInclusive(firstYmd: string, lastYmd: string): number {
  const [fy, fm, fd] = firstYmd.split('-').map(Number)
  const [ly, lm, ld] = lastYmd.split('-').map(Number)
  const a = Date.UTC(fy, fm - 1, fd)
  const b = Date.UTC(ly, lm - 1, ld)
  return Math.max(0, Math.round((b - a) / 86_400_000) + 1)
}

export function effectiveHistoryN(totalDays: number, horizonDays: number): number {
  if (horizonDays <= 0 || totalDays <= 0) return 0
  return Math.floor(totalDays / horizonDays)
}

export type BrandTableViewRow = {
  rank: number
  brand: string
  model: string | null
  firstVotes: number
  voteSharePct: number | null
  points: number
}

export type BrandTableView = {
  headlineBrand: string | null
  headlineFirstVotes: number
  officialAnswered: number
  predicted: BrandTableViewRow[]
  current: BrandTableViewRow[]
  actual: BrandTableViewRow[] | null
  baseline: BrandTableViewRow[] | null
  top1Hits: number | null
  gradedSeats: number | null
  seatsBeatBaseline: number | null
  baselineTop1Hit: boolean | null
  baselineTop3Overlap: number | null
  attribution: boolean
}

export function buildBrandTableView(args: {
  officialRankings: readonly (readonly string[])[]
  current: readonly SnapshotBrandRow[]
  actual?: readonly SnapshotBrandRow[] | null
  baseline?: readonly SnapshotBrandRow[] | null
  seatGrades?: readonly BrandTableSeatGrade[] | null
}): BrandTableView {
  const currentTop = topNBrands(args.current, BRAND_TABLE_SIZE)
  const currentByBrand = new Map(currentTop.map((r) => [r.brand, r.model]))
  const official = args.officialRankings.filter((r) => r.length >= BRAND_TABLE_SIZE)
  const borda = aggregateBorda(official, currentByBrand)
  const headline = headlineFirstPick(borda)
  const n = official.length
  const predicted: BrandTableViewRow[] = borda.map((row, i) => ({
    rank: i + 1,
    brand: row.brand,
    model: row.model,
    firstVotes: row.firstVotes,
    voteSharePct: n > 0 ? Math.round((100 * row.firstVotes) / n) : null,
    points: row.points,
  }))
  const toRows = (rows: readonly SnapshotBrandRow[]): BrandTableViewRow[] =>
    topNBrands(rows, BRAND_TABLE_SIZE).map((r, i) => ({
      rank: i + 1,
      brand: r.brand,
      model: r.model,
      firstVotes: 0,
      voteSharePct: null,
      points: 0,
    }))
  const actualRows = args.actual?.length ? toRows(args.actual) : null
  const baselineRows = args.baseline?.length ? toRows(args.baseline) : null
  let top1Hits: number | null = null
  let gradedSeats: number | null = null
  let seatsBeatBaseline: number | null = null
  let baselineTop1Hit: boolean | null = null
  let baselineTop3Overlap: number | null = null
  if (actualRows && args.seatGrades && args.seatGrades.length) {
    gradedSeats = args.seatGrades.length
    top1Hits = args.seatGrades.filter((g) => g.top1Hit).length
    if (baselineRows) {
      const baselineGrade = gradeBrandTableRanking(
        baselineRows.map((r) => r.brand),
        actualRows.map((r) => r.brand),
      )
      baselineTop1Hit = baselineGrade.top1Hit
      baselineTop3Overlap = baselineGrade.top3Overlap
      seatsBeatBaseline = args.seatGrades.filter((g) => g.bordaVsActual > baselineGrade.bordaVsActual).length
    }
  }
  return {
    headlineBrand: headline?.brand ?? null,
    headlineFirstVotes: headline?.firstVotes ?? 0,
    officialAnswered: n,
    predicted,
    current: toRows(args.current),
    actual: actualRows,
    baseline: baselineRows,
    top1Hits,
    gradedSeats,
    seatsBeatBaseline,
    baselineTop1Hit,
    baselineTop3Overlap,
    attribution: true,
  }
}

export function brandTableProposition(
  parts: AirankParts,
  locale: LeagueLocale = 'en',
  horizon?: AirankHorizon | string | null,
): string {
  return airankDisplayProposition(parts, locale, horizon)
}

export function brandTableHeader(parts: AirankParts, horizon: string, locale: LeagueLocale): string {
  const field = fieldLabel(parts, locale)
  const period =
    horizon === '1w'
      ? locale === 'ko'
        ? '이번 주'
        : locale === 'ja'
          ? '今週'
          : locale === 'zh-TW'
            ? '本週'
            : locale === 'fr'
              ? 'cette semaine'
              : locale === 'es'
                ? 'esta semana'
                : locale === 'pt'
                  ? 'esta semana'
                  : locale === 'ar'
                    ? 'هذا الأسبوع'
                    : 'this week'
      : locale === 'ko'
        ? '이번 달'
        : locale === 'ja'
          ? '今月'
          : locale === 'zh-TW'
            ? '本月'
            : locale === 'fr'
              ? 'ce mois'
              : locale === 'es'
                ? 'este mes'
                : locale === 'pt'
                  ? 'este mês'
                  : locale === 'ar'
                    ? 'هذا الشهر'
                    : 'this month'
  const tableWord =
    locale === 'ko' ? '순위표' : locale === 'ja' ? '順位表' : locale === 'zh-TW' ? '排名表' : 'ranking table'
  return `${field} ${tableWord} · ${period}`
}

export function ymdDeadlineToken(ymd: string): string {
  return ymdToYyyymmdd(ymd) ?? ymd.replace(/-/g, '')
}
