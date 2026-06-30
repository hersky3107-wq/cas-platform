'use client'

import { useEffect, useState } from 'react'
import { MapPin } from 'lucide-react'
import type { TouristLocale, TouristUiPack } from '@/lib/jeju/tourist-labels'
import { useTouristUi } from '@/components/jeju/useTouristUi'
import { LanguageToggle } from './language-toggle'

/**
 * Tourist-mode header (client): live KST analog clock, translated title,
 * localized today's date + weekday, live Jeju City weather, and the language
 * toggle. All dynamic pieces render only after mount to avoid hydration drift
 * (the server snapshot is always Korean-primary).
 */

// Jeju City (제주시청) — the reference point for the header weather readout.
const JEJU_LAT = 33.4996
const JEJU_LNG = 126.5312

/** Localized short weekday names, indexed by Date.getDay() (0 = Sunday). */
const WEEKDAYS: Record<TouristLocale, readonly string[]> = {
  ko: ['일', '월', '화', '수', '목', '금', '토'],
  en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
  ja: ['日', '月', '火', '水', '木', '金', '土'],
  'zh-TW': ['週日', '週一', '週二', '週三', '週四', '週五', '週六'],
  'zh-CN': ['周日', '周一', '周二', '周三', '周四', '周五', '周六'],
}

const EN_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** Localized "Jeju City" label for the weather line. */
const CITY: Record<TouristLocale, string> = {
  ko: '제주시',
  en: 'Jeju City',
  ja: '済州市',
  'zh-TW': '濟州市',
  'zh-CN': '济州市',
}

/** Format the given KST date as a localized "date + weekday" string. */
function formatDate(d: Date, locale: TouristLocale): string {
  const y = d.getFullYear()
  const m = d.getMonth() + 1
  const day = d.getDate()
  const wd = WEEKDAYS[locale][d.getDay()]
  switch (locale) {
    case 'en':
      return `${wd}, ${EN_MONTHS[d.getMonth()]} ${day}, ${y}`
    case 'ja':
      return `${y}年${m}月${day}日(${wd})`
    case 'zh-TW':
    case 'zh-CN':
      return `${y}年${m}月${day}日 ${wd}`
    case 'ko':
    default:
      return `${y}년 ${m}월 ${day}일 (${wd})`
  }
}

/** A Date whose local getters represent the current Asia/Seoul (KST) wall clock. */
function nowKst(): Date {
  const now = new Date()
  return new Date(now.getTime() + (now.getTimezoneOffset() + 540) * 60_000)
}

interface Weather {
  temp: number
  conditionKey: keyof TouristUiPack
  emoji: string
}

/** Map a WMO weather code (Open-Meteo) to a localized condition key + emoji. */
function mapWeatherCode(code: number): { conditionKey: keyof TouristUiPack; emoji: string } {
  if (code === 0) return { conditionKey: 'wxClear', emoji: '☀️' }
  if (code === 1 || code === 2) return { conditionKey: 'wxPartlyCloudy', emoji: '🌤️' }
  if (code === 3) return { conditionKey: 'wxCloudy', emoji: '☁️' }
  if (code === 45 || code === 48) return { conditionKey: 'wxFog', emoji: '🌫️' }
  if (code >= 51 && code <= 57) return { conditionKey: 'wxDrizzle', emoji: '🌦️' }
  if (code >= 95) return { conditionKey: 'wxThunder', emoji: '⛈️' }
  if ((code >= 71 && code <= 77) || code === 85 || code === 86)
    return { conditionKey: 'wxSnow', emoji: '🌨️' }
  return { conditionKey: 'wxRain', emoji: '🌧️' }
}

/** Endpoint of a clock hand from center, given fraction-of-turn and length. */
function hand(cx: number, cy: number, turns: number, len: number): { x: number; y: number } {
  const a = turns * 2 * Math.PI
  return { x: cx + len * Math.sin(a), y: cy - len * Math.cos(a) }
}

