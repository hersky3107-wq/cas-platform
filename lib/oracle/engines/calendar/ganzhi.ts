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
 * Day pillar is jieqi-independent. Default `dayBoundary: 'zi_start'` advances
 * the DAY pillar (only) at 23:00–23:59; `'civil_midnight'` keeps the civil date.
 * Hour pillar is 五鼠遁 from whichever day stem that convention selected
 * (not the library's getTimeGan/getTimeZhi). See conventions.ts and
 * docs/day-boundary-verification.md.
 */
import type { BranchInfo, DateTimeInput, DayBoundary, FourPillars, FourPillarsCore, FourPillarsInput, LunarCalendarDate, Pillar, SolarCalendarDate, SolarTermInstant, StemInfo } from './types'
import { BRANCHES, STEMS, SOLAR_TERMS_CALENDAR_YEAR_ORDER, branchByHanja, stemByHanja } from './tables'
import { lunarFromYmd, solarFromYmd, solarFromYmdHms, type RawJieQiHandle } from './lunar-adapter'
import { CalendarInputError } from './errors'
import { addCivilDays, assertYearInRange, beijingEquivalentFields, formatYmd, parseTimeOrNull, parseYmd, resolveInstantUtc } from './utils'

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
/** Pure-function memo: same year always yields the same 24 instants. */
const SOLAR_TERMS_BY_YEAR = new Map<number, SolarTermInstant[]>()

export function solarTerms(year: number): SolarTermInstant[] {
  assertYearInRange(year)
  const cached = SOLAR_TERMS_BY_YEAR.get(year)
  if (cached) return cached
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
  const terms = collectedUtc.map((utc, i) => {
    const meta = SOLAR_TERMS_CALENDAR_YEAR_ORDER[i]!
    return {
      hanja: meta.hanja,
      hangul: meta.hangul,
      isJie: meta.isJie,
      branchIndexIfJie: meta.branchIndexIfJie,
      utcIso: utc.toISOString(),
    }
  })
  SOLAR_TERMS_BY_YEAR.set(year, terms)
  return terms
}

function isLateZiHour(time: string | null): boolean {
  const localTime = parseTimeOrNull(time)
  return localTime !== null && localTime.h === 23
}

function pillarsForBoundary(input: DateTimeInput, dayBoundary: DayBoundary): FourPillarsCore {
  const { date, time, timezone } = input
  const { y } = parseYmd(date)
  assertYearInRange(y)

  const utcInstant = resolveInstantUtc(date, time, timezone)

  // Year + month pillar: jieqi-dependent, so resolve in the Beijing-equivalent frame
  // with the full-datetime-precision `*Exact` accessors (see module doc comment).
  // These do NOT follow dayBoundary — they key off the birth instant / 节气.
  const bj = beijingEquivalentFields(utcInstant)
  const bjLunar = solarFromYmdHms(bj.y, bj.m, bj.d, bj.h, bj.mi, bj.s).getLunar()
  const yearPillar = pillar(stemByHanja(bjLunar.getYearGanExact()), branchByHanja(bjLunar.getYearZhiExact()))
  const monthPillar = pillar(stemByHanja(bjLunar.getMonthGanExact()), branchByHanja(bjLunar.getMonthZhiExact()))

  const localTime = parseTimeOrNull(time)
  const rollDay = dayBoundary === 'zi_start' && localTime !== null && localTime.h === 23
  const dayDate = rollDay ? addCivilDays(date, 1) : date
  const dayYmd = parseYmd(dayDate)
  const localLunar = solarFromYmd(dayYmd.y, dayYmd.m, dayYmd.d).getLunar()
  const dayPillar = pillar(stemByHanja(localLunar.getDayGan()), branchByHanja(localLunar.getDayZhi()))
  const hourPillar = localTime ? hourPillarFromDayStem(dayPillar.stem, localTime.h) : null

  return {
    year: yearPillar,
    month: monthPillar,
    day: dayPillar,
    hour: hourPillar,
    hourUnknown: localTime === null,
    dayBoundaryUsed: dayBoundary,
  }
}

/** Resolve the ganzhi four pillars for an explicit local date/time in an IANA timezone. */
export function fourPillars(input: FourPillarsInput): FourPillars {
  const dayBoundary: DayBoundary = input.dayBoundary ?? 'zi_start'
  const main = pillarsForBoundary(input, dayBoundary)
  const other: DayBoundary = dayBoundary === 'zi_start' ? 'civil_midnight' : 'zi_start'
  return {
    ...main,
    alternate: isLateZiHour(input.time) ? pillarsForBoundary(input, other) : null,
  }
}
