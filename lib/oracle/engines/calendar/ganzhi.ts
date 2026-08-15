/**
 * Core ganzhi (干支) calendar functions: toLunar, toSolar, solarTerms, fourPillars.
 * Wraps lunar-javascript through ./lunar-adapter, with the two corrections
 * documented in docs/calendar-verification.md:
 *  1. Year/month pillar resolution uses Beijing-equivalent (UTC+8) civil
 *     fields, because the library's internal jieqi table is expressed in
 *     China Standard Time regardless of caller timezone.
 *  2. Year/month pillar resolution uses the `*Exact` accessor family
 *     (full datetime comparison), never the date-only default/`ByLiChun`
 *     accessors.
 * Day pillar uses the true local civil date directly (jieqi-independent).
 * Hour pillar is computed by the standard 五鼠遁 formula from the local day
 * stem (not the library's getTimeGan/getTimeZhi), because that accessor
 * silently applies a "late zi-hour" (야자시) day+1 rollover for the last
 * two hours of the day — an inconsistent-with-day-pillar default we do not
 * want. See docs/calendar-verification.md.
 */
import type { BranchInfo, DateTimeInput, FourPillars, LunarCalendarDate, Pillar, SolarCalendarDate, SolarTermInstant, StemInfo } from './types'
import { BRANCHES, STEMS, SOLAR_TERMS_CALENDAR_YEAR_ORDER, branchByHanja, stemByHanja } from './tables'
import { lunarFromYmd, solarFromYmd, solarFromYmdHms, type RawJieQiHandle } from './lunar-adapter'
import { CalendarInputError } from './errors'
import { assertYearInRange, beijingEquivalentFields, formatYmd, parseTimeOrNull, parseYmd, resolveInstantUtc } from './utils'

function pillar(stem: StemInfo, branch: BranchInfo): Pillar {
  return { stem, branch, ganzhi: stem.hanja + branch.hanja }
}

function hourPillarFromDayStem(dayStem: StemInfo, hour: number): Pillar {
  const branchIndex = Math.floor(((hour + 1) % 24) / 2) % 12
  const startStemIndex = (dayStem.index % 5) * 2
  const stemIndex = (startStemIndex + branchIndex) % 10
  return pillar(STEMS[stemIndex]!, BRANCHES[branchIndex]!)
}

/** Gregorian (solar) calendar date -> lunar calendar date. Pure calendar-date mapping; no time/tz involved. */
export function toLunar(input: SolarCalendarDate): LunarCalendarDate {
  const { y, m, d } = parseYmd(input.date)
  assertYearInRange(y)
  const lunar = solarFromYmd(y, m, d).getLunar()
  const rawMonth = lunar.getMonth()
  return {
    year: lunar.getYear(),
    month: Math.abs(rawMonth),
    day: lunar.getDay(),
    isLeapMonth: rawMonth < 0,
  }
}

/** Lunar calendar date -> Gregorian (solar) calendar date. */
export function toSolar(input: LunarCalendarDate): SolarCalendarDate {
  assertYearInRange(input.year)
  const month = input.isLeapMonth ? -input.month : input.month
  const lunar = lunarFromYmd(input.year, month, input.day)
  const solar = lunar.getSolar()
  return { date: formatYmd(solar.getYear(), solar.getMonth(), solar.getDay()) }
}

function jieQiUtcInstant(handle: RawJieQiHandle): Date {
  const s = handle.getSolar()
  // The library's jieqi timestamps are expressed in China Standard Time (UTC+8); convert to true UTC.
  return new Date(Date.UTC(s.getYear(), s.getMonth() - 1, s.getDay(), s.getHour(), s.getMinute(), s.getSecond()) - 8 * 3600 * 1000)
}

/**
 * All 24 solar terms (exact UTC instants) whose calendar date falls within the given
 * Gregorian year, per-year (not fixed month/day ranges). Walks the sequence with
 * `getNextJieQi()` rather than reading `getJieQiTable()` by name, because that table
 * reuses pinyin-suffixed alternate keys for terms that repeat across its ~13-month
 * window and mixes simplified-Chinese term names, neither of which is a safe lookup
 * source. Metadata (hangul/isJie/branchIndexIfJie) is assigned by position in the
 * fixed 24-term cycle, not by name matching — see tables.ts.
 */
export function solarTerms(year: number): SolarTermInstant[] {
  assertYearInRange(year)
  let cursor = solarFromYmd(year - 1, 12, 1).getLunar()
  const collectedUtc: Date[] = []
  for (let guard = 0; guard < 30; guard++) {
    const next = cursor.getNextJieQi()
    const utc = jieQiUtcInstant(next)
    if (utc.getUTCFullYear() > year) break
    if (utc.getUTCFullYear() === year) collectedUtc.push(utc)
    cursor = next.getSolar().getLunar()
  }
  if (collectedUtc.length !== 24) {
    throw new CalendarInputError(`solarTerms(${year}) collected ${collectedUtc.length} terms, expected exactly 24`)
  }
  return collectedUtc.map((utc, i) => {
    const meta = SOLAR_TERMS_CALENDAR_YEAR_ORDER[i]!
    return {
      hanja: meta.hanja,
      hangul: meta.hangul,
      isJie: meta.isJie,
      branchIndexIfJie: meta.branchIndexIfJie,
      utcIso: utc.toISOString(),
    }
  })
}

/** Resolve the ganzhi four pillars for an explicit local date/time in an IANA timezone. */
export function fourPillars(input: DateTimeInput): FourPillars {
  const { date, time, timezone } = input
  const { y, m, d } = parseYmd(date)
  assertYearInRange(y)

  const utcInstant = resolveInstantUtc(date, time, timezone)

  // Year + month pillar: jieqi-dependent, so resolve in the Beijing-equivalent frame
  // with the full-datetime-precision `*Exact` accessors (see module doc comment).
  const bj = beijingEquivalentFields(utcInstant)
  const bjLunar = solarFromYmdHms(bj.y, bj.m, bj.d, bj.h, bj.mi, bj.s).getLunar()
  const yearPillar = pillar(stemByHanja(bjLunar.getYearGanExact()), branchByHanja(bjLunar.getYearZhiExact()))
  const monthPillar = pillar(stemByHanja(bjLunar.getMonthGanExact()), branchByHanja(bjLunar.getMonthZhiExact()))

  // Day pillar: jieqi-independent, use the true local calendar date directly.
  const localLunar = solarFromYmd(y, m, d).getLunar()
  const dayPillar = pillar(stemByHanja(localLunar.getDayGan()), branchByHanja(localLunar.getDayZhi()))

  const localTime = parseTimeOrNull(time)
  const hourPillar = localTime ? hourPillarFromDayStem(dayPillar.stem, localTime.h) : null

  return {
    year: yearPillar,
    month: monthPillar,
    day: dayPillar,
    hour: hourPillar,
    hourUnknown: localTime === null,
  }
}
