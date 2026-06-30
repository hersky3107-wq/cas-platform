'use client'

import { useEffect, useMemo, useState } from 'react'
import { Loader2, Mountain, ChevronDown, ChevronUp } from 'lucide-react'
import {
  getJejuForecast,
  mapWeatherCode,
  JEJU_WEATHER_REGIONS,
  type JejuRegionId,
  type RegionForecast,
  type ForecastDay,
} from '@/lib/jeju/weather'
import { useTouristUi } from '@/components/jeju/useTouristUi'

/** Current Asia/Seoul (KST) date as a yyyy-mm-dd string. */
function todayKstIso(): string {
  const now = new Date()
  const kst = new Date(now.getTime() + (now.getTimezoneOffset() + 540) * 60_000)
  const y = kst.getFullYear()
  const m = String(kst.getMonth() + 1).padStart(2, '0')
  const d = String(kst.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

const COLLAPSED_DAYS = 3

export function WeatherPanel() {
  const { t } = useTouristUi()
  const [forecasts, setForecasts] = useState<RegionForecast[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [selected, setSelected] = useState<JejuRegionId>('jejuCity')
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    let alive = true
    setLoading(true)
    setError(false)
    getJejuForecast()
      .then((data) => {
        if (!alive) return
        if (data.length === 0) {
          setError(true)
        } else {
          setForecasts(data)
        }
      })
      .catch(() => {
        if (alive) setError(true)
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [])

  const today = useMemo(() => todayKstIso(), [])

  // Regions that actually returned data, in canonical order (for the selector).
  const availableRegions = useMemo(() => {
    if (!forecasts) return []
    const ids = new Set(forecasts.map((f) => f.regionId))
    return JEJU_WEATHER_REGIONS.filter((r) => ids.has(r.id))
  }, [forecasts])

  // Active region forecast — falls back to the first available if the selected
  // region failed to load.
  const active = useMemo(() => {
    if (!forecasts) return null
    return forecasts.find((f) => f.regionId === selected) ?? forecasts[0] ?? null
  }, [forecasts, selected])

  function dayLabel(day: ForecastDay): string {
    if (day.date === today) return t.wToday
    return t.weekdayShort[day.weekday] ?? ''
  }

  return (
    <section className="mt-6">
      <h3 className="flex items-center gap-1.5 text-base font-extrabold tracking-tight text-[#0A2B30]">
        <span aria-hidden>🌦️</span>
        {t.wHeading}
      </h3>

      {loading && (
        <div className="mt-5 flex items-center justify-center gap-2 py-8 text-sm font-semibold text-[#00707A]">
          <Loader2 size={18} className="animate-spin" aria-hidden />
          {t.wLoading}
        </div>
      )}

      {!loading && error && (
        <p className="mt-4 rounded-[14px] bg-[#FFF3DC] px-4 py-3.5 text-sm font-semibold text-[#B84A00]">
          <span aria-hidden>🌧️ </span>
          {t.wError}
        </p>
      )}

      {!loading && !error && active && (
        <div className="mt-3">
          {/* Region selector pills */}
          <div className="flex flex-wrap gap-1.5">
            {availableRegions.map((region) => {
              const isSelected = active.regionId === region.id
              return (
                <button
                  key={region.id}
                  type="button"
                  onClick={() => {
                    setSelected(region.id)
                    setExpanded(false)
                  }}
                  className={`inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-[12.5px] font-bold shadow-sm ring-1 transition-transform hover:-translate-y-0.5 ${
                    isSelected
                      ? 'bg-[#00A8B5] text-white ring-[#00A8B5]'
                      : 'bg-white/85 text-[#00707A] ring-[#00A8B5]/25 hover:ring-[#00A8B5]/50'
                  }`}
                >
                  {region.id === 'hallasan' && (
                    <Mountain size={12} strokeWidth={2.5} aria-hidden />
                  )}
                  {t[region.labelKey]}
                </button>
              )
            })}
          </div>

          {/* Hallasan mountain-weather note */}
          {active.regionId === 'hallasan' && (
            <p className="mt-3 flex items-start gap-1.5 rounded-[14px] bg-[#EAF2FB] px-3.5 py-2.5 text-[12px] font-semibold leading-relaxed text-[#1C5B8F]">
              <Mountain size={14} strokeWidth={2.5} className="mt-0.5 shrink-0" aria-hidden />
              {t.wHallasanNote}
            </p>
          )}

          {/* Forecast day cards */}
          <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-3 lg:grid-cols-7">
            {active.days.slice(0, expanded ? 7 : COLLAPSED_DAYS).map((day) => {
              const wx = mapWeatherCode(day.weatherCode)
              const isToday = day.date === today
              return (
                <div
                  key={day.date}
                  className={`flex flex-col items-center gap-1 rounded-[16px] px-2 py-3 text-center shadow-[0_8px_20px_-14px_rgba(0,112,122,0.6)] ring-1 ${
                    isToday
                      ? 'bg-[#E7FBFD] ring-[#00A8B5]/40'
                      : 'bg-white/85 ring-[#00A8B5]/12'
                  }`}
                >
                  <span
                    className={`text-[11.5px] font-extrabold ${
                      isToday ? 'text-[#00707A]' : 'text-[#5A7176]'
                    }`}
                  >
                    {dayLabel(day)}
                  </span>
                  <span className="text-[22px] leading-none" aria-hidden>
                    {wx.emoji}
                  </span>
                  <span className="text-[10.5px] font-semibold leading-tight text-[#5A7176]">
                    {t[wx.conditionKey]}
                  </span>
                  <span className="mt-0.5 text-[13px] font-extrabold text-[#0A2B30]">
                    <span className="text-[#C2185B]">{day.tempMax}°</span>
                    <span className="mx-0.5 text-[#9AA8AC]">/</span>
                    <span className="text-[#1C6DD0]">{day.tempMin}°</span>
                  </span>
                  {day.precipProb !== null && (
                    <span className="text-[10.5px] font-bold text-[#1C6DD0]">
                      💧 {day.precipProb}%
                    </span>
                  )}
                  {day.windMax !== null && (
                    <span className="text-[10px] font-semibold text-[#5A7176]">
                      💨 {day.windMax} {t.wWindUnit}
                    </span>
                  )}
                </div>
              )
            })}
          </div>

          {/* Expand / collapse (only when more than COLLAPSED_DAYS days exist) */}
          {active.days.length > COLLAPSED_DAYS && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="mt-3 inline-flex items-center gap-1 rounded-full bg-white/85 px-4 py-1.5 text-[12.5px] font-bold text-[#00707A] shadow-sm ring-1 ring-[#00A8B5]/20 transition-opacity hover:opacity-80"
            >
              {expanded ? (
                <>
                  <ChevronUp size={14} aria-hidden />
                  {t.wShowLess}
                </>
              ) : (
                <>
                  <ChevronDown size={14} aria-hidden />
                  {t.wShowMore}
                </>
              )}
            </button>
          )}
        </div>
      )}
    </section>
  )
}
