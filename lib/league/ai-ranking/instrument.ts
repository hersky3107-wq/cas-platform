/**
 * AIRANK instrument codec — ledger category `ai_models`.
 *
 * AIRANK:{arena}:{category}:{kind}:{subject}[:{param}]:{deadlineYYYYMMDD}
 *
 * Horizons live on the round (`1w` / `1m` / `3m` only). 1d is rejected.
 * Non-text arenas use the dataset's own `overall` category string.
 */

import {
  AI_VENDOR_BRANDS,
  brandFromOrganization,
  isAirankCamp,
  type AiVendorBrand,
  type AirankCamp,
} from './brands'
import type { LeagueLocale } from '@/lib/league/i18n/locales'
import { LMARENA_ATTRIBUTION } from './meta'

export const AIRANK_PREFIX = 'AIRANK'
export const AIRANK_LEDGER_CATEGORY = 'ai_models' as const

/** Dataset category string for non-text arenas (webdev / vision / image / video / search). */
export const AIRANK_OVERALL_CATEGORY = 'overall'

export const AIRANK_KINDS = [
  'brand_rank1',
  'brand_topn',
  'brand_above',
  'model_rank1',
  'camp_rank1',
  'camp_topn',
  'brand_table',
] as const
export type AirankKind = (typeof AIRANK_KINDS)[number]

export const AIRANK_HORIZONS = ['1w', '1m', '3m'] as const
export type AirankHorizon = (typeof AIRANK_HORIZONS)[number]

export const AIRANK_ARENA_CATEGORIES = {
  text: ['overall', 'coding', 'math', 'creative_writing', 'hard_prompts', 'instruction_following'],
  webdev: [AIRANK_OVERALL_CATEGORY],
  vision: [AIRANK_OVERALL_CATEGORY],
  text_to_image: [AIRANK_OVERALL_CATEGORY],
  text_to_video: [AIRANK_OVERALL_CATEGORY],
  search: [AIRANK_OVERALL_CATEGORY],
} as const

export type AirankArena = keyof typeof AIRANK_ARENA_CATEGORIES

export const AIRANK_TOPN_MIN = 2
export const AIRANK_TOPN_MAX = 10

export type AirankParts = {
  arena: AirankArena
  category: string
  kind: AirankKind
  subject: string
  param?: string
  deadlineYmd: string
}

export type AirankCodecError =
  | 'not_airank'
  | 'malformed'
  | 'unknown_arena'
  | 'unknown_category'
  | 'unknown_kind'
  | 'horizon_1d'
  | 'bad_horizon'
  | 'bad_deadline'
  | 'bad_subject'
  | 'bad_param'
  | 'n_out_of_range'
  | 'unknown_brand'

const DEADLINE_RE = /^(\d{4})(\d{2})(\d{2})$/

export function isAirankInstrument(raw: string | null | undefined): boolean {
  return typeof raw === 'string' && raw.startsWith(`${AIRANK_PREFIX}:`)
}

export function isAirankArena(value: string): value is AirankArena {
  return Object.prototype.hasOwnProperty.call(AIRANK_ARENA_CATEGORIES, value)
}

export function isAirankKind(value: string): value is AirankKind {
  return (AIRANK_KINDS as readonly string[]).includes(value)
}

export function isAirankHorizon(value: unknown): value is AirankHorizon {
  return typeof value === 'string' && (AIRANK_HORIZONS as readonly string[]).includes(value)
}

export function yyyymmddToYmd(raw: string): string | null {
  const m = raw.match(DEADLINE_RE)
  if (!m) return null
  const y = Number(m[1])
  const mo = Number(m[2])
  const d = Number(m[3])
  const dt = new Date(Date.UTC(y, mo - 1, d))
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null
  return `${m[1]}-${m[2]}-${m[3]}`
}

export function ymdToYyyymmdd(ymd: string): string | null {
  const m = ymd.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return null
  return `${m[1]}${m[2]}${m[3]}`
}

