import type { LeagueLocale } from './i18n/locales'
import type { LeagueUiPack } from './i18n/dictionary'
import { propositionKindOf } from './side-labels'
import { normalizeSessionDate } from '../prediction/resolution'
import { decodeEntertainmentInstrument } from './gateway/adapters/entertainment-catalog'
import { decodePoliticsInstrument } from './gateway/adapters/politics-catalog'
import { decodeSportsInstrument } from './gateway/adapters/sports-catalog'
import { electionHeadlineLabel, politicsPropositionDisplay } from './politics-display'
import { entertainmentHeadlineLabel, entertainmentPropositionDisplay } from './entertainment-display'
import { propertyInstrumentDisplay, propertyPropositionDisplay } from './real-estate-display'
import { decodePropertyInstrument } from './gateway/adapters/real-estate-catalog'
import { stockQuoteSymbol, decodeStockInstrument } from './gateway/adapters/stock-catalog'
import { decodeKrStockInstrument } from './korea-equity-catalog'
import { krStockPropositionDisplay, parseKrStockProposition } from './korea-stock-display'
import { sportsPropositionDisplay, sportsVsLabel } from './sports-display'
import { publicFacingLabel } from './public-label'
import {
  decodeAirankInstrument,
  isAirankInstrument,
  airankSubjectLabel,
  fieldLabel,
  airankPropositionText,
} from './ai-ranking/instrument'
import { brandTableHeader, isBrandTableParts } from './ai-ranking/brand-table'

/** BCP 47 tag `Intl` understands for each league locale. */
export function localeTag(locale: LeagueLocale): string {
  return locale
}

/**
 * Formats a persisted YYYY-MM-DD session date as a calendar date.
 * MUST be timezone-stable: `new Date('2026-08-17')` is UTC midnight and
 * prints as Aug 16 in the Americas. We format in UTC so Aug 17 stays Aug 17.
 */
