import type { LeagueLocale } from './i18n/locales'
import type { LeagueUiPack } from './i18n/dictionary'
import { normalizeSessionDate } from '../prediction/resolution'

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
 * `USD/KRW` and `USD/JPY` quote in the SECOND currency (Twelve Data
 * base/quote convention), everything else in this catalog quotes in USD.
 */
export function currencyGlyph(instrument: string): string {
  if (instrument.includes('/')) {
    const quote = instrument.split('/')[1]?.toUpperCase()
    if (quote === 'KRW') return '\u20a9'
    if (quote === 'JPY') return '\u00a5'
    if (quote === 'USD') return '$'
    return ''
  }
  return '$'
}

export function formatInstrumentPrice(instrument: string, value: number): string {
  const decimals = Math.abs(value) < 10 ? 4 : 2
  const formatted = value.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
  return `${currencyGlyph(instrument)}${formatted}`
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

export function headerHeadline(args: {
  roundDate: string
  instrument: string
  anchorPrice: number | null
  anchorSessionDate: string | null
  locale: LeagueLocale
  t: LeagueUiPack
}): string {
  if (args.anchorPrice === null) {
    return args.t.header.headlineNoAnchor(args.roundDate, args.instrument)
  }
  const session = args.anchorSessionDate ? formatSessionDate(args.anchorSessionDate, args.locale) : ''
  return args.t.header.headlineWithAnchor(
    args.roundDate,
    args.instrument,
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
  locale: LeagueLocale
  t: LeagueUiPack
}): string {
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