export function resolveAirankBrand(raw: string): AiVendorBrand | null {
  const decoded = safeDecode(raw).trim()
  if (!decoded) return null
  const exact = AI_VENDOR_BRANDS.find((b) => b.toLowerCase() === decoded.toLowerCase())
  if (exact) return exact
  const fromOrg = brandFromOrganization(decoded)
  if (fromOrg) return fromOrg
  const dashed = decoded.replace(/-/g, ' ')
  const fromDash = brandFromOrganization(dashed)
  if (fromDash) return fromDash
  const slash = decoded.replace(/-/g, '/')
  return brandFromOrganization(slash)
}

function safeDecode(raw: string): string {
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}

function encodeToken(raw: string): string {
  return encodeURIComponent(raw.trim())
}

export function validateAirankHorizon(horizon: string | null | undefined): AirankCodecError | null {
  if (horizon == null || horizon === '') return null
  if (horizon === '1d') return 'horizon_1d'
  if (!isAirankHorizon(horizon)) return 'bad_horizon'
  return null
}

export type EncodeAirankInput = AirankParts & { horizon?: string | null }

export function encodeAirankInstrument(input: EncodeAirankInput): string {
  const parsed = parseAirankParts(input)
  if (!parsed.ok) throw new Error(`AIRANK encode failed: ${parsed.reason}`)
  const p = parsed.parts
  const deadline = ymdToYyyymmdd(p.deadlineYmd)
  if (!deadline) throw new Error('AIRANK encode failed: bad_deadline')
  const mid =
    p.kind === 'brand_topn' || p.kind === 'brand_above' || p.kind === 'camp_topn'
      ? `${encodeToken(p.subject)}:${encodeToken(p.param!)}`
      : encodeToken(p.subject)
  return `${AIRANK_PREFIX}:${p.arena}:${p.category}:${p.kind}:${mid}:${deadline}`
}

export function decodeAirankInstrument(raw: string): AirankParts | null {
  const parsed = parseAirankInstrument(raw)
  return parsed.ok ? parsed.parts : null
}

export function parseAirankInstrument(
  raw: string,
  horizon?: string | null,
): { ok: true; parts: AirankParts } | { ok: false; reason: AirankCodecError } {
  const hz = validateAirankHorizon(horizon)
  if (hz) return { ok: false, reason: hz }
  if (!isAirankInstrument(raw)) return { ok: false, reason: 'not_airank' }

  const bits = raw.split(':')
  if (bits.length < 6) return { ok: false, reason: 'malformed' }
  const [, arenaRaw, categoryRaw, kindRaw] = bits
  const deadlineRaw = bits[bits.length - 1] ?? ''
  const mid = bits.slice(4, -1)
  if (!arenaRaw || !categoryRaw || !kindRaw || mid.length < 1) return { ok: false, reason: 'malformed' }

  const deadlineYmd = yyyymmddToYmd(deadlineRaw)
  if (!deadlineYmd) return { ok: false, reason: 'bad_deadline' }
  if (!isAirankArena(arenaRaw)) return { ok: false, reason: 'unknown_arena' }
  const allowed = AIRANK_ARENA_CATEGORIES[arenaRaw] as readonly string[]
  if (!allowed.includes(categoryRaw)) return { ok: false, reason: 'unknown_category' }
  if (!isAirankKind(kindRaw)) return { ok: false, reason: 'unknown_kind' }

  return parseAirankParts({
    arena: arenaRaw,
    category: categoryRaw,
    kind: kindRaw,
    subject: safeDecode(mid[0] ?? ''),
    param: mid.length > 1 ? safeDecode(mid.slice(1).join(':')) : undefined,
    deadlineYmd,
    horizon,
  })
}

