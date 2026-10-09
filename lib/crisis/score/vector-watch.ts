/** Rain that fired 21–56 days ago is context only. It does not change the score. */
export function vectorDiseaseContext(rainDays: string[], now: Date): string | null {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  for (const day of rainDays) {
    const parsed = Date.parse(`${day.slice(0, 10)}T00:00:00Z`)
    if (!Number.isFinite(parsed)) continue
    const ageDays = Math.round((today - parsed) / 86_400_000)
    if (ageDays >= 21 && ageDays <= 56) return 'vector_disease_watch'
  }
  return null
}

export function forecastRainFired(series: unknown, sumSoftMm: number, dayMm: number): boolean {
  if (!series || typeof series !== 'object') return false
  const precip = (series as { precip_mm?: unknown }).precip_mm
  if (!Array.isArray(precip)) return false
  const values = precip.filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
  if (!values.length) return false
  const sum = values.reduce((acc, value) => acc + value, 0)
  return sum >= sumSoftMm || values.some((value) => value >= dayMm)
}
