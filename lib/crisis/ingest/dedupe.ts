export interface DedupeParts {
  source: string
  signalType: string
  id?: string | number | null
  lat?: number | null
  lon?: number | null
  eventTime?: string | null
}

function roundCoord(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return ''
  return value.toFixed(4)
}

/** Stable key. Same inputs always produce the same string. */
export function buildDedupeKey(parts: DedupeParts): string {
  const id = parts.id == null || parts.id === '' ? '' : String(parts.id)
  const event = parts.eventTime ? parts.eventTime : ''
  const lat = roundCoord(parts.lat)
  const lon = roundCoord(parts.lon)
  return [parts.source, parts.signalType, id, lat, lon, event].join('|')
}