function parseAirankParts(
  input: EncodeAirankInput,
): { ok: true; parts: AirankParts } | { ok: false; reason: AirankCodecError } {
  const hz = validateAirankHorizon(input.horizon)
  if (hz) return { ok: false, reason: hz }
  if (!isAirankArena(input.arena)) return { ok: false, reason: 'unknown_arena' }
  const allowed = AIRANK_ARENA_CATEGORIES[input.arena] as readonly string[]
  if (!allowed.includes(input.category)) return { ok: false, reason: 'unknown_category' }
  if (!isAirankKind(input.kind)) return { ok: false, reason: 'unknown_kind' }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.deadlineYmd) || !ymdToYyyymmdd(input.deadlineYmd)) {
    return { ok: false, reason: 'bad_deadline' }
  }

  if (input.kind === 'brand_table') {
    const subject = input.subject.trim().toLowerCase()
    if (subject !== 'top5') return { ok: false, reason: 'bad_subject' }
    return {
      ok: true,
      parts: {
        arena: input.arena,
        category: input.category,
        kind: input.kind,
        subject: 'top5',
        deadlineYmd: input.deadlineYmd,
      },
    }
  }

  if (input.kind === 'model_rank1') {
    const subject = input.subject.trim()
    if (subject.length < 2) return { ok: false, reason: 'bad_subject' }
    return {
      ok: true,
      parts: {
        arena: input.arena,
        category: input.category,
        kind: input.kind,
        subject,
        deadlineYmd: input.deadlineYmd,
      },
    }
  }

  if (input.kind === 'camp_rank1' || input.kind === 'camp_topn') {
    const camp = input.subject.trim().toLowerCase()
    if (!isAirankCamp(camp)) return { ok: false, reason: 'bad_subject' }
    if (input.kind === 'camp_rank1') {
      return {
        ok: true,
        parts: {
          arena: input.arena,
          category: input.category,
          kind: input.kind,
          subject: camp,
          deadlineYmd: input.deadlineYmd,
        },
      }
    }
    const n = Number(input.param)
    if (!Number.isInteger(n) || n < AIRANK_TOPN_MIN || n > AIRANK_TOPN_MAX) {
      return { ok: false, reason: 'n_out_of_range' }
    }
    return {
      ok: true,
      parts: {
        arena: input.arena,
        category: input.category,
        kind: input.kind,
        subject: camp,
        param: String(n),
        deadlineYmd: input.deadlineYmd,
      },
    }
  }

  const brand = resolveAirankBrand(input.subject)
  if (!brand) return { ok: false, reason: 'unknown_brand' }

  if (input.kind === 'brand_rank1') {
    return {
      ok: true,
      parts: {
        arena: input.arena,
        category: input.category,
        kind: input.kind,
        subject: brand,
        deadlineYmd: input.deadlineYmd,
      },
    }
  }

  if (input.kind === 'brand_topn') {
    const n = Number(input.param)
    if (!Number.isInteger(n) || n < AIRANK_TOPN_MIN || n > AIRANK_TOPN_MAX) {
      return { ok: false, reason: 'n_out_of_range' }
    }
    return {
      ok: true,
      parts: {
        arena: input.arena,
        category: input.category,
        kind: input.kind,
        subject: brand,
        param: String(n),
        deadlineYmd: input.deadlineYmd,
      },
    }
  }

  const other = resolveAirankBrand(input.param ?? '')
  if (!other) return { ok: false, reason: 'bad_param' }
  if (other === brand) return { ok: false, reason: 'bad_param' }
  return {
    ok: true,
    parts: {
      arena: input.arena,
      category: input.category,
      kind: 'brand_above',
      subject: brand,
      param: other,
      deadlineYmd: input.deadlineYmd,
    },
  }
}

const ATTRIBUTION_I18N: Record<LeagueLocale, string> = {
  en: 'Ranking data: LMArena (CC BY 4.0)',
  ko: LMARENA_ATTRIBUTION,
  ja: '順位データ: LMArena (CC BY 4.0)',
  'zh-TW': '排名資料：LMArena (CC BY 4.0)',
  fr: 'Données de classement : LMArena (CC BY 4.0)',
  ar: 'بيانات الترتيب: LMArena (CC BY 4.0)',
  es: 'Datos de ranking: LMArena (CC BY 4.0)',
  pt: 'Dados de ranking: LMArena (CC BY 4.0)',
}

