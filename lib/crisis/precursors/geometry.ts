export interface LonLat {
  lon: number
  lat: number
}

export interface Segment {
  a: LonLat
  b: LonLat
}

export interface SegmentIndex {
  segments: Segment[]
  cells: Map<string, number[]>
  cellDeg: number
}

export function lineStringsFromGeojson(payload: unknown): LonLat[][] {
  const root = payload && typeof payload === 'object' ? (payload as { features?: unknown }) : null
  const features = Array.isArray(root?.features) ? root.features : []
  const lines: LonLat[][] = []
  for (const item of features) {
    const feat = item && typeof item === 'object' ? (item as { geometry?: { type?: string; coordinates?: unknown } }) : null
    const geom = feat?.geometry
    if (!geom) continue
    if (geom.type === 'LineString' && Array.isArray(geom.coordinates)) {
      const line = coordsOf(geom.coordinates)
      if (line.length >= 2) lines.push(line)
    } else if (geom.type === 'MultiLineString' && Array.isArray(geom.coordinates)) {
      for (const part of geom.coordinates) {
        const line = coordsOf(part)
        if (line.length >= 2) lines.push(line)
      }
    }
  }
  return lines
}

function coordsOf(value: unknown): LonLat[] {
  if (!Array.isArray(value)) return []
  const out: LonLat[] = []
  for (const pair of value) {
    if (!Array.isArray(pair) || pair.length < 2) continue
    const lon = Number(pair[0])
    const lat = Number(pair[1])
    if (Number.isFinite(lon) && Number.isFinite(lat)) out.push({ lon, lat })
  }
  return out
}

export function segmentsFromLines(lines: LonLat[][]): Segment[] {
  const out: Segment[] = []
  for (const line of lines) {
    for (let i = 1; i < line.length; i += 1) {
      const a = line[i - 1]
      const b = line[i]
      const dLon = Math.abs(a.lon - b.lon)
      if (dLon > 180) continue
      out.push({ a, b })
    }
  }
  return out
}

export function buildSegmentIndex(segments: Segment[], cellDeg: number): SegmentIndex {
  const cells = new Map<string, number[]>()
  const add = (lat: number, lon: number, index: number) => {
    const key = `${Math.floor(lat / cellDeg)}:${Math.floor(lon / cellDeg)}`
    const list = cells.get(key)
    if (list) list.push(index)
    else cells.set(key, [index])
  }
  segments.forEach((segment, index) => {
    add(segment.a.lat, segment.a.lon, index)
    add(segment.b.lat, segment.b.lon, index)
  })
  return { segments, cells, cellDeg }
}

/** Local equirectangular distance from a point to a segment, in kilometres. */
export function pointSegmentKm(lat: number, lon: number, a: LonLat, b: LonLat): number {
  const kx = 111.32 * Math.cos((lat * Math.PI) / 180)
  const ky = 110.57
  const ax = (a.lon - lon) * kx
  const ay = (a.lat - lat) * ky
  const bx = (b.lon - lon) * kx
  const by = (b.lat - lat) * ky
  const dx = bx - ax
  const dy = by - ay
  const len2 = dx * dx + dy * dy
  const t = len2 > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0
  return Math.hypot(ax + t * dx, ay + t * dy)
}

/** Null when the index is empty (data file missing). Infinity is not used. */
export function nearestKm(index: SegmentIndex, lat: number, lon: number, rings: number): number | null {
  if (index.segments.length === 0) return null
  const cy = Math.floor(lat / index.cellDeg)
  const cx = Math.floor(lon / index.cellDeg)
  const seen = new Set<number>()
  let best = Infinity
  for (let dy = -rings; dy <= rings; dy += 1) {
    for (let dx = -rings; dx <= rings; dx += 1) {
      const list = index.cells.get(`${cy + dy}:${cx + dx}`)
      if (!list) continue
      for (const id of list) {
        if (seen.has(id)) continue
        seen.add(id)
        const segment = index.segments[id]
        const km = pointSegmentKm(lat, lon, segment.a, segment.b)
        if (km < best) best = km
      }
    }
  }
  return Number.isFinite(best) ? best : null
}

/**
 * Fragility weight in 0–1 from distance to the nearest plate boundary.
 * GEM's hazard grid is CC BY-NC-SA, so this distance stands in for the hazard zone.
 * Null (no boundary file) uses a moderate 0.35 so a rate anomaly can still score.
 */
export function hazardZoneFromPlateKm(km: number | null): number {
  if (km == null) return 0.35
  if (km <= 50) return 1
  if (km <= 150) return 0.7
  if (km <= 300) return 0.4
  if (km <= 600) return 0.2
  return 0.1
}

export const COAST_KM = 80

export function isCoastalKm(km: number | null): boolean {
  return km != null && km <= COAST_KM
}

/** [lon, lat] pairs, keeping endpoints. For the map payload. */
export function decimateLines(lines: LonLat[][], step: number): number[][][] {
  const out: number[][][] = []
  for (const line of lines) {
    const row: number[][] = []
    for (let i = 0; i < line.length; i += step) row.push([line[i].lon, line[i].lat])
    const last = line[line.length - 1]
    const prev = row[row.length - 1]
    if (last && (!prev || prev[0] !== last.lon || prev[1] !== last.lat)) row.push([last.lon, last.lat])
    if (row.length >= 2) out.push(row)
  }
  return out
}