function AnalogClock({ date }: { date: Date }) {
  const cx = 24
  const cy = 24
  const s = date.getSeconds()
  const m = date.getMinutes()
  const h = date.getHours() % 12
  const sec = hand(cx, cy, s / 60, 17)
  const min = hand(cx, cy, (m + s / 60) / 60, 15)
  const hr = hand(cx, cy, (h + m / 60) / 12, 10)
  return (
    <svg
      width={48}
      height={48}
      viewBox="0 0 48 48"
      className="shrink-0 drop-shadow-[0_6px_16px_rgba(0,168,181,0.5)]"
      aria-hidden
    >
      <circle cx={cx} cy={cy} r={22} fill="#00A8B5" />
      <circle cx={cx} cy={cy} r={22} fill="none" stroke="#ffffff" strokeOpacity={0.35} strokeWidth={1.5} />
      {/* hour ticks */}
      {Array.from({ length: 12 }).map((_, i) => {
        const outer = hand(cx, cy, i / 12, 20)
        const inner = hand(cx, cy, i / 12, i % 3 === 0 ? 16.5 : 18)
        return (
          <line
            key={i}
            x1={inner.x}
            y1={inner.y}
            x2={outer.x}
            y2={outer.y}
            stroke="#ffffff"
            strokeOpacity={i % 3 === 0 ? 0.9 : 0.45}
            strokeWidth={i % 3 === 0 ? 1.6 : 1}
            strokeLinecap="round"
          />
        )
      })}
      <line x1={cx} y1={cy} x2={hr.x} y2={hr.y} stroke="#ffffff" strokeWidth={2.4} strokeLinecap="round" />
      <line x1={cx} y1={cy} x2={min.x} y2={min.y} stroke="#ffffff" strokeWidth={1.8} strokeLinecap="round" />
      <line x1={cx} y1={cy} x2={sec.x} y2={sec.y} stroke="#FFE055" strokeWidth={1} strokeLinecap="round" />
      <circle cx={cx} cy={cy} r={1.8} fill="#ffffff" />
    </svg>
  )
}

export function TouristHeader() {
  const { t, locale } = useTouristUi()
  const [now, setNow] = useState<Date | null>(null)
  const [weather, setWeather] = useState<Weather | null>(null)

  // Live clock — tick every second after mount (avoids SSR hydration drift).
  useEffect(() => {
    setNow(nowKst())
    const id = setInterval(() => setNow(nowKst()), 1000)
    return () => clearInterval(id)
  }, [])

  // Jeju City weather via Open-Meteo (no API key; CORS-enabled). Fails silently.
  useEffect(() => {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 10_000)
    ;(async () => {
      try {
        const url =
          `https://api.open-meteo.com/v1/forecast?latitude=${JEJU_LAT}&longitude=${JEJU_LNG}` +
          `&current=temperature_2m,weather_code&timezone=Asia%2FSeoul`
        const res = await fetch(url, { signal: ctrl.signal })
        const data = (await res.json()) as {
          current?: { temperature_2m?: number; weather_code?: number }
        }
        const temp = data.current?.temperature_2m
        const code = data.current?.weather_code
        if (typeof temp === 'number' && typeof code === 'number') {
          setWeather({ temp, ...mapWeatherCode(code) })
        }
      } catch {
        // weather is non-essential — leave it hidden on any failure
      } finally {
        clearTimeout(timer)
      }
    })()
    return () => {
      ctrl.abort()
      clearTimeout(timer)
    }
  }, [])

  return (
    <header className="flex flex-col gap-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
        <div className="flex items-center gap-3">
          {now ? (
            <AnalogClock date={now} />
          ) : (
            <span className="h-12 w-12 shrink-0 rounded-full bg-[#00A8B5]/80" aria-hidden />
          )}
          <div className="min-w-0">
            <h1 className="truncate text-lg font-extrabold tracking-tight text-[#00707A]">{t.pageTitle}</h1>
            {now && (
              <p className="mt-0.5 text-[12px] font-semibold text-[#00707A]/70">{formatDate(now, locale)}</p>
            )}
          </div>
        </div>
        <LanguageToggle />
      </div>

      {/* Live Jeju City weather */}
      {weather && (
        <div className="flex items-center gap-1.5 self-start rounded-full bg-white/70 px-3 py-1 text-[12px] font-bold text-[#00707A] shadow-sm ring-1 ring-[#00A8B5]/15 backdrop-blur">
          <MapPin size={12} strokeWidth={2.5} className="text-[#00A8B5]" aria-hidden />
          <span>{CITY[locale]}</span>
          <span aria-hidden>{weather.emoji}</span>
          <span className="font-extrabold text-[#0A2B30]">{Math.round(weather.temp)}°</span>
          <span className="text-[#00707A]/75">{t[weather.conditionKey]}</span>
        </div>
      )}
    </header>
  )
}
