export function formatPeopleShort(count: number, locale: string): string {
  const n = Math.max(0, Math.round(count))
  if (locale === 'ko') {
    if (n >= 100_000_000) return `${trimDecimal(n / 100_000_000)}억`
    if (n >= 10_000) return `${Math.round(n / 10_000).toLocaleString('ko-KR')}만`
    return n.toLocaleString('ko-KR')
  }
  if (n >= 1_000_000) return `${trimDecimal(n / 1_000_000)}M`
  if (n >= 1_000) return `${trimDecimal(n / 1_000)}k`
  return n.toLocaleString('en-US')
}

export function formatPeopleAbout(count: number, locale: string): string {
  const short = formatPeopleShort(count, locale)
  if (locale === 'ko') return `인구 약 ${short} 명`
  return `About ${short} people`
}

function trimDecimal(n: number): string {
  return n.toFixed(1).replace(/\.0$/, '')
}

export function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export type TriggerFact = {
  key: string
  sumMm?: number
  maxDayMm?: number
  peakM3s?: number
  mag?: number
}

export function keyTriggerFact(facts: TriggerFact[]): TriggerFact | null {
  return (
    facts.find((row) => row.key === 'rain' && row.sumMm != null) ??
    facts.find((row) => row.key === 'river' && row.peakM3s != null) ??
    facts.find((row) => row.key === 'quake' && row.mag != null) ??
    facts[0] ??
    null
  )
}
