/**
 * Jeju multi-region weather via Open-Meteo (key-less, no existing app route).
 *
 * Mirrors the 5 regions the app's client uses (lib/jeju/weather.ts). We fetch a
 * daily forecast per region in parallel and fail gracefully: regions that error
 * or time out are simply omitted, so the tool still returns whatever succeeded.
 */

import { getAbsolute } from './http.js';

export const JEJU_WEATHER_REGIONS = [
  { id: 'jejuCity', label: '제주시', labelEn: 'Jeju City', lat: 33.4996, lng: 126.5312 },
  { id: 'seogwipo', label: '서귀포', labelEn: 'Seogwipo', lat: 33.2541, lng: 126.5601 },
  { id: 'east', label: '동부', labelEn: 'East', lat: 33.4584, lng: 126.9425 },
  { id: 'west', label: '서부', labelEn: 'West', lat: 33.2915, lng: 126.2425 },
  { id: 'hallasan', label: '한라산', labelEn: 'Hallasan', lat: 33.3617, lng: 126.5292 },
] as const;

/** WMO weather code → emoji + short Korean/English condition. */
export function describeWeatherCode(code: number): { emoji: string; ko: string; en: string } {
  if (code === 0) return { emoji: '☀️', ko: '맑음', en: 'Clear' };
  if (code === 1 || code === 2) return { emoji: '🌤️', ko: '구름 조금', en: 'Partly cloudy' };
  if (code === 3) return { emoji: '☁️', ko: '흐림', en: 'Cloudy' };
  if (code === 45 || code === 48) return { emoji: '🌫️', ko: '안개', en: 'Fog' };
  if (code >= 51 && code <= 57) return { emoji: '🌦️', ko: '이슬비', en: 'Drizzle' };
  if (code >= 95) return { emoji: '⛈️', ko: '천둥번개', en: 'Thunderstorm' };
  if ((code >= 71 && code <= 77) || code === 85 || code === 86)
    return { emoji: '🌨️', ko: '눈', en: 'Snow' };
  if ((code >= 61 && code <= 67) || code === 80 || code === 81 || code === 82)
    return { emoji: '🌧️', ko: '비', en: 'Rain' };
  return { emoji: '🌧️', ko: '비', en: 'Rain' };
}

interface OpenMeteoDaily {
  time?: string[];
  weathercode?: number[];
  temperature_2m_max?: number[];
  temperature_2m_min?: number[];
  precipitation_probability_max?: (number | null)[];
}

export interface RegionForecastDay {
  date: string;
  weatherCode: number;
  condition: string;
  emoji: string;
  tempMax: number | null;
  tempMin: number | null;
  precipProbability: number | null;
}

export interface RegionForecast {
  regionId: string;
  regionLabel: string;
  regionLabelEn: string;
  days: RegionForecastDay[];
}

/** Fetch one region's daily forecast. Returns null on any failure. */
async function fetchRegion(
  region: (typeof JEJU_WEATHER_REGIONS)[number],
  days: number,
): Promise<RegionForecast | null> {
  const params = new URLSearchParams({
    latitude: String(region.lat),
    longitude: String(region.lng),
    daily: 'weathercode,temperature_2m_max,temperature_2m_min,precipitation_probability_max',
    timezone: 'Asia/Seoul',
    forecast_days: String(days),
  });
  const url = `https://api.open-meteo.com/v1/forecast?${params.toString()}`;

  const res = await getAbsolute<{ daily?: OpenMeteoDaily }>(url, { timeoutMs: 10_000 });
  if (!res.ok || !res.data?.daily?.time) return null;

  const d = res.data.daily;
  const out: RegionForecastDay[] = (d.time ?? []).map((date, i) => {
    const code = d.weathercode?.[i] ?? 0;
    const desc = describeWeatherCode(code);
    return {
      date,
      weatherCode: code,
      condition: desc.ko,
      emoji: desc.emoji,
      tempMax: d.temperature_2m_max?.[i] ?? null,
      tempMin: d.temperature_2m_min?.[i] ?? null,
      precipProbability: d.precipitation_probability_max?.[i] ?? null,
    };
  });

  return {
    regionId: region.id,
    regionLabel: region.label,
    regionLabelEn: region.labelEn,
    days: out,
  };
}

export async function getJejuWeather(days: number): Promise<{
  ok: boolean;
  forecastDays: number;
  regions: RegionForecast[];
  error?: string;
}> {
  const clamped = Math.min(7, Math.max(3, Math.floor(days)));
  const results = await Promise.all(
    JEJU_WEATHER_REGIONS.map((r) => fetchRegion(r, clamped).catch(() => null)),
  );
  const regions = results.filter((r): r is RegionForecast => r !== null);

  if (regions.length === 0) {
    return {
      ok: false,
      forecastDays: clamped,
      regions: [],
      error: '날씨 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.',
    };
  }
  return { ok: true, forecastDays: clamped, regions };
}
