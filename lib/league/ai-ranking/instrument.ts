/**
 * AIRANK instrument codec — ledger category `ai_models`.
 *
 * AIRANK:{arena}:{category}:{kind}:{subject}[:{param}]:{deadlineYYYYMMDD}
 *
 * Horizons live on the round (`1w` / `1m` / `3m` only). 1d is rejected.
 * Non-text arenas use the dataset's own `overall` category string.
 */

import { AI_VENDOR_BRANDS, brandFromOrganization, type AiVendorBrand } from './brands'
import type { LeagueLocale } from '@/lib/league/i18n/locales'
import { LMARENA_ATTRIBUTION } from './meta'

export const AIRANK_PREFIX = 'AIRANK'
export const AIRANK_LEDGER_CATEGORY = 'ai_models' as const

/** Dataset category string for non-text arenas (webdev / vision / image / video / search). */
export const AIRANK_OVERALL_CATEGORY = 'overall'

export const AIRANK_KINDS = ['brand_rank1', 'brand_topn', 'brand_above', 'model_rank1'] as const
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
    p.kind === 'brand_topn' || p.kind === 'brand_above'
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

/** Server-composed proposition — no user substring. */
export function airankPropositionText(parts: AirankParts): string {
  const field = `LMArena ${parts.arena}/${parts.category}`
  if (parts.kind === 'brand_rank1') {
    return `Will ${parts.subject} hold rank 1 on ${field} on ${parts.deadlineYmd}?`
  }
  if (parts.kind === 'brand_topn') {
    return `Will ${parts.subject} rank in the top ${parts.param} on ${field} on ${parts.deadlineYmd}?`
  }
  if (parts.kind === 'brand_above') {
    return `Will ${parts.subject} rank above ${parts.param} on ${field} on ${parts.deadlineYmd}?`
  }
  return `Will a model whose name contains "${parts.subject}" hold rank 1 on ${field} on ${parts.deadlineYmd}?`
}
