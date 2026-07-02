'use client'

/**
 * 오늘 날짜·날씨 — date/time/weather screen for elderly resident mode.
 *
 * 지남력(orientation) support: very large date + day-of-week, live clock,
 * Jeju regional weather with 7-day forecast.
 *
 * Reuses lib/jeju/weather.ts (getJejuForecast, mapWeatherCode, JEJU_WEATHER_REGIONS)
 * without modification. All i18n is Korean-only (resident mode is KR only).
 *
 * Accessibility: ≥24/32/40px text, high contrast, TTS ko-KR,
 * reduced-motion (clock still ticks — informational, not decorative),
 * ≥60px tap targets, focus-visible.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Solar } from 'lunar-javascript'
import {
  getJejuForecast,
  mapWeatherCode,
  JEJU_WEATHER_REGIONS,
  type JejuRegionId,
  type RegionForecast,
  type ForecastDay,
} from '@/lib/jeju/weather'

// ── Korean label maps (resident is Korean-only, no i18n hook needed) ─────────

const WX_LABEL: Record<string, string> = {
  wxClear: '맑음',
  wxPartlyCloudy: '구름 조금',
  wxCloudy: '흐림',
  wxFog: '안개',
  wxDrizzle: '이슬비',
  wxRain: '비',
  wxSnow: '눈',
  wxThunder: '천둥번개',
}

const REGION_LABEL: Record<JejuRegionId, string> = {
  jejuCity: '제주시',
  seogwipo: '서귀포',
  east: '동부(성산)',
  west: '서부(한림)',
  hallasan: '한라산',
}

const WEEKDAY_KO = ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일']
const WEEKDAY_SHORT = ['일', '월', '화', '수', '목', '금', '토']

const C = {
  bg: '#E8F2F5',
  surface: '#FFFFFF',
  ink: '#0F2233',
  inkSoft: '#33475B',
  sea: '#0A5C7A',
  seaStrong: '#07445B',
  focus: '#C2410C',
  todayBg: '#E4F3E6',
  todayBorder: '#2E7D32',
  warmBg: '#FFF6DE',
  warmBorder: '#B7791F',
  red: '#B91C1C',
  blue: '#1C6DD0',
}

// ── Date/time helpers ────────────────────────────────────────────────────────

function kstNow(): Date {
  return new Date(Date.now() + (new Date().getTimezoneOffset() + 540) * 60_000)
}

function todayKstIso(): string {
  const d = kstNow()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${dd}`
}

function formatKoreanDate(d: Date) {
  return {
    year: d.getFullYear(),
    month: d.getMonth() + 1,
    day: d.getDate(),
    weekday: d.getDay(), // 0=Sun
    weekdayLabel: WEEKDAY_KO[d.getDay()]!,
  }
}

function formatKoreanTime(d: Date) {
  const h24 = d.getHours()
  const min = d.getMinutes()
  const ampm = h24 < 12 ? '오전' : '오후'
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12
  return { ampm, hour: h12, minute: min, h24, minStr: String(min).padStart(2, '0') }
}

// Chinese/Hanja zodiac → Korean 띠 label
const SHENGXIAO_KO: Record<string, string> = {
  鼠: '쥐띠', 牛: '소띠', 虎: '호랑이띠', 兔: '토끼띠', 龙: '용띠', 蛇: '뱀띠',
  马: '말띠', 羊: '양띠', 猴: '원숭이띠', 鸡: '닭띠', 狗: '개띠', 猪: '돼지띠',
}

interface LunarInfo {
  month: number
  day: number
  ganZhiYear: string
  shengxiaoKo: string
}

/** Convert a solar Date to 음력. Returns null if the library fails. */
function solarToLunar(d: Date): LunarInfo | null {
  try {
    const solar = Solar.fromDate(d)
    const lunar = solar.getLunar()
    const sx = lunar.getYearShengXiao()
    return {
      month: lunar.getMonth(),
      day: lunar.getDay(),
      ganZhiYear: lunar.getYearInGanZhi(),
      shengxiaoKo: SHENGXIAO_KO[sx] ?? sx,
    }
  } catch {
    return null
  }
}

