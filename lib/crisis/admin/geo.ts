/** Equirectangular pixel for a lon/lat point. No polygons. */
export function projectLonLat(
  lon: number,
  lat: number,
  width: number,
  height: number,
): { x: number; y: number } {
  const clampedLon = Math.min(180, Math.max(-180, lon))
  const clampedLat = Math.min(90, Math.max(-90, lat))
  return {
    x: ((clampedLon + 180) / 360) * width,
    y: ((90 - clampedLat) / 180) * height,
  }
}

export function centroidLonLat(centroid: unknown): { lon: number; lat: number } | null {
  if (!centroid) return null
  if (typeof centroid === 'object' && Array.isArray((centroid as { coordinates?: unknown }).coordinates)) {
    const [lon, lat] = (centroid as { coordinates: number[] }).coordinates
    if (Number.isFinite(lon) && Number.isFinite(lat)) return { lon, lat }
  }
  if (typeof centroid === 'string') {
    const match = /POINT\s*\(\s*([-\d.]+)\s+([-\d.]+)\s*\)/i.exec(centroid)
    if (match) {
      const lon = Number(match[1])
      const lat = Number(match[2])
      if (Number.isFinite(lon) && Number.isFinite(lat)) return { lon, lat }
    }
  }
  return null
}

export function stageColor(stage: number): string {
  if (stage >= 5) return '#fb7185'
  if (stage >= 4) return '#fb923c'
  if (stage >= 3) return '#fbbf24'
  if (stage >= 2) return '#38bdf8'
  return '#34d399'
}
