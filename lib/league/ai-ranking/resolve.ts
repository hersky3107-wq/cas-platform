/**
 * Tech free-prompt → AIRANK. Ranking questions become an encoded instrument;
 * everything else stays on the tech event path.
 */

import type { RefusalCode } from '@/lib/league/gateway/types'
import {
  brandFromOrganization,
  isAirankCamp,
  type AirankCamp,
  type AiVendorBrand,
} from './brands'
import {
  AIRANK_LEDGER_CATEGORY,
  airankAllPropositions,
  airankPropositionText,
  airankResolutionRule,
  airankSubjectLabel,
  decodeAirankInstrument,
  encodeAirankInstrument,
  isAirankHorizon,
  type AirankArena,
  type AirankHorizon,
  type AirankKind,
  type AirankParts,
} from './instrument'

export type AirankParseOk = {
  ok: true
  parts: AirankParts
  horizon: AirankHorizon
  locale: 'ko' | 'en'
  instrument: string
  label: string
}

export type AirankParseResult = AirankParseOk | { ok: false; code: RefusalCode }

const RANK_HARD =
  /순위|랭킹|리더보드|leaderboard|lmarena|chatbot arena|arena rank|#\s*1|1\s*위|1\s*등|상위\s*\d+|탑\s*\d+|\d+\s*위\s*안|top\s*-?\s*\d+|보다\s*위|best ai model|최고.{0,12}(?:ai|모델)/i
const RANK_SOFT = /이길|위일|앞설|beat|outrank|overtake|ahead of/i
const COMPARE = /보다\s*위|보다\s*앞|앞설|이길|above|outrank|overtake|ahead of|\bvs\.?\b|versus|\bbeat\b/i

const SUPPORTED_FIELDS: Array<{ re: RegExp; arena: AirankArena; category: string }> = [
  { re: /지시\s*따르기|instruction\s*following/i, arena: 'text', category: 'instruction_following' },
  { re: /creative\s*writing|창작|글쓰기|작문/i, arena: 'text', category: 'creative_writing' },
  { re: /hard\s*prompts|어려운\s*질문|추론/i, arena: 'text', category: 'hard_prompts' },
  { re: /text[-\s]*to[-\s]*image|이미지\s*생성|그림/i, arena: 'text_to_image', category: 'overall' },
  { re: /text[-\s]*to[-\s]*video|영상(?:\s*생성)?|동영상(?:\s*생성)?|\bvideo\b/i, arena: 'text_to_video', category: 'overall' },
  { re: /이미지\s*이해|\bvision\b|비전/i, arena: 'vision', category: 'overall' },
  { re: /웹\s*개발|\bwebdev\b|web\s*dev/i, arena: 'webdev', category: 'overall' },
  { re: /코딩|\bcoding\b|코드/i, arena: 'text', category: 'coding' },
  { re: /수학|\bmath(?:s|ematics)?\b/i, arena: 'text', category: 'math' },
  { re: /검색|\bsearch\b/i, arena: 'search', category: 'overall' },
  { re: /종합|전체|\boverall\b/i, arena: 'text', category: 'overall' },
]

const UNSUPPORTED_FIELD =
  /한국어|\bkorean\b|일본어|\bjapanese\b|중국어|독일어|프랑스어|스페인어|\bgerman\b|\bfrench\b|\bspanish\b|다국어|언어별/

const VERSIONED: Array<{ re: RegExp; token: (m: RegExpMatchArray) => string }> = [
  { re: /\b(?:chat\s*)?gpt[\s-]*(\d+(?:\.\d+)?)\b/i, token: (m) => `GPT-${m[1]}` },
  { re: /(?:제미나이|gemini)[\s-]*(\d+(?:\.\d+)?)/i, token: (m) => (m[0].includes('제미나이') ? `제미나이 ${m[1]}` : `Gemini ${m[1]}`) },
  { re: /(?:클로드|claude)[\s-]*(\d+(?:\.\d+)?)/i, token: (m) => (m[0].includes('클로드') ? `클로드 ${m[1]}` : `Claude ${m[1]}`) },
  { re: /(?:그록|grok)[\s-]*(\d+(?:\.\d+)?)/i, token: (m) => (m[0].includes('그록') ? `그록 ${m[1]}` : `Grok ${m[1]}`) },
  { re: /(?:딥시크|deepseek)[\s-]*v?(\d+(?:\.\d+)?)/i, token: (m) => `DeepSeek ${m[1]}` },
]

