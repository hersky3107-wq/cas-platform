/** Inverse ESRI:54009 World Mollweide (sphere R = 6371007.181 m, lon0 = 0). */
const R = 6_371_007.181

export function mollweideToWgs84(x: number, y: number): { lon: number; lat: number } | null {
  const limit = R * Math.SQRT2
  if (!Number.isFinite(x) || !Number.isFinite(y) || Math.abs(y) > limit + 1) return null
  const theta = Math.asin(clamp(y / limit, -1, 1))
  const cos = Math.cos(theta)
  if (Math.abs(cos) < 1e-12) {
    return { lon: 0, lat: y >= 0 ? 90 : -90 }
  }
  const lon = ((Math.PI * x) / (2 * R * Math.SQRT2 * cos)) * (180 / Math.PI)
  const lat = Math.asin(clamp((2 * theta + Math.sin(2 * theta)) / Math.PI, -1, 1)) * (180 / Math.PI)
  if (!Number.isFinite(lon) || !Number.isFinite(lat) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null
  return { lon, lat }
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value))
}