export function airankAttributionLine(locale: LeagueLocale = 'ko'): string {
  return ATTRIBUTION_I18N[locale] ?? LMARENA_ATTRIBUTION
}

export function horizonDays(horizon: AirankHorizon): number {
  if (horizon === '1w') return 7
  if (horizon === '1m') return 30
  return 90
}

const FIELD_LABEL: Record<string, Record<LeagueLocale, string>> = {
  'text/overall': {
    ko: '종합',
    en: 'overall',
    ja: '総合',
    'zh-TW': '綜合',
    fr: 'général',
    es: 'general',
    pt: 'geral',
    ar: 'عام',
  },
  'text/coding': {
    ko: '코딩',
    en: 'coding',
    ja: 'コーディング',
    'zh-TW': '程式編寫',
    fr: 'programmation',
    es: 'código',
    pt: 'programação',
    ar: 'برمجة',
  },
  'text/math': {
    ko: '수학',
    en: 'math',
    ja: '数学',
    'zh-TW': '數學',
    fr: 'mathématiques',
    es: 'matemáticas',
    pt: 'matemática',
    ar: 'رياضيات',
  },
  'text/creative_writing': {
    ko: '작문',
    en: 'creative writing',
    ja: '文章作成',
    'zh-TW': '創意寫作',
    fr: 'écriture créative',
    es: 'escritura creativa',
    pt: 'escrita criativa',
    ar: 'كتابة إبداعية',
  },
  'text/hard_prompts': {
    ko: '추론',
    en: 'hard prompts',
    ja: '難問・推論',
    'zh-TW': '高難度難題',
    fr: 'invites difficiles',
    es: 'razonamiento difícil',
    pt: 'raciocínio avançado',
    ar: 'استدلال متقدم',
  },
  'text/instruction_following': {
    ko: '지시 따르기',
    en: 'instruction following',
    ja: '指示遵守',
    'zh-TW': '指令遵循',
    fr: 'suivi des instructions',
    es: 'cumplimiento de instrucciones',
    pt: 'seguir instruções',
    ar: 'اتباع التعليمات',
  },
  'webdev/overall': {
    ko: '웹개발',
    en: 'webdev',
    ja: 'Web開発',
    'zh-TW': '網站開發',
    fr: 'développement web',
    es: 'desarrollo web',
    pt: 'desenvolvimento web',
    ar: 'تطوير الويب',
  },
  'text_to_image/overall': {
    ko: '이미지 생성',
    en: 'image generation',
    ja: '画像生成',
    'zh-TW': '圖片生成',
    fr: 'génération d\'images',
    es: 'generación de imágenes',
    pt: 'geração de imagens',
    ar: 'توليد الصور',
  },
  'text_to_video/overall': {
    ko: '영상 생성',
    en: 'video',
    ja: '動画生成',
    'zh-TW': '影片生成',
    fr: 'vidéo',
    es: 'vídeo',
    pt: 'vídeo',
    ar: 'فيديو',
  },
  'vision/overall': {
    ko: '이미지 이해',
    en: 'vision',
    ja: '画像認識',
    'zh-TW': '視覺理解',
    fr: 'vision',
    es: 'visión',
    pt: 'visão',
    ar: 'رؤية حاسوبية',
  },
  'search/overall': {
    ko: '검색',
    en: 'search',
    ja: '検索',
    'zh-TW': '搜尋',
    fr: 'recherche',
    es: 'búsqueda',
    pt: 'pesquisa',
    ar: 'بحث',
  },
}

const BRAND_LABEL_KO: Record<string, string> = {
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
  Microsoft: '마이크로소프트',
  NVIDIA: '엔비디아',
  Amazon: '아마존',
}