const PROMPT_BRANDS: Array<{ alias: string; brand: AiVendorBrand }> = (
  [
    ['아이디오그램', 'Ideogram'],
    ['리크래프트', 'Recraft'],
    ['블랙 포레스트', 'Black Forest Labs'],
    ['블랙포레스트', 'Black Forest Labs'],
    ['마이크로소프트', 'Microsoft'],
    ['앤트로픽', 'Anthropic'],
    ['제미나이', 'Google'],
    ['미니맥스', 'MiniMax'],
    ['미스트랄', 'Mistral'],
    ['알리바바', 'Alibaba/Qwen'],
    ['엔비디아', 'NVIDIA'],
    ['챗지피티', 'OpenAI'],
    ['오픈에이아이', 'OpenAI'],
    ['딥시크', 'DeepSeek'],
    ['클로드', 'Anthropic'],
    ['런웨이', 'Runway'],
    ['플럭스', 'Black Forest Labs'],
    ['문샷', 'Moonshot'],
    ['큐웬', 'Alibaba/Qwen'],
    ['그록', 'xAI'],
    ['구글', 'Google'],
    ['키미', 'Moonshot'],
    ['지푸', 'Zhipu/GLM'],
    ['클링', 'Kuaishou (Kling)'],
    ['라마', 'Meta'],
    ['메타', 'Meta'],
    ['뮤즈', 'Meta'],
    ['루마', 'Luma'],
    ['피카', 'Pika'],
    ['아마존', 'Amazon'],
    ['챗gpt', 'OpenAI'],
    ['오픈ai', 'OpenAI'],
    ['chatgpt', 'OpenAI'],
    ['chat gpt', 'OpenAI'],
    ['openai', 'OpenAI'],
    ['anthropic', 'Anthropic'],
    ['claude', 'Anthropic'],
    ['gemini', 'Google'],
    ['google', 'Google'],
    ['deepseek', 'DeepSeek'],
    ['alibaba', 'Alibaba/Qwen'],
    ['moonshot', 'Moonshot'],
    ['minimax', 'MiniMax'],
    ['mistral', 'Mistral'],
    ['ideogram', 'Ideogram'],
    ['recraft', 'Recraft'],
    ['runway', 'Runway'],
    ['llama', 'Meta'],
    ['flux', 'Black Forest Labs'],
    ['qwen', 'Alibaba/Qwen'],
    ['kimi', 'Moonshot'],
    ['kling', 'Kuaishou (Kling)'],
    ['muse', 'Meta'],
    ['meta', 'Meta'],
    ['luma', 'Luma'],
    ['pika', 'Pika'],
    ['grok', 'xAI'],
    ['gpt', 'OpenAI'],
    ['glm', 'Zhipu/GLM'],
    ['xai', 'xAI'],
    ['z.ai', 'Zhipu/GLM'],
    ['zhipu', 'Zhipu/GLM'],
  ] as const
).map(([alias, brand]) => ({ alias, brand }))

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8,
  sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11,
  dec: 12, december: 12,
}

type BrandHit = { brand: AiVendorBrand; index: number; length: number }

function escapeRe(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function aliasRegex(alias: string): RegExp {
  const body = escapeRe(alias)
  if (/[가-힣]/.test(alias) || alias.includes('.')) return new RegExp(body, 'ig')
  return new RegExp(`\\b${body}\\b`, 'ig')
}

function kstParts(now: Date): { y: number; m: number; d: number; dow: number; ymd: string } {
  const shifted = new Date(now.getTime() + 9 * 3600_000)
  const y = shifted.getUTCFullYear()
  const m = shifted.getUTCMonth() + 1
  const d = shifted.getUTCDate()
  const dow = shifted.getUTCDay()
  return { y, m, d, dow, ymd: ymd(y, m, d) }
}

function ymd(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

function lastDayOfMonth(y: number, m: number): string {
  const dt = new Date(Date.UTC(y, m, 0))
  return ymd(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate())
}

function addDays(ymdValue: string, days: number): string {
  const [y, m, d] = ymdValue.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d + days))
  return ymd(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate())
}

function addMonths(ymdValue: string, months: number): string {
  const [y, m, d] = ymdValue.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1 + months, d))
  return ymd(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate())
}

function calendarDays(fromYmd: string, toYmd: string): number {
  const a = Date.parse(`${fromYmd}T00:00:00.000Z`)
  const b = Date.parse(`${toYmd}T00:00:00.000Z`)
  return Math.round((b - a) / 86_400_000)
}

