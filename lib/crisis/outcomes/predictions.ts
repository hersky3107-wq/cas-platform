import { windowFromLead, resolvePredictionWindow, type DatedWindow } from './window'

export interface Prediction {
  what: string
  where: string
  window_start: string
  window_end: string
  probability: number
  observable: string
  counts_as_hit: string
  label: string
}

export type PredictionDropReason = 'restates_public_forecast' | 'not_a_consequence' | 'window_over_90_days' | 'incomplete'

const CONSEQUENCES: Array<{ re: RegExp; what: string }> = [
  { re: /\b(dam\s+)?spill\b|방류|overtop/i, what: 'dam spill' },
  { re: /road\s*cut|road\s+closed|washout|교량|도로/i, what: 'road cut' },
  { re: /outbreak|dengue|cholera|epidemic|감염/i, what: 'outbreak' },
  { re: /displac|evacuat|refugee|이재민/i, what: 'displacement' },
  { re: /collapse|breach|structural failure|붕괴/i, what: 'collapse' },
  { re: /erupt/i, what: 'eruption' },
]

const FORECAST_RESTATE =
  /\b(forecast|predicted rainfall|rain forecast|mm of rain|7-day rain|river discharge forecast|cyclone track|expected precipitation)\b/i

export function consequenceOf(text: string): string | null {
  if (FORECAST_RESTATE.test(text) && !CONSEQUENCES.some((row) => row.re.test(text))) return null
  return CONSEQUENCES.find((row) => row.re.test(text))?.what ?? null
}

export function predictionDropReason(raw: {
  what?: string
  where?: string
  window_start?: string
  window_end?: string
  probability?: number
  observable?: string
  counts_as_hit?: string
}, now: Date): PredictionDropReason | null {
  const what = raw.what?.trim() ?? ''
  const where = raw.where?.trim() ?? ''
  if (!what || !where || !raw.observable?.trim() || !raw.counts_as_hit?.trim()) return 'incomplete'
  if (typeof raw.probability !== 'number' || raw.probability < 0 || raw.probability > 1) return 'incomplete'
  if (FORECAST_RESTATE.test(what) && !consequenceOf(what)) return 'restates_public_forecast'
  if (!consequenceOf(what) && !consequenceOf(`${what} ${raw.observable}`)) return 'not_a_consequence'
  const window = resolvePredictionWindow(raw, now, `${what} ${raw.observable}`)
  if (!window) return 'window_over_90_days'
  return null
}

export function normalizePrediction(
  raw: {
    what?: string
    where?: string
    window_start?: string
    window_end?: string
    probability?: number
    observable?: string
    counts_as_hit?: string
  },
  now: Date,
): Prediction | null {
  if (predictionDropReason(raw, now)) return null
  const whatText = raw.what!.trim()
  const consequence = consequenceOf(whatText) ?? consequenceOf(`${whatText} ${raw.observable}`) ?? whatText
  const window = resolvePredictionWindow(raw, now, `${whatText} ${raw.observable}`)!
  return {
    what: consequence,
    where: raw.where!.trim(),
    window_start: window.start,
    window_end: window.end,
    probability: Math.round(raw.probability! * 100) / 100,
    observable: raw.observable!.trim(),
    counts_as_hit: raw.counts_as_hit!.trim(),
    label: window.label,
  }
}

export interface PredictionHint {
  text: string
  where: string
  lead?: { min: number; max: number }
  observable?: string
}

export function predictionFromHint(hint: PredictionHint, now: Date): Prediction | null {
  const consequence = consequenceOf(hint.text)
  if (!consequence) return null
  const window: DatedWindow = windowFromLead(hint.lead, now, hint.text)
  return normalizePrediction(
    {
      what: consequence,
      where: hint.where,
      window_start: window.start,
      window_end: window.end,
      probability: 0.5,
      observable: hint.observable?.trim() || `Official report of ${consequence} at ${hint.where}`,
      counts_as_hit: `A public report confirms ${consequence} at ${hint.where} inside the window.`,
    },
    now,
  )
}

export function settlePredictions(raw: unknown, now: Date, hints: PredictionHint[]): Prediction[] {
  const rows = Array.isArray(raw) ? raw : []
  const kept: Prediction[] = []
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue
    const prediction = normalizePrediction(row as Prediction, now)
    if (prediction) kept.push(prediction)
    if (kept.length >= 3) break
  }
  if (kept.length > 0) return kept.slice(0, 3)
  for (const hint of hints) {
    const prediction = predictionFromHint(hint, now)
    if (!prediction) continue
    if (kept.some((row) => row.what === prediction.what && row.where === prediction.where)) continue
    kept.push(prediction)
    if (kept.length >= 3) break
  }
  return kept
}