/** Build a mini calendar grid (weeks × 7) for a given year/month. */
function buildCalendar(year: number, month: number): (number | null)[][] {
  const first = new Date(year, month - 1, 1).getDay() // 0=Sun
  const daysInMonth = new Date(year, month, 0).getDate()
  const cells: (number | null)[] = [
    ...Array(first).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ]
  // Pad to full weeks
  while (cells.length % 7 !== 0) cells.push(null)
  const weeks: (number | null)[][] = []
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7))
  return weeks
}

// ── Component ────────────────────────────────────────────────────────────────

export default function TodayPage() {
  const router = useRouter()

  // ── Client-side hydration gate ────────────────────────────────────────────
  // Clock & date must not run on SSR (window-free). Render a stable placeholder
  // first, then activate after mount.
  const [mounted, setMounted] = useState(false)
  const [now, setNow] = useState<Date | null>(null)
  const [lunarInfo, setLunarInfo] = useState<LunarInfo | null>(null)
  const [ttsSupported, setTtsSupported] = useState(false)
  const [reducedMotion, setReducedMotion] = useState(false)

  useEffect(() => {
    const today = kstNow()
    setMounted(true)
    setNow(today)
    setLunarInfo(solarToLunar(today))
    if ('speechSynthesis' in window) setTtsSupported(true)
    try { setReducedMotion(window.matchMedia('(prefers-reduced-motion: reduce)').matches) } catch { /* */ }
  }, [])

  // Tick every second
  useEffect(() => {
    if (!mounted) return
    const id = setInterval(() => setNow(kstNow()), 1000)
    return () => clearInterval(id)
  }, [mounted])

  // ── Weather ───────────────────────────────────────────────────────────────
  const [forecasts, setForecasts] = useState<RegionForecast[] | null>(null)
  const [wxLoading, setWxLoading] = useState(true)
  const [wxError, setWxError] = useState(false)
  const [selectedRegion, setSelectedRegion] = useState<JejuRegionId>('jejuCity')
  const [wxExpanded, setWxExpanded] = useState(false)
  const todayIso = useMemo(() => todayKstIso(), [])

  useEffect(() => {
    let alive = true
    getJejuForecast()
      .then((data) => {
        if (!alive) return
        if (data.length === 0) setWxError(true)
        else setForecasts(data)
      })
      .catch(() => { if (alive) setWxError(true) })
      .finally(() => { if (alive) setWxLoading(false) })
    return () => { alive = false }
  }, [])

  const availableRegions = useMemo(() => {
    if (!forecasts) return []
    const ids = new Set(forecasts.map((f) => f.regionId))
    return JEJU_WEATHER_REGIONS.filter((r) => ids.has(r.id))
  }, [forecasts])

  const activeRegion = useMemo(() => {
    if (!forecasts) return null
    return forecasts.find((f) => f.regionId === selectedRegion) ?? forecasts[0] ?? null
  }, [forecasts, selectedRegion])

  const todayWx = useMemo(() => {
    const day = activeRegion?.days.find((d) => d.date === todayIso)
    if (!day) return null
    const wx = mapWeatherCode(day.weatherCode)
    return { ...day, ...wx, label: WX_LABEL[wx.conditionKey] ?? wx.conditionKey }
  }, [activeRegion, todayIso])

  // ── TTS ──────────────────────────────────────────────────────────────────
  const speakRef = useRef<(text: string) => void>(() => {})
  const speak = useCallback((text: string) => {
    if (!ttsSupported || !text) return
    try {
      window.speechSynthesis.cancel()
      const u = new SpeechSynthesisUtterance(text)
      u.lang = 'ko-KR'; u.rate = 0.9
      window.speechSynthesis.speak(u)
    } catch { /* */ }
  }, [ttsSupported])
  speakRef.current = speak

  useEffect(() => () => { try { window.speechSynthesis?.cancel() } catch { /* */ } }, [])

  const speakToday = useCallback(() => {
    if (!now) return
    const { year, month, day, weekdayLabel } = formatKoreanDate(now)
    const { ampm, hour, minute } = formatKoreanTime(now)
    let text = `오늘은 양력 ${year}년 ${month}월 ${day}일 ${weekdayLabel}입니다.`
    if (lunarInfo) {
      text += ` 음력으로는 ${lunarInfo.month}월 ${lunarInfo.day}일입니다.`
    }
    text += ` 지금 시각은 ${ampm} ${hour}시 ${minute}분입니다.`
    if (todayWx) {
      const regionName = REGION_LABEL[activeRegion?.regionId ?? 'jejuCity'] ?? '제주시'
      text += ` ${regionName} 날씨는 ${todayWx.label}, 최고 ${todayWx.tempMax}도, 최저 ${todayWx.tempMin}도입니다.`
    }
    speak(text)
  }, [now, lunarInfo, todayWx, activeRegion, speak])

  // ── Calendar ──────────────────────────────────────────────────────────────
  const calData = useMemo(() => {
    if (!now) return null
    const { year, month, day } = formatKoreanDate(now)
    return { year, month, day, weeks: buildCalendar(year, month) }
  }, [now])

  // ── Derived display values ─────────────────────────────────────────────────
  const dateDisplay = now ? formatKoreanDate(now) : null
  const timeDisplay = now ? formatKoreanTime(now) : null

  const dayLabel = useCallback((d: ForecastDay) => {
    if (d.date === todayIso) return '오늘'
    return WEEKDAY_SHORT[d.weekday] ?? ''
  }, [todayIso])

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={styles.root}>
      <style>{GLOBAL_CSS}</style>

      <main style={styles.frame}>
        {/* Top bar */}
        <div style={styles.topBar}>
          <button type="button" className="td-ctrl" style={styles.ctrlBtn} onClick={() => { try { window.speechSynthesis?.cancel() } catch { /* */ } router.push('/jeju/resident') }} aria-label="처음으로 돌아가기">
            <span aria-hidden>↩</span> 처음으로
          </button>
          {ttsSupported && (
            <button type="button" className="td-read" style={styles.readBtn} onClick={speakToday} aria-label="오늘 날짜와 날씨 읽어주기">
              <span aria-hidden>🔊</span> 읽어주기
            </button>
          )}
        </div>

        {/* ── Clock ─────────────────────────────────────────────────────── */}
        <section style={styles.clockCard} aria-label="현재 시각">
          {mounted && timeDisplay ? (
            <>
              <span style={styles.ampm}>{timeDisplay.ampm}</span>
              <span style={styles.clockTime}>
                {timeDisplay.hour}시 {timeDisplay.minStr}분
              </span>
            </>
          ) : (
            <span style={styles.clockPlaceholder} aria-hidden>시각 불러오는 중…</span>
          )}
        </section>

        {/* ── Date (priority: LARGEST) ───────────────────────────────────── */}
        <section style={styles.dateCard} aria-label="오늘 날짜">
          {mounted && dateDisplay ? (
            <>
              <p style={styles.dateLine}>
                {dateDisplay.year}년&nbsp;{dateDisplay.month}월&nbsp;{dateDisplay.day}일
              </p>
              <p style={styles.weekdayLine} aria-label={`요일: ${dateDisplay.weekdayLabel}`}>
                {dateDisplay.weekdayLabel}
              </p>
              {lunarInfo && (
                <div style={styles.lunarRow} aria-label={`음력 ${lunarInfo.month}월 ${lunarInfo.day}일`}>
                  <span style={styles.lunarBadge}>음력</span>
                  <span style={styles.lunarDate}>
                    {lunarInfo.month}월&nbsp;{lunarInfo.day}일
                  </span>
                  <span style={styles.lunarGanzhi} aria-label={`${lunarInfo.ganZhiYear}년 ${lunarInfo.shengxiaoKo}`}>
                    {lunarInfo.ganZhiYear}년&nbsp;({lunarInfo.shengxiaoKo})
                  </span>
                </div>
              )}
            </>
          ) : (
            <p style={{ ...styles.dateLine, color: C.inkSoft }}>날짜 불러오는 중…</p>
          )}
        </section>

        {/* ── Mini calendar ──────────────────────────────────────────────── */}
        {mounted && calData && (
          <section style={styles.calCard} aria-label={`${calData.year}년 ${calData.month}월 달력`}>
            <p style={styles.calTitle}>{calData.month}월 달력</p>
            <table style={styles.calTable} role="grid" aria-label={`${calData.month}월`}>
              <thead>
                <tr>
                  {['일', '월', '화', '수', '목', '금', '토'].map((d, i) => (
                    <th key={d} scope="col" style={{ ...styles.calTh, color: i === 0 ? C.red : i === 6 ? C.blue : C.inkSoft }} aria-label={WEEKDAY_KO[i]}>
                      {d}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {calData.weeks.map((week, wi) => (
                  <tr key={wi}>
                    {week.map((dayNum, di) => {
                      const isToday = dayNum === calData.day
                      const isSun = di === 0, isSat = di === 6
                      return (
                        <td
                          key={di}
                          style={{
                            ...styles.calTd,
                            ...(isToday ? styles.calTdToday : {}),
                            color: isToday ? C.surface : isSun ? C.red : isSat ? C.blue : C.ink,
                          }}
                          aria-current={isToday ? 'date' : undefined}
                          aria-label={dayNum ? `${calData.month}월 ${dayNum}일${isToday ? ' (오늘)' : ''}` : undefined}
                        >
                          {dayNum ?? ''}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        {/* ── Weather ────────────────────────────────────────────────────── */}
        <section style={styles.wxSection} aria-label="제주 날씨 예보">
          <h2 style={styles.wxHeading}><span aria-hidden>🌦️</span> 제주 날씨 예보</h2>

          {wxLoading && (
            <p style={styles.wxStatus}>날씨 정보를 불러오고 있어요…</p>
          )}
          {!wxLoading && wxError && (
            <p style={{ ...styles.wxStatus, color: C.red }}>
              날씨 정보를 불러오지 못했어요. 잠시 후 다시 확인해 주세요.
            </p>
          )}

          {!wxLoading && !wxError && activeRegion && (
            <>
              {/* Region selector */}
              <div style={styles.regionRow} role="group" aria-label="지역 선택">
                {availableRegions.map((r) => {
                  const isOn = activeRegion.regionId === r.id
                  return (
                    <button
                      key={r.id}
                      type="button"
                      className="td-region"
                      style={{ ...styles.regionBtn, ...(isOn ? styles.regionBtnOn : {}) }}
                      onClick={() => { setSelectedRegion(r.id); setWxExpanded(false) }}
                      aria-pressed={isOn}
                      aria-label={`${REGION_LABEL[r.id]} 선택`}
                    >
                      {REGION_LABEL[r.id]}
                    </button>
                  )
                })}
              </div>

              {/* Today summary card */}
              {todayWx && (
                <div style={styles.todaySummary} aria-label="오늘 날씨 요약">
                  <span style={styles.todayEmoji} aria-hidden>{todayWx.emoji}</span>
                  <div style={styles.todayInfo}>
                    <p style={styles.todayCondition}>{todayWx.label}</p>
                    <p style={styles.todayTemp}>
                      <span style={{ color: C.red }}>최고 {todayWx.tempMax}°C</span>
                      <span style={{ color: C.inkSoft, margin: '0 8px' }}>·</span>
                      <span style={{ color: C.blue }}>최저 {todayWx.tempMin}°C</span>
                    </p>
                    {todayWx.precipProb !== null && (
                      <p style={styles.todayExtra}>💧 강수 확률 {todayWx.precipProb}%</p>
                    )}
                    {todayWx.windMax !== null && (
                      <p style={styles.todayExtra}>💨 바람 최대 {todayWx.windMax} km/h</p>
                    )}
                  </div>
                </div>
              )}

              {/* Hallasan note */}
              {activeRegion.regionId === 'hallasan' && (
                <p style={styles.hallasanNote}>
                  ⛰️ 한라산 날씨는 기슭과 크게 다를 수 있습니다. 입산 전 반드시 공원 공식 안내를 확인하세요.
                </p>
              )}

              {/* Forecast cards (3-day / expand to 7) */}
              <div style={styles.forecastGrid} role="list" aria-label="날씨 예보">
                {activeRegion.days.slice(0, wxExpanded ? 7 : 3).map((day) => {
                  const wx = mapWeatherCode(day.weatherCode)
                  const isToday = day.date === todayIso
                  return (
                    <div
                      key={day.date}
                      role="listitem"
                      style={{ ...styles.forecastCard, ...(isToday ? styles.forecastCardToday : {}) }}
                      aria-label={`${isToday ? '오늘' : WEEKDAY_SHORT[day.weekday] + '요일'} ${WX_LABEL[wx.conditionKey] ?? ''} 최고${day.tempMax}도 최저${day.tempMin}도`}
                    >
                      <span style={{ ...styles.fcDay, ...(isToday ? { color: C.sea } : {}) }}>
                        {dayLabel(day)}
                      </span>
                      <span style={styles.fcEmoji} aria-hidden>{wx.emoji}</span>
                      <span style={styles.fcLabel}>{WX_LABEL[wx.conditionKey] ?? ''}</span>
                      <span style={styles.fcTemp}>
                        <span style={{ color: C.red }}>{day.tempMax}°</span>
                        <span style={{ color: C.inkSoft, margin: '0 3px' }}>/</span>
                        <span style={{ color: C.blue }}>{day.tempMin}°</span>
                      </span>
                      {day.precipProb !== null && (
                        <span style={styles.fcExtra}>💧 {day.precipProb}%</span>
                      )}
                    </div>
                  )
                })}
              </div>

              {/* Expand / collapse */}
              {activeRegion.days.length > 3 && (
                <button
                  type="button"
                  className="td-ctrl"
                  style={styles.expandBtn}
                  onClick={() => setWxExpanded((v) => !v)}
                  aria-expanded={wxExpanded}
                >
                  {wxExpanded ? '▲ 간단히 보기' : '▼ 7일 예보 보기'}
                </button>
              )}
            </>
          )}
        </section>
      </main>
    </div>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  root: {
    minHeight: '100dvh', background: C.bg, color: C.ink,
    fontFamily: "'Pretendard', -apple-system, BlinkMacSystemFont, 'Malgun Gothic', 'Apple SD Gothic Neo', sans-serif",
    display: 'flex', justifyContent: 'center', padding: '0 16px 48px', boxSizing: 'border-box',
  },
  frame: { width: '100%', maxWidth: 640, display: 'flex', flexDirection: 'column', gap: 16 },

  topBar: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12,
    position: 'sticky', top: 0, background: C.bg, paddingTop: 10, paddingBottom: 8, zIndex: 5,
  },
  ctrlBtn: {
    minHeight: 58, fontSize: 21, fontWeight: 700, color: C.ink,
    background: C.surface, border: `3px solid ${C.ink}`, borderRadius: 14, cursor: 'pointer',
    padding: '6px 18px',
  },
  readBtn: {
    minHeight: 58, fontSize: 21, fontWeight: 700, color: C.sea,
    background: C.surface, border: `3px solid ${C.sea}`, borderRadius: 14, cursor: 'pointer',
    padding: '6px 18px', display: 'inline-flex', alignItems: 'center', gap: 8,
  },

  // Clock
  clockCard: {
    background: C.sea, borderRadius: 22, padding: '20px 28px',
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
    boxShadow: '0 6px 22px rgba(10,92,122,0.22)',
  },
  ampm: { fontSize: 28, fontWeight: 800, color: 'rgba(255,255,255,0.85)', lineHeight: 1 },
  clockTime: { fontSize: 64, fontWeight: 900, color: '#FFFFFF', lineHeight: 1.1, letterSpacing: '-1px' },
  clockPlaceholder: { fontSize: 28, color: 'rgba(255,255,255,0.6)', lineHeight: 1.4 },

  // Date
  dateCard: {
    background: C.surface, borderRadius: 22, padding: '24px 28px',
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
    boxShadow: '0 4px 16px rgba(15,34,51,0.08)',
  },
  dateLine: { fontSize: 42, fontWeight: 900, color: C.ink, margin: 0, textAlign: 'center', lineHeight: 1.15 },
  weekdayLine: {
    fontSize: 52, fontWeight: 900, color: C.sea, margin: 0, textAlign: 'center', lineHeight: 1.1,
    letterSpacing: '-0.5px',
  },
  lunarRow: {
    display: 'flex', alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap',
    gap: 10, marginTop: 6,
  },
  lunarBadge: {
    fontSize: 18, fontWeight: 800, color: C.surface, background: C.warmBorder,
    borderRadius: 8, padding: '2px 10px', lineHeight: 1.5, letterSpacing: '0.5px',
  },
  lunarDate: {
    fontSize: 28, fontWeight: 800, color: C.ink,
  },
  lunarGanzhi: {
    fontSize: 22, fontWeight: 700, color: C.inkSoft,
  },

  // Mini calendar
  calCard: {
    background: C.surface, borderRadius: 22, padding: '20px 16px 24px',
    boxShadow: '0 4px 16px rgba(15,34,51,0.07)',
  },
  calTitle: { fontSize: 22, fontWeight: 800, color: C.inkSoft, margin: '0 0 12px', textAlign: 'center' },
  calTable: { width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' },
  calTh: {
    fontSize: 18, fontWeight: 800, textAlign: 'center', padding: '6px 2px',
  },
  calTd: {
    fontSize: 22, fontWeight: 700, textAlign: 'center', padding: '8px 2px',
    borderRadius: 8, lineHeight: 1,
  },
  calTdToday: {
    background: C.sea, borderRadius: 50, color: C.surface,
    fontWeight: 900,
  },

  // Weather section
  wxSection: {
    background: C.surface, borderRadius: 22, padding: '24px 20px 28px',
    boxShadow: '0 4px 16px rgba(15,34,51,0.07)',
    display: 'flex', flexDirection: 'column', gap: 16,
  },
  wxHeading: { fontSize: 28, fontWeight: 900, color: C.ink, margin: 0, display: 'flex', alignItems: 'center', gap: 10 },
  wxStatus: { fontSize: 22, fontWeight: 600, color: C.inkSoft, margin: 0 },

  regionRow: { display: 'flex', flexWrap: 'wrap', gap: 10 },
  regionBtn: {
    minHeight: 54, fontSize: 19, fontWeight: 700, color: C.sea,
    background: '#F0F8FB', border: `2px solid ${C.sea}`, borderRadius: 28,
    cursor: 'pointer', padding: '8px 18px',
  },
  regionBtnOn: {
    background: C.sea, color: '#FFFFFF', border: `2px solid ${C.seaStrong}`,
  },

  // Today summary
  todaySummary: {
    background: '#EDF6F9', borderRadius: 18, padding: '20px 20px',
    display: 'flex', alignItems: 'center', gap: 18,
    border: `2px solid ${C.sea}`,
  },
  todayEmoji: { fontSize: 64, lineHeight: 1, flexShrink: 0 },
  todayInfo: { display: 'flex', flexDirection: 'column', gap: 6 },
  todayCondition: { fontSize: 28, fontWeight: 900, color: C.ink, margin: 0 },
  todayTemp: { fontSize: 26, fontWeight: 800, margin: 0 },
  todayExtra: { fontSize: 21, fontWeight: 700, color: C.inkSoft, margin: 0 },

  hallasanNote: {
    fontSize: 19, fontWeight: 600, color: '#1C5B8F', lineHeight: 1.5,
    background: '#EAF2FB', borderRadius: 14, padding: '12px 16px', margin: 0,
  },

  // Forecast cards
  forecastGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: 10,
  },
  forecastCard: {
    background: '#F5FAFC', border: `2px solid #C8E4EE`, borderRadius: 16,
    padding: '14px 8px', display: 'flex', flexDirection: 'column',
    alignItems: 'center', gap: 5, textAlign: 'center',
  },
  forecastCardToday: {
    background: C.todayBg, border: `2px solid ${C.todayBorder}`,
  },
  fcDay: { fontSize: 18, fontWeight: 800, color: C.inkSoft },
  fcEmoji: { fontSize: 32, lineHeight: 1 },
  fcLabel: { fontSize: 15, fontWeight: 700, color: C.inkSoft },
  fcTemp: { fontSize: 18, fontWeight: 800 },
  fcExtra: { fontSize: 14, fontWeight: 700, color: C.blue },

  expandBtn: {
    alignSelf: 'center', minHeight: 56, fontSize: 20, fontWeight: 700, color: C.sea,
    background: C.surface, border: `2px solid ${C.sea}`, borderRadius: 28,
    cursor: 'pointer', padding: '10px 28px',
  },
}

const GLOBAL_CSS = `
  .td-ctrl:focus-visible, .td-read:focus-visible, .td-region:focus-visible {
    outline: 5px solid ${C.focus}; outline-offset: 3px;
  }
  .td-ctrl:hover, .td-read:hover { opacity: 0.88; }
  .td-region:hover { opacity: 0.85; }
  .td-ctrl, .td-read, .td-region {
    transition: opacity 0.12s ease, transform 0.08s ease; -webkit-tap-highlight-color: transparent;
  }
  .td-ctrl:active, .td-read:active, .td-region:active { transform: scale(0.97); }
  @media (prefers-reduced-motion: reduce) {
    .td-ctrl, .td-read, .td-region { transition: none !important; transform: none !important; }
  }
  @media (max-width: 400px) {
    .td-forecast-grid { grid-template-columns: repeat(2, 1fr) !important; }
  }
`