export function airankHorizonFromDeadline(
  deadlineYmd: string,
  now: Date,
): { ok: true; horizon: AirankHorizon } | { ok: false; code: RefusalCode } {
  const today = kstParts(now).ymd
  const days = calendarDays(today, deadlineYmd)
  if (days < 0) return { ok: false, code: 'already_resolved' }
  if (days < 6) return { ok: false, code: 'airank_min_horizon' }
  if (days <= 8) return { ok: true, horizon: '1w' }
  if (days <= 35) return { ok: true, horizon: '1m' }
  if (days <= 95) return { ok: true, horizon: '3m' }
  return { ok: false, code: 'deadline_too_far' }
}

function findVersioned(text: string): { token: string; index: number; length: number } | null {
  let best: { token: string; index: number; length: number } | null = null
  for (const spec of VERSIONED) {
    const re = new RegExp(spec.re.source, spec.re.flags.includes('g') ? spec.re.flags : `${spec.re.flags}g`)
    let m: RegExpExecArray | null
    while ((m = re.exec(text))) {
      const hit = { token: spec.token(m), index: m.index, length: m[0].length }
      if (!best || hit.index < best.index || (hit.index === best.index && hit.length > best.length)) best = hit
    }
  }
  return best
}

function maskRange(text: string, index: number, length: number): string {
  return `${text.slice(0, index)}${' '.repeat(length)}${text.slice(index + length)}`
}

function findBrandHits(text: string): BrandHit[] {
  const raw: BrandHit[] = []
  for (const { alias, brand } of PROMPT_BRANDS) {
    const re = aliasRegex(alias)
    let m: RegExpExecArray | null
    while ((m = re.exec(text))) {
      raw.push({ brand, index: m.index, length: m[0].length })
      if (m[0].length === 0) break
    }
  }
  raw.sort((a, b) => a.index - b.index || b.length - a.length)
  const kept: BrandHit[] = []
  for (const hit of raw) {
    if (kept.some((k) => hit.index < k.index + k.length && k.index < hit.index + hit.length)) continue
    kept.push(hit)
  }
  return kept.sort((a, b) => a.index - b.index)
}

function findCamp(text: string): AirankCamp | null {
  if (/중국(?:\s*(?:AI|ai|회사|기업|모델))?/.test(text) || /\b(?:china|chinese)\b/i.test(text)) return 'china'
  if (/유럽(?:\s*(?:AI|ai|회사|기업|모델))?/.test(text) || /\b(?:europe|european)\b/i.test(text)) return 'europe'
  if (/미국(?:\s*(?:AI|ai|회사|기업|모델))?/.test(text) || /\b(?:american|us)\s+ai\b/i.test(text) || /\bus\s+compan/i.test(text)) {
    return 'us'
  }
  return null
}

function findField(text: string): { arena: AirankArena; category: string } | { unsupported: true } | null {
  for (const spec of SUPPORTED_FIELDS) {
    if (spec.re.test(text)) return { arena: spec.arena, category: spec.category }
  }
  if (UNSUPPORTED_FIELD.test(text)) return { unsupported: true }
  return null
}

function findTopN(text: string): number | null {
  const m =
    text.match(/상위\s*(\d+)/) ||
    text.match(/탑\s*(\d+)/) ||
    text.match(/(\d+)\s*위\s*안/) ||
    text.match(/top\s*-?\s*(\d+)/i)
  if (!m) return null
  const n = Number(m[1])
  return Number.isInteger(n) ? n : null
}

function isRank1(text: string): boolean {
  return /(?:^|[^\d])1\s*위|(?:^|[^\d])1\s*등|#\s*1|\brank\s*#?\s*1\b|number one|\bno\.?\s*1\b/i.test(text)
}

