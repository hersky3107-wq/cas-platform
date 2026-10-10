export interface DailySample {
  date: string
  tmax: number | null
  tmin: number | null
  precip: number | null
  soil: number | null
}

export interface MonthNormal {
  month: number
  tmaxP95: number | null
  tmaxP5: number | null
  tminP95: number | null
  tminP5: number | null
  tmaxMean: number | null
  tminMean: number | null
  precipDailyMean: number | null
  soilMean: number | null
  sampleDays: number
}

export interface ClimateNormals {
  months: MonthNormal[]
  precip30d: number | null
  precip30dBase: number | null
  precip90d: number | null
  precip90dBase: number | null
  soilRecent: number | null
}

export function percentile(values: number[], p: number): number | null {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const idx = (sorted.length - 1) * p
  const lo = Math.floor(idx)
  const hi = Math.ceil(idx)
  if (lo === hi) return sorted[lo]
  return sorted[lo] * (hi - idx) + sorted[hi] * (idx - lo)
}

function mean(values: number[]): number | null {
  if (!values.length) return null
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function monthOf(date: string): number {
  const month = Number(date.slice(5, 7))
  return month >= 1 && month <= 12 ? month : 0
}

export function climateFromDaily(days: DailySample[]): ClimateNormals {
  const byMonth = new Map<number, DailySample[]>()
  for (const day of days) {
    const month = monthOf(day.date)
    if (!month) continue
    const list = byMonth.get(month) ?? []
    list.push(day)
    byMonth.set(month, list)
  }
  const months: MonthNormal[] = []
  for (let month = 1; month <= 12; month += 1) {
    const rows = byMonth.get(month) ?? []
    const tmax = rows.flatMap((row) => (row.tmax == null ? [] : [row.tmax]))
    const tmin = rows.flatMap((row) => (row.tmin == null ? [] : [row.tmin]))
    const precip = rows.flatMap((row) => (row.precip == null ? [] : [row.precip]))
    const soil = rows.flatMap((row) => (row.soil == null ? [] : [row.soil]))
    months.push({
      month,
      tmaxP95: percentile(tmax, 0.95),
      tmaxP5: percentile(tmax, 0.05),
      tminP95: percentile(tmin, 0.95),
      tminP5: percentile(tmin, 0.05),
      tmaxMean: mean(tmax),
      tminMean: mean(tmin),
      precipDailyMean: mean(precip),
      soilMean: mean(soil),
      sampleDays: rows.length,
    })
  }
  const recent = tailSums(days, months)
  return { months, ...recent }
}

function tailSums(
  days: DailySample[],
  months: MonthNormal[],
): Pick<ClimateNormals, 'precip30d' | 'precip30dBase' | 'precip90d' | 'precip90dBase' | 'soilRecent'> {
  const ordered = [...days].filter((row) => monthOf(row.date) > 0).sort((a, b) => a.date.localeCompare(b.date))
  const sumWindow = (n: number) => {
    const slice = ordered.slice(-n)
    let precip = 0
    let base = 0
    let precipDays = 0
    for (const day of slice) {
      if (day.precip == null) continue
      precip += day.precip
      precipDays += 1
      const normal = months[monthOf(day.date) - 1]?.precipDailyMean
      if (normal != null) base += normal
    }
    if (precipDays < Math.min(10, n)) return { precip: null, base: null }
    return { precip, base }
  }
  const d30 = sumWindow(30)
  const d90 = sumWindow(90)
  const soil = ordered.slice(-30).flatMap((row) => (row.soil == null ? [] : [row.soil]))
  return {
    precip30d: d30.precip,
    precip30dBase: d30.base,
    precip90d: d90.precip,
    precip90dBase: d90.base,
    soilRecent: mean(soil),
  }
}
