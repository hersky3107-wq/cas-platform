/** Open-Meteo geocoding (no API key). */
export async function geocodeBirthCity(name: string): Promise<{
  latitude: number
  longitude: number
  timezone: string | null
  label: string
} | null> {
  const q = name.trim()
  if (!q) return null

  // Try multiple variations of the city name
  const attempts = [
    q,
    q.split(',')[0].trim(), // "Seoul, Korea" → "Seoul"
    q.split(' ')[0].trim(), // first word only
  ].filter((v, i, arr) => v && arr.indexOf(v) === i) // deduplicate

  for (const attempt of attempts) {
    // Try with English language first, then without
    for (const lang of ['en', 'ko', '']) {
      const langParam = lang ? `&language=${lang}` : ''
      try {
        const res = await fetch(
          `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(attempt)}&count=5${langParam}&format=json`
        )
        if (!res.ok) continue
        const json: unknown = await res.json()
        if (!json || typeof json !== 'object') continue
        const list = (json as { results?: unknown }).results
        if (!Array.isArray(list) || list.length === 0) continue
        const r = list[0] as Record<string, unknown>
        const lat = r.latitude
        const lon = r.longitude
        if (typeof lat !== 'number' || typeof lon !== 'number') continue
        const tz = typeof r.timezone === 'string' ? r.timezone : null
        const joined = [r.name, r.admin1, r.country].filter(
          (x: unknown): x is string => typeof x === 'string',
        ).join(', ')
        const label = joined || (typeof r.name === 'string' ? r.name : attempt)
        return { latitude: lat, longitude: lon, timezone: tz, label }
      } catch {
        continue
      }
    }
  }

  return null
}