function parseDeadline(text: string, now: Date): string | null {
  const today = kstParts(now)
  if (/내일/.test(text) || /\btomorrow\b/i.test(text)) return addDays(today.ymd, 1)
  if (/오늘/.test(text) || /\btoday\b/i.test(text)) return today.ymd
  if (/내년\s*말/.test(text) || /end of next year/i.test(text)) return `${today.y + 1}-12-31`
  if (/연말|올해\s*말|end of (?:the )?year|year[- ]end/i.test(text)) return `${today.y}-12-31`

  const iso = text.match(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/)
  if (iso) return ymd(Number(iso[1]), Number(iso[2]), Number(iso[3]))

  const koFull = text.match(/(20\d{2})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일/)
  if (koFull) return ymd(Number(koFull[1]), Number(koFull[2]), Number(koFull[3]))

  const koDay = text.match(/(\d{1,2})\s*월\s*(\d{1,2})\s*일/)
  if (koDay) {
    const month = Number(koDay[1])
    const day = Number(koDay[2])
    let year = today.y
    const candidate = ymd(year, month, day)
    if (candidate < today.ymd) year += 1
    return ymd(year, month, day)
  }

  const koMonthEnd = text.match(/(?:다음\s*해|내년)?\s*(\d{1,2})\s*월\s*말/)
  if (koMonthEnd) {
    const month = Number(koMonthEnd[1])
    let year = today.y
    let stamp = lastDayOfMonth(year, month)
    if (stamp < today.ymd) stamp = lastDayOfMonth(year + 1, month)
    return stamp
  }

  const en = text.match(/\b(?:by|before|on|until)?\s*(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})(?:st|nd|rd|th)?(?:\s*,?\s*(20\d{2}))?/i)
  if (en) {
    const month = MONTHS[en[1].toLowerCase()]
    const day = Number(en[2])
    let year = en[3] ? Number(en[3]) : today.y
    if (!month || !day) return null
    let stamp = ymd(year, month, day)
    if (!en[3] && stamp < today.ymd) stamp = ymd(year + 1, month, day)
    return stamp
  }

  const weeks = text.match(/(\d+)\s*주\s*안(?:에)?/)
  if (weeks) return addDays(today.ymd, Number(weeks[1]) * 7)
  const months = text.match(/(\d+)\s*개월\s*안(?:에)?/)
  if (months) return addMonths(today.ymd, Number(months[1]))

  if (/이번\s*주\s*말|this sunday|end of (?:this )?week/i.test(text)) {
    const add = (7 - today.dow) % 7
    return addDays(today.ymd, add)
  }
  if (/다음\s*주(?:\s*말)?|next sunday|next week/i.test(text)) {
    const add = ((7 - today.dow) % 7) + 7
    return addDays(today.ymd, add === 7 && today.dow === 0 ? 7 : add)
  }

  if (/다음\s*달\s*말|다음달\s*말|end of next month/i.test(text)) {
    const m = today.m === 12 ? 1 : today.m + 1
    const y = today.m === 12 ? today.y + 1 : today.y
    return lastDayOfMonth(y, m)
  }
  if (/이번\s*달\s*말|이달\s*말|월말|end of (?:this )?month|month[- ]end/i.test(text)) {
    return lastDayOfMonth(today.y, today.m)
  }
  if (/다음\s*달|다음달|next month/i.test(text)) {
    const m = today.m === 12 ? 1 : today.m + 1
    const y = today.m === 12 ? today.y + 1 : today.y
    return lastDayOfMonth(y, m)
  }
  if (/이번\s*달|이달|this month/i.test(text)) {
    return lastDayOfMonth(today.y, today.m)
  }
  return null
}

function defaultDeadline(now: Date): string {
  const today = kstParts(now)
  const end = lastDayOfMonth(today.y, today.m)
  if (calendarDays(today.ymd, end) >= 6) return end
  const m = today.m === 12 ? 1 : today.m + 1
  const y = today.m === 12 ? today.y + 1 : today.y
  return lastDayOfMonth(y, m)
}

export function isAirankRankingQuestion(text: string): boolean {
  if (RANK_HARD.test(text)) return true
  if (RANK_SOFT.test(text) && (findBrandHits(text).length > 0 || findCamp(text) || findVersioned(text))) {
    return true
  }
  return false
}

