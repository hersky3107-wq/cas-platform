export function clamp(value: number, lo = 0, hi = 1): number {
  return Math.min(hi, Math.max(lo, value))
}

export function combineOr(parts: number[]): number {
  return 1 - parts.reduce((acc, value) => acc * (1 - clamp(value)), 1)
}

export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const r = 6371
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
  return 2 * r * Math.asin(Math.min(1, Math.sqrt(a)))
}

export function logNorm(value: number, cap: number): number {
  if (value <= 0) return 0
  return clamp(Math.log10(1 + value) / Math.log10(1 + cap))
}

export function percentileThreshold(values: number[], percentile: number): number | null {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b)
  if (!sorted.length) return null
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(percentile * sorted.length) - 1))
  return sorted[index]
}

export function finite(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const n = Number(value)
    if (Number.isFinite(n)) return n
  }
  return null
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

export function hoursBetween(later: Date, earlier: Date): number {
  return (later.getTime() - earlier.getTime()) / 3_600_000
}