export function formatSessionDate(ymd: string, locale: LeagueLocale): string {
  const date = normalizeSessionDate(ymd)
  if (!date) return ''
  const [year, month, day] = date.split('-').map(Number)
  const utc = new Date(Date.UTC(year, month - 1, day))
  return utc.toLocaleDateString(localeTag(locale), {
    timeZone: 'UTC',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

export function formatToday(locale: LeagueLocale, now: Date = new Date()): string {
  return now.toLocaleDateString(localeTag(locale), {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

/**
 * Best-effort currency glyph from the instrument string. Presentation only —
 * quote currency is the SECOND code (Twelve Data base/quote). USD/KRW and
 * JPY/KRW quote in won; USD/JPY, EUR/JPY, GBP/JPY quote in yen; USD/CNH in
 * offshore yuan; USD-quoted pairs (EUR/USD, GBP/USD, AUD/USD, XAU/USD) in $.
 */
export function currencyGlyph(instrument: string): string {
  if (decodeKrStockInstrument(instrument)) return '\u20a9'
  if (instrument.includes('/')) {
    const quote = instrument.split('/')[1]?.toUpperCase()
    if (quote === 'KRW') return '\u20a9'
    if (quote === 'JPY') return '\u00a5'
    if (quote === 'CNH' || quote === 'CNY') return 'CN\u00a5'
    if (quote === 'USD') return '$'
    return ''
  }
  return '$'
}

export function formatInstrumentPrice(instrument: string, value: number): string {
  if (decodeKrStockInstrument(instrument)) {
    return `${Math.round(value).toLocaleString('ko-KR')}원`
  }
  const decimals = Math.abs(value) < 10 ? 4 : 2
  const formatted = value.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
  return `${currencyGlyph(instrument)}${formatted}`
}

/** Card header instrument for KRSTOCK: "{Korean name}({code})", never the bare code. */
export function krStockCardTitle(
  instrument: string,
  subjectLabel?: string | null,
  propositionText?: string | null,
): string | null {
  const kr = decodeKrStockInstrument(instrument)
  if (!kr) return null
  const fromLabel = subjectLabel?.trim()
  if (fromLabel) return `${fromLabel}(${kr.code})`
  const parsed = propositionText ? parseKrStockProposition(propositionText) : null
  if (parsed?.name.trim()) return `${parsed.name.trim()}(${parsed.code})`
  return null
}

/**
 * Calendar date of `opened_at` (UTC day). Used as the card headline date so an
 * archived round cannot read as "today".
 */
export function formatRoundOpenedDate(openedAt: string, locale: LeagueLocale): string {
  const ymd = openedAt.slice(0, 10)
  const labeled = formatSessionDate(ymd, locale)
  return labeled || ymd
}

export function sportsInstrumentDisplay(instrument: string, locale: LeagueLocale = 'en'): string | null {
  return sportsVsLabel(instrument, locale)
}

export function electionInstrumentDisplay(instrument: string, locale: LeagueLocale = 'en'): string | null {
  return electionHeadlineLabel(instrument, locale)
}

export function showInstrumentDisplay(instrument: string, locale: LeagueLocale = 'en'): string | null {
  return entertainmentHeadlineLabel(instrument, locale)
}

function shownPriceInstrument(
  instrument: string,
  subjectLabel?: string | null,
  propositionText?: string | null,
): string {
  const titled = krStockCardTitle(instrument, subjectLabel, propositionText)
  if (titled) return titled
  return decodeStockInstrument(instrument) ? stockQuoteSymbol(instrument) : instrument
}

export function formatAirankHorizonLabel(
  horizon: string | null | undefined,
  locale: LeagueLocale,
  t?: LeagueUiPack,
): string {
  const hz = horizon?.trim() || '1m'
  const catalogHz = hz as '1d' | '1w' | '1m' | '3m'
  if (t?.catalog.horizons[catalogHz]) {
    return t.catalog.horizons[catalogHz]
  }
  const HORIZONS: Record<LeagueLocale, Record<string, string>> = {
    ko: { '1w': '1주일', '1m': '1개월', '3m': '3개월' },
    en: { '1w': '1 week', '1m': '1 month', '3m': '3 months' },
    ja: { '1w': '1週間', '1m': '1ヶ月', '3m': '3ヶ月' },
    'zh-TW': { '1w': '1週', '1m': '1個月', '3m': '3個月' },
    fr: { '1w': '1 semaine', '1m': '1 mois', '3m': '3 mois' },
    es: { '1w': '1 semana', '1m': '1 mes', '3m': '3 meses' },
    pt: { '1w': '1 semana', '1m': '1 mês', '3m': '3 meses' },
    ar: { '1w': 'أسبوع', '1m': 'شهر', '3m': '3 أشهر' },
  }
  return HORIZONS[locale]?.[hz] ?? hz
}

const RANK_WORD: Record<LeagueLocale, string> = {
  ko: '순위',
  en: 'rank',
  ja: '順位',
  'zh-TW': '排名',
  fr: 'classement',
  es: 'ranking',
  pt: 'ranking',
  ar: 'تصنيف',
}

function airankHeaderSubject(subjectOrParam: string, locale: LeagueLocale): string {
  const norm = subjectOrParam.trim()
  if (locale === 'ko') {
    if (norm.toLowerCase() === 'anthropic') return '앤트로픽'
    if (norm.toLowerCase() === 'openai') return '오픈AI'
    if (norm.toLowerCase() === 'google') return '구글'
    if (norm.toLowerCase() === 'meta') return '메타'
  }
  return norm
}

export function airankInstrumentDisplay(
  instrument: string,
  locale: LeagueLocale = 'en',
  horizon?: string | null,
  t?: LeagueUiPack,
): string | null {
  if (!isAirankInstrument(instrument)) return null
  const parts = decodeAirankInstrument(instrument)
  if (!parts) return null

  const subject = airankHeaderSubject(parts.subject, locale)
  const field = fieldLabel(parts, locale)
  const horizonLabel = formatAirankHorizonLabel(horizon ?? parts.horizon ?? '1m', locale, t)
  const rankWord = RANK_WORD[locale] ?? RANK_WORD.en

  if (isBrandTableParts(parts)) {
    return brandTableHeader(parts, horizon ?? '1m', locale)
  }

  if (parts.kind === 'brand_above') {
    const other = airankHeaderSubject(parts.param ?? '', locale)
    return `${subject} vs ${other} · ${field} ${rankWord} · ${horizonLabel}`
  }
  if (parts.kind === 'brand_topn' || parts.kind === 'camp_topn') {
    const n = parts.param ?? '3'
    if (locale === 'ko') return `${subject} · ${field} ${n}위 안 · ${horizonLabel}`
    if (locale === 'ja') return `${subject} · ${field} ${n}位以内 · ${horizonLabel}`
    if (locale === 'zh-TW') return `${subject} · ${field} 前${n}名 · ${horizonLabel}`
    return `${subject} · ${field} top ${n} · ${horizonLabel}`
  }
  // brand_rank1 / model_rank1 / camp_rank1
  if (locale === 'ko') return `${subject} · ${field} 1위 · ${horizonLabel}`
  if (locale === 'ja') return `${subject} · ${field} 1位 · ${horizonLabel}`
  if (locale === 'zh-TW') return `${subject} · ${field} 第1名 · ${horizonLabel}`
  return `${subject} · ${field} #1 · ${horizonLabel}`
}

export function nonPriceInstrumentDisplay(
  instrument: string,
  locale: LeagueLocale,
  horizon?: string | null,
  t?: LeagueUiPack,
): string {
  return publicFacingLabel(
    airankInstrumentDisplay(instrument, locale, horizon, t) ??
      sportsInstrumentDisplay(instrument, locale) ??
      electionInstrumentDisplay(instrument, locale) ??
      showInstrumentDisplay(instrument, locale) ??
      propertyInstrumentDisplay(instrument, locale) ??
      '',
    '',
  )
}

/** Localized proposition for curated sports fixtures and election picks. */
export function rankedPropositionDisplay(
  instrument: string,
  stored: string,
  locale: LeagueLocale,
  propositions?: Record<string, string> | null,
): string {
  if (propositions && typeof propositions === 'object') {
    if (propositions[locale]?.trim()) return publicFacingLabel(propositions[locale].trim(), stored)
    if (propositions.en?.trim()) return publicFacingLabel(propositions.en.trim(), stored)
    if (propositions.ko?.trim()) return publicFacingLabel(propositions.ko.trim(), stored)
  }
  if (isAirankInstrument(instrument)) {
    const parts = decodeAirankInstrument(instrument)
    if (parts) return airankPropositionText(parts, locale)
  }
  if (decodeSportsInstrument(instrument)) {
    return publicFacingLabel(sportsPropositionDisplay(instrument, stored, locale), stored)
  }
  if (decodePoliticsInstrument(instrument)) {
    return publicFacingLabel(politicsPropositionDisplay(instrument, stored, locale), stored)
  }
  if (decodeEntertainmentInstrument(instrument)) {
    return publicFacingLabel(entertainmentPropositionDisplay(instrument, stored, locale), stored)
  }
  if (decodePropertyInstrument(instrument)) {
    return publicFacingLabel(propertyPropositionDisplay(instrument, stored, locale), stored)
  }
  if (decodeKrStockInstrument(instrument)) {
    return publicFacingLabel(krStockPropositionDisplay(instrument, stored, locale), stored)
  }
  return publicFacingLabel(stored, '')
}

export function headerHeadline(args: {
  roundDate: string
  instrument: string
  anchorPrice: number | null
  anchorSessionDate: string | null
  /** The round's proposition_kind. Omitted/unknown = close_higher, so every existing caller is byte-identical. */
  propositionKind?: string | null
  /** KRSTOCK: universe / stored Korean name for "{name}({code})". */
  subjectLabel?: string | null
  propositionText?: string | null
  horizon?: string | null
  locale: LeagueLocale
  t: LeagueUiPack
}): string {
  if (propositionKindOf({ proposition_kind: args.propositionKind }) !== 'binary_close_higher') {
    // Non-price contract: no anchor price EXISTS, so neither the price form
    // nor the "starting price unavailable" apology is the truth.
    const displayInst = publicFacingLabel(
      nonPriceInstrumentDisplay(args.instrument, args.locale, args.horizon, args.t),
      args.subjectLabel || args.propositionText || '',
    )
    return args.t.header.headlinePlain(args.roundDate, displayInst)
  }
  if (args.anchorPrice === null) {
    const shown = shownPriceInstrument(args.instrument, args.subjectLabel, args.propositionText)
    return args.t.header.headlineNoAnchor(args.roundDate, shown)
  }
  const session = args.anchorSessionDate ? formatSessionDate(args.anchorSessionDate, args.locale) : ''
  const shown = shownPriceInstrument(args.instrument, args.subjectLabel, args.propositionText)
  return args.t.header.headlineWithAnchor(
    args.roundDate,
    shown,
    formatInstrumentPrice(args.instrument, args.anchorPrice),
    session
  )
}

/**
 * Audit sentence. Built ONLY from persisted session dates — never from
 * `anchor_price_at` or `resolves_at`. If either date is missing we refuse
 * to invent one.
 *
 * `resolutionPrice` is optional: when a round has graded, both surfaces (the
 * card header and the record room) pass the persisted resolution close so the
 * sentence names the exact number the round was resolved against. Because both
 * call THIS function with the same round fields, the two surfaces can never
 * disagree. When it is absent (an open round, or the price was never recorded)
 * the sentence falls back to the session-dates-only form.
 */
export function headerWindow(args: {
  instrument: string
  anchorPrice: number | null
  anchorSessionDate: string | null
  resolutionSessionDate: string | null
  resolutionPrice?: number | null
  /** The round's proposition_kind. Omitted/unknown = close_higher, so every existing caller is byte-identical. */
  propositionKind?: string | null
  locale: LeagueLocale
  t: LeagueUiPack
}): string {
  // Close-to-close audit sentences are a PRICE-round concept. For the other
  // contracts there are no session closes to name; return '' so callers blank
  // the line instead of rendering "no starting price was recorded" — which
  // would be an apology for a number that never existed.
  if (propositionKindOf({ proposition_kind: args.propositionKind }) !== 'binary_close_higher') return ''
  if (args.anchorPrice === null) return args.t.header.windowNoAnchor
  const fromDate = args.anchorSessionDate ? formatSessionDate(args.anchorSessionDate, args.locale) : ''
  const toDate = args.resolutionSessionDate ? formatSessionDate(args.resolutionSessionDate, args.locale) : ''
  const price = formatInstrumentPrice(args.instrument, args.anchorPrice)
  if (fromDate && toDate) {
    if (args.resolutionPrice !== null && args.resolutionPrice !== undefined) {
      return args.t.header.windowResolved(
        fromDate,
        price,
        toDate,
        formatInstrumentPrice(args.instrument, args.resolutionPrice)
      )
    }
    return args.t.header.windowWithAnchor(fromDate, price, toDate)
  }
  if (fromDate) return args.t.header.windowAnchorOnly(fromDate, price)
  return args.t.header.windowNoSessionDates
}