const CAMP_LABEL: Record<AirankCamp, Record<LeagueLocale, string>> = {
  us: {
    ko: '미국 AI',
    en: 'US AI',
    ja: '米国AI',
    'zh-TW': '美國AI',
    fr: 'IA américaine',
    es: 'IA estadounidense',
    pt: 'IA dos EUA',
    ar: 'ذكاء اصطناعي أمريكي',
  },
  china: {
    ko: '중국 AI',
    en: 'Chinese AI',
    ja: '中国AI',
    'zh-TW': '中國AI',
    fr: 'IA chinoise',
    es: 'IA china',
    pt: 'IA chinesa',
    ar: 'ذكاء اصطناعي صيني',
  },
  europe: {
    ko: '유럽 AI',
    en: 'European AI',
    ja: '欧州AI',
    'zh-TW': '歐洲AI',
    fr: 'IA européenne',
    es: 'IA europea',
    pt: 'IA europeia',
    ar: 'ذكاء اصطناعي أوروبي',
  },
}

export function fieldLabel(parts: AirankParts, locale: LeagueLocale = 'en'): string {
  const hit = FIELD_LABEL[`${parts.arena}/${parts.category}`]
  return hit ? hit[locale] ?? hit.en : parts.category
}

function iGa(name: string | null | undefined): '이' | '가' {
  if (!name || typeof name !== 'string' || name.length === 0) return '가'
  const last = name.charCodeAt(name.length - 1)
  if (last >= 0xac00 && last <= 0xd7a3) return (last - 0xac00) % 28 === 0 ? '가' : '이'
  return '가'
}

export function airankSubjectLabel(parts: AirankParts, locale: LeagueLocale = 'en'): string {
  if (parts.kind === 'brand_table') return fieldLabel(parts, locale)
  if (parts.kind === 'camp_rank1' || parts.kind === 'camp_topn') {
    const camp = isAirankCamp(parts.subject) ? CAMP_LABEL[parts.subject] : null
    return camp ? camp[locale] ?? camp.en : parts.subject
  }
  if (parts.kind === 'model_rank1') return parts.subject
  const norm =
    Object.keys(BRAND_LABEL_KO).find((k) => k.toLowerCase() === parts.subject.toLowerCase()) ?? parts.subject
  if (locale === 'ko') {
    return BRAND_LABEL_KO[norm] ?? norm
  }
  return norm
}

export function airankResolutionRule(parts: AirankParts, locale: LeagueLocale = 'en'): string {
  if (locale === 'ko') {
    return `${parts.deadlineYmd} 이후 처음 발표되는 LMArena 스냅샷으로 판정합니다. 라운드가 열린 날보다 이른 스냅샷은 쓰지 않습니다.`
  }
  return `First LMArena snapshot published on or after ${parts.deadlineYmd} (never a snapshot from before the round opened). YES if the queried ranking holds; ties on brand_above are NO. Camp kinds are YES if any brand of that camp meets the condition.`
}

