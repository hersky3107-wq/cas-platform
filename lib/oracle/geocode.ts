/** Open-Meteo geocoding (no API key). */
export async function geocodeBirthCity(name: string): Promise<{
  latitude: number
  longitude: number
  timezone: string | null
  label: string
} | null> {
  const q = name.trim()
  if (!q) return null

  const res = await fetch(
    `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=5&language=en&format=json`
  )
  if (!res.ok) return null
  const json: unknown = await res.json()
  if (!json || typeof json !== 'object') return null
  const list = (json as { results?: unknown }).results
  if (!Array.isArray(list) || list.length === 0) return null
  const r = list[0] as Record<string, unknown>
  const lat = r.latitude
  const lon = r.longitude
  if (typeof lat !== 'number' || typeof lon !== 'number') return null
  const tz = typeof r.timezone === 'string' ? r.timezone : null
  const joined = [r.name, r.admin1, r.country].filter(
    (x: unknown): x is string => typeof x === 'string',
  ).join(', ')
  const label = joined || (typeof r.name === 'string' ? r.name : q)
  return { latitude: lat, longitude: lon, timezone: tz, label }
}