export function parseAirankPrompt(raw: string, now: Date = new Date()): AirankParseResult {
  const text = raw.trim()
  if (!text) return { ok: false, code: 'vague_claim' }
  if (!isAirankRankingQuestion(text)) return { ok: false, code: 'vague_claim' }

  const field = findField(text)
  if (field && 'unsupported' in field) return { ok: false, code: 'unsupported_field' }
  const arena = field && 'arena' in field ? field.arena : 'text'
  const category = field && 'category' in field ? field.category : 'overall'

  const deadlineYmd = parseDeadline(text, now) ?? defaultDeadline(now)
  const horizon = airankHorizonFromDeadline(deadlineYmd, now)
  if (!horizon.ok) return horizon

  const versioned = findVersioned(text)
  const masked = versioned ? maskRange(text, versioned.index, versioned.length) : text
  const brands = findBrandHits(masked)
  const camp = findCamp(text)
  const topN = findTopN(text)
  const compare = COMPARE.test(text)
  const locale: 'ko' | 'en' = /[\uAC00-\uD7A3]/.test(text) ? 'ko' : 'en'

  let kind: AirankKind
  let subject: string
  let param: string | undefined

  if (versioned && !compare) {
    kind = 'model_rank1'
    subject = versioned.token
  } else if (brands.length >= 2 && compare) {
    kind = 'brand_above'
    subject = brands[0]!.brand
    param = brands[1]!.brand
    if (subject === param) return { ok: false, code: 'vague_claim' }
  } else if (brands.length >= 1 && topN != null && topN >= 2) {
    kind = 'brand_topn'
    subject = brands[0]!.brand
    param = String(topN)
  } else if (brands.length >= 1) {
    kind = 'brand_rank1'
    subject = brands[0]!.brand
  } else if (camp && topN != null && topN >= 2) {
    kind = 'camp_topn'
    subject = camp
    param = String(topN)
  } else if (camp) {
    kind = 'camp_rank1'
    subject = camp
  } else {
    return { ok: false, code: 'vague_claim' }
  }

  if ((kind === 'brand_topn' || kind === 'camp_topn') && (Number(param) < 2 || Number(param) > 10)) {
    return { ok: false, code: 'vague_claim' }
  }

  const parts: AirankParts = {
    arena,
    category,
    kind,
    subject,
    ...(param ? { param } : {}),
    deadlineYmd,
  }
  const instrument = encodeAirankInstrument({ ...parts, horizon: horizon.horizon })
  const decodedBrand = brandFromOrganization(subject)
  const label =
    kind === 'camp_rank1' || kind === 'camp_topn'
      ? locale === 'ko'
        ? campLabelKo(subject)
        : campLabelEn(subject)
      : locale === 'ko'
        ? koreanBrandLabel(decodedBrand ?? subject)
        : subject
  return { ok: true, parts, horizon: horizon.horizon, locale, instrument, label }
}

function campLabelKo(camp: string): string {
  if (camp === 'china') return '중국 AI'
  if (camp === 'us') return '미국 AI'
  if (camp === 'europe') return '유럽 AI'
  return camp
}

function campLabelEn(camp: string): string {
  if (camp === 'china') return 'Chinese AI'
  if (camp === 'us') return 'US AI'
  if (camp === 'europe') return 'European AI'
  return camp
}

function koreanBrandLabel(brand: string): string {
  const map: Record<string, string> = {
    OpenAI: '오픈AI',
    Google: '구글',
    Anthropic: '클로드',
    xAI: '그록',
    DeepSeek: '딥시크',
    'Alibaba/Qwen': '알리바바',
    Moonshot: '문샷',
    'Zhipu/GLM': '지푸',
    MiniMax: '미니맥스',
    Meta: '메타',
    Mistral: '미스트랄',
    'Black Forest Labs': '플럭스',
    Runway: '런웨이',
    'Kuaishou (Kling)': '클링',
    Luma: '루마',
    Pika: '피카',
    Ideogram: '아이디오그램',
    Recraft: '리크래프트',
  }
  return map[brand] ?? brand
}

export function isAirankCampSubject(value: string): value is AirankCamp {
  return isAirankCamp(value)
}

/** Reconstruct the ranked-round seed from an AIRANK instrument (generate / card). */
export function buildAirankRankedRoundInput(
  instrument: string,
  uiHorizon?: string | null,
  now: Date = new Date(),
  locale: 'ko' | 'en' = 'en',
) {
  const parts = decodeAirankInstrument(instrument)
  if (!parts) return null
  const fromDeadline = airankHorizonFromDeadline(parts.deadlineYmd, now)
  const horizon =
    uiHorizon && isAirankHorizon(uiHorizon)
      ? uiHorizon
      : fromDeadline.ok
        ? fromDeadline.horizon
        : '1m'
  const loc = locale === 'ko' ? 'ko' : 'en'
  return {
    proposition_text: airankPropositionText(parts, loc),
    category: AIRANK_LEDGER_CATEGORY,
    instrument,
    horizon,
    resolution_rule: airankResolutionRule(parts, loc),
    resolves_at: `${parts.deadlineYmd}T23:59:59.999Z`,
    item_type: 'ranked' as const,
    cache_key: `airank|${instrument}|${horizon}`,
    proposition_kind: 'binary_subject_outcome' as const,
    subject_label: airankSubjectLabel(parts, loc),
    observation_shape: 'occurrence' as const,
    propositions: airankAllPropositions(parts),
  }
}