/** Server-composed proposition — no user substring. The first-snapshot rule is visible. Localized across all 8 locales. */
export function airankPropositionText(parts: AirankParts, locale: LeagueLocale = 'en'): string {
  const field = fieldLabel(parts, locale)
  const subject = airankSubjectLabel(parts, locale)
  const deadline = parts.deadlineYmd

  if (locale === 'ko') {
    if (parts.kind === 'brand_table') {
      return `${deadline} 이후 처음 발표되는 LMArena ${field} 순위의 상위 5개 브랜드는?`
    }
    const particle = iGa(subject)
    if (parts.kind === 'brand_rank1' || parts.kind === 'model_rank1' || parts.kind === 'camp_rank1') {
      return `${subject}${particle} ${deadline} 이후 처음 발표되는 LMArena ${field} 순위에서 1위일까?`
    }
    if (parts.kind === 'brand_topn' || parts.kind === 'camp_topn') {
      return `${subject}${particle} ${deadline} 이후 처음 발표되는 LMArena ${field} 순위에서 ${parts.param}위 안에 들까?`
    }
    const other = airankSubjectLabel({ ...parts, kind: 'brand_rank1', subject: parts.param ?? '' }, 'ko')
    return `${subject}${particle} ${deadline} 이후 처음 발표되는 LMArena ${field} 순위에서 ${other}보다 위일까?`
  }

  if (locale === 'ja') {
    if (parts.kind === 'brand_table') {
      return `${deadline}以降に最初に発表されるLMArena ${field}ランキングの上位5ブランドは？`
    }
    const first = `${deadline}以降に最初に発表されるLMArena ${field}ランキング`
    if (parts.kind === 'brand_rank1' || parts.kind === 'camp_rank1') {
      return `${subject}は${first}で1位になるか？`
    }
    if (parts.kind === 'model_rank1') {
      return `モデル名に「${parts.subject}」を含むモデルは${first}で1位になるか？`
    }
    if (parts.kind === 'brand_topn' || parts.kind === 'camp_topn') {
      return `${subject}は${first}で${parts.param}位以内に入るか？`
    }
    const other = airankSubjectLabel({ ...parts, kind: 'brand_rank1', subject: parts.param ?? '' }, 'ja')
    return `${subject}は${first}で${other}より上位になるか？`
  }

  if (locale === 'zh-TW') {
    if (parts.kind === 'brand_table') {
      return `${deadline}之後首次發布的LMArena ${field}排名前5品牌是哪些？`
    }
    const first = `${deadline}之後首次發布的LMArena ${field}排名`
    if (parts.kind === 'brand_rank1' || parts.kind === 'camp_rank1') {
      return `${subject}在${first}中會是第1名嗎？`
    }
    if (parts.kind === 'model_rank1') {
      return `名稱包含「${parts.subject}」的模型在${first}中會是第1名嗎？`
    }
    if (parts.kind === 'brand_topn' || parts.kind === 'camp_topn') {
      return `${subject}在${first}中會進入前${parts.param}名嗎？`
    }
    const other = airankSubjectLabel({ ...parts, kind: 'brand_rank1', subject: parts.param ?? '' }, 'zh-TW')
    return `${subject}在${first}中會排在${other}之前嗎？`
  }

  if (locale === 'fr') {
    if (parts.kind === 'brand_table') {
      return `Quelles seront les 5 premières marques du premier classement LMArena ${field} publié à partir du ${deadline} ?`
    }
    const first = `le premier classement LMArena ${field} publié à partir du ${deadline}`
    if (parts.kind === 'brand_rank1' || parts.kind === 'camp_rank1') {
      return `${subject} sera-t-il n°1 dans ${first} ?`
    }
    if (parts.kind === 'model_rank1') {
      return `Un modèle dont le nom contient « ${parts.subject} » sera-t-il n°1 dans ${first} ?`
    }
    if (parts.kind === 'brand_topn' || parts.kind === 'camp_topn') {
      return `${subject} figurera-t-il dans le top ${parts.param} de ${first} ?`
    }
    const other = airankSubjectLabel({ ...parts, kind: 'brand_rank1', subject: parts.param ?? '' }, 'fr')
    return `${subject} sera-t-il classé devant ${other} dans ${first} ?`
  }

  if (locale === 'es') {
    if (parts.kind === 'brand_table') {
      return `¿Cuáles serán las 5 primeras marcas del primer ranking LMArena de ${field} publicado a partir del ${deadline}?`
    }
    const first = `el primer ranking LMArena de ${field} publicado a partir del ${deadline}`
    if (parts.kind === 'brand_rank1' || parts.kind === 'camp_rank1') {
      return `¿Será ${subject} el n.° 1 en ${first}?`
    }
    if (parts.kind === 'model_rank1') {
      return `¿Será el n.° 1 un modelo cuyo nombre contenga "${parts.subject}" en ${first}?`
    }
    if (parts.kind === 'brand_topn' || parts.kind === 'camp_topn') {
      return `¿Estará ${subject} entre los primeros ${parts.param} en ${first}?`
    }
    const other = airankSubjectLabel({ ...parts, kind: 'brand_rank1', subject: parts.param ?? '' }, 'es')
    return `¿Estará ${subject} por encima de ${other} en ${first}?`
  }

  if (locale === 'pt') {
    if (parts.kind === 'brand_table') {
      return `Quais serão as 5 primeiras marcas do primeiro ranking LMArena de ${field} publicado a partir de ${deadline}?`
    }
    const first = `o primeiro ranking LMArena de ${field} publicado a partir de ${deadline}`
    if (parts.kind === 'brand_rank1' || parts.kind === 'camp_rank1') {
      return `O ${subject} será o nº 1 em ${first}?`
    }
    if (parts.kind === 'model_rank1') {
      return `Um modelo cujo nome contenha "${parts.subject}" será o nº 1 em ${first}?`
    }
    if (parts.kind === 'brand_topn' || parts.kind === 'camp_topn') {
      return `O ${subject} ficará entre os ${parts.param} primeiros em ${first}?`
    }
    const other = airankSubjectLabel({ ...parts, kind: 'brand_rank1', subject: parts.param ?? '' }, 'pt')
    return `O ${subject} ficará acima de ${other} em ${first}?`
  }

  if (locale === 'ar') {
    if (parts.kind === 'brand_table') {
      return `ما هي أفضل 5 علامات في أول تصنيف LMArena لـ ${field} يصدر في أو بعد ${deadline}؟`
    }
    const first = `أول تصنيف LMArena لـ ${field} يصدر في أو بعد ${deadline}`
    if (parts.kind === 'brand_rank1' || parts.kind === 'camp_rank1') {
      return `هل سيحتل ${subject} المركز الأول في ${first}؟`
    }
    if (parts.kind === 'model_rank1') {
      return `هل سيحتل نموذج يحتوي اسمه على "${parts.subject}" المركز الأول في ${first}؟`
    }
    if (parts.kind === 'brand_topn' || parts.kind === 'camp_topn') {
      return `هل سيكون ${subject} ضمن أفضل ${parts.param} في ${first}؟`
    }
    const other = airankSubjectLabel({ ...parts, kind: 'brand_rank1', subject: parts.param ?? '' }, 'ar')
    return `هل سيتقدم ${subject} على ${other} في ${first}؟`
  }

  // Default English ('en')
  if (parts.kind === 'brand_table') {
    return `What are the top 5 brands on the first LMArena ${field} ranking published on or after ${deadline}?`
  }
  const first = `the first LMArena ${field} ranking published on or after ${deadline}`
  if (parts.kind === 'brand_rank1' || parts.kind === 'camp_rank1') {
    return `Will ${subject} be #1 on ${first}?`
  }
  if (parts.kind === 'brand_topn' || parts.kind === 'camp_topn') {
    return `Will ${subject} rank in the top ${parts.param} on ${first}?`
  }
  if (parts.kind === 'brand_above') {
    const other = airankSubjectLabel({ ...parts, kind: 'brand_rank1', subject: parts.param ?? '' }, 'en')
    return `Will ${subject} rank above ${other} on ${first}?`
  }
  return `Will a model whose name contains "${parts.subject}" be #1 on ${first}?`
}

export function airankAllPropositions(parts: AirankParts): Record<LeagueLocale, string> {
  return {
    ko: airankPropositionText(parts, 'ko'),
    en: airankPropositionText(parts, 'en'),
    ja: airankPropositionText(parts, 'ja'),
    'zh-TW': airankPropositionText(parts, 'zh-TW'),
    fr: airankPropositionText(parts, 'fr'),
    es: airankPropositionText(parts, 'es'),
    pt: airankPropositionText(parts, 'pt'),
    ar: airankPropositionText(parts, 'ar'),
  }
}
